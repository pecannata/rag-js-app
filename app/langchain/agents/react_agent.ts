import { Tool } from 'langchain-core/tools';
import { ChatPromptTemplate, MessagesPlaceholder } from 'langchain-core/prompts';
import { BaseChatModel } from 'langchain-core/language_models/chat_models';
import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor } from 'langchain/agents/executor';

// Import from langgraph
import { StateGraph, END } from '@langchain/langgraph';

// ReAct agent node types
interface AgentState {
  input: string;
  agentOutcome?: string;
  intermediateSteps: Array<{
    action: {
      tool: string;
      toolInput: string;
      log: string;
    };
    observation: string;
  }>;
  response?: string;
}

// Create a ReAct agent that can use multiple tools including calculator and SerpAPI
export const createCalculatorReactAgent = (
  model: BaseChatModel,
  calculatorTool: Tool,
  sqlTool: Tool,
  serpApiTool: Tool
) => {
  // Define the tools array
  const tools = [calculatorTool, serpApiTool, sqlTool];
  
  // Create a prompt template for the agent
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", `You are an AI assistant that helps answer questions.
    
You have access to the following tools:

Calculator: Useful for performing mathematical calculations. Use this tool whenever a calculation is needed.
SerpAPI: Useful for retrieving information from the web.
SQL: Useful for querying the database.

When the user asks a question that requires calculation, use the Calculator tool.
When the user asks a factual question that needs up-to-date information, use the SerpAPI tool.

Think step-by-step to determine which tool is most appropriate for the task.

Use the ReAct approach (Reasoning and Acting) to solve problems:
1. Reason about what information you need and which tool to use
2. Take an action using the appropriate tool
3. Observe the result
4. Use the result to provide a final answer

Only use the tools when necessary. If you can answer directly, do so.`],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // Create a function to execute each tool
  const toolExecutor = async (
    state: AgentState,
    tool: Tool
  ): Promise<AgentState> => {
    // Enhanced logging for tool execution
    if (tool.name === "calculator") {
      console.log("===============================================");
      console.log("🧮 CALCULATOR TOOL USED 🧮");
      console.log("===============================================");
      
      // Get the calculation input
      const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
      const calculationInput = lastStep.action.toolInput;
      console.log(`Calculation being performed: ${calculationInput}`);
    } else {
      console.log(`Executing tool: ${tool.name}`);
    }
    
    // Process the last step to get action and tool input
    const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
    const action = lastStep.action;
    
    // Execute the tool with the provided input
    const observation = await tool.invoke(action.toolInput);
    
    // Enhanced logging for calculator results
    if (tool.name === "calculator") {
      console.log(`Calculation result: ${observation}`);
      console.log("===============================================");
    }
    
    // Update the step with the observation
    lastStep.observation = observation.toString();
    
    return state;
  };
  
  // Create a function to determine which tool to use
  const determineNextTool = (state: AgentState): string => {
    const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
    
    // Get the tool name from the action
    return lastStep.action.tool;
  };
  
  // Function to create the agent using the LLM and tools
  const createAgent = () => {
    // Function to parse LLM output into action and tool input
    const extractAction = (llmOutput: string): { tool: string; toolInput: string; log: string } => {
      // This is a simplified version - a more robust implementation would use regex
      let tool = "unknown";
      let toolInput = "";
      
      if (llmOutput.includes("Action: Calculator")) {
        tool = "calculator";
        const matches = llmOutput.match(/Action Input: (.*?)(?:\n|$)/);
        toolInput = matches ? matches[1] : "";
      } else if (llmOutput.includes("Action: SerpAPI")) {
        tool = "serpapi";
        const matches = llmOutput.match(/Action Input: (.*?)(?:\n|$)/);
        toolInput = matches ? matches[1] : "";
      } else if (llmOutput.includes("Action: SQL")) {
        tool = "sql_query";
        const matches = llmOutput.match(/Action Input: (.*?)(?:\n|$)/);
        toolInput = matches ? matches[1] : "";
      }
      
      return { tool, toolInput, log: llmOutput };
    };
    
    // Function to format intermediate steps for the prompt
    const formatIntermediateSteps = (steps: AgentState["intermediateSteps"]) => {
      return steps.map(step => {
        return [
          ["ai", step.action.log],
          ["human", `Observation: ${step.observation}`]
        ];
      }).flat();
    };
    
    // Create the agent using RunnableSequence
    return RunnableSequence.from([
      {
        input: (state: AgentState) => state.input,
        agent_scratchpad: (state: AgentState) => {
          return formatIntermediateSteps(state.intermediateSteps);
        }
      },
      prompt,
      model,
      new StringOutputParser(),
      (output: string) => {
        if (output.includes("I'll answer directly") || 
            output.includes("I don't need to use a tool") || 
            output.includes("Final Answer:")) {
          return { agentOutcome: "FINISH", response: output };
        }
        
        // Extract the action and tool input
        const { tool, toolInput, log } = extractAction(output);
        
        // If the calculator tool is selected, log it for visibility
        if (tool === "calculator") {
          console.log("🧮 Calculator tool selected for input:", toolInput);
        }
        
        // Return the action
        return {
          agentOutcome: "CONTINUE",
          intermediateSteps: [{
            action: { tool, toolInput, log },
            observation: ""
          }]
        };
      }
    ]);
  };
  
  // Create the agent
  const agent = createAgent();
  
  // Create the state graph
  const workflow = new StateGraph<AgentState>({
    channels: {
      input: {},
      agentOutcome: {},
      intermediateSteps: {},
      response: {}
    }
  });
  
  // Add the nodes to the graph
  workflow.addNode("agent", agent);
  workflow.addNode("calculator", async (state) => toolExecutor(state, calculatorTool));
  workflow.addNode("serpapi", async (state) => toolExecutor(state, serpApiTool));
  workflow.addNode("sql_query", async (state) => toolExecutor(state, sqlTool));
  
  // Add the edges to the graph
  workflow.addEdge("agent", "calculator", {
    if: (state) => {
      if (state.agentOutcome === "CONTINUE") {
        const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
        return lastStep.action.tool === "calculator";
      }
      return false;
    }
  });
  
  workflow.addEdge("agent", "serpapi", {
    if: (state) => {
      if (state.agentOutcome === "CONTINUE") {
        const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
        return lastStep.action.tool === "serpapi";
      }
      return false;
    }
  });
  
  workflow.addEdge("agent", "sql_query", {
    if: (state) => {
      if (state.agentOutcome === "CONTINUE") {
        const lastStep = state.intermediateSteps[state.intermediateSteps.length - 1];
        return lastStep.action.tool === "sql_query";
      }
      return false;
    }
  });
  
  // Add edges from tools back to agent
  workflow.addEdge("calculator", "agent");
  workflow.addEdge("serpapi", "agent");
  workflow.addEdge("sql_query", "agent");
  
  // Add conditional edge to end
  workflow.addEdge("agent", END, {
    if: (state) => state.agentOutcome === "FINISH"
  });
  
  // Set the entry point
  workflow.setEntryPoint("agent");
  
  // Compile the graph
  const app = workflow.compile();
  
  // Create a wrapper that implements the AgentExecutor interface
  return {
    invoke: async ({ input }: { input: string }) => {
      // Run the graph
      console.log("🔍 Processing input with ReAct agent:", input);
      const result = await app.invoke({
        input,
        intermediateSteps: [],
      });
      
      // Return the response
      return { output: result.response || "I couldn't find an answer to your question." };
    }
  };
};

// Create a tool that wraps the SerpAPI for use with the agent
export const createSerpApiAgentTool = (fetchSerpApiResults: (query: string) => Promise<any>) => {
  return new DynamicStructuredTool({
    name: "serpapi",
    description: "Searches the web for up-to-date information.",
    schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web"
        }
      },
      required: ["query"]
    },
    func: async ({ query }) => {
      try {
        const result = await fetchSerpApiResults(query);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error searching the web: ${error}`;
      }
    }
  });
};

