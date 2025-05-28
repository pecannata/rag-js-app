import { Tool } from 'langchain-core/tools';
import { ChatPromptTemplate, MessagesPlaceholder } from 'langchain-core/prompts';
import { BaseChatModel } from 'langchain-core/language_models/chat_models';
import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Message } from 'langchain-core/messages';
import { StateGraph, END } from "@langchain/langgraph";

// Helper interface for tracking intermediate steps
interface ToolAction {
  tool: string;
  toolInput: string;
  log: string;
}

interface ToolObservation {
  action: ToolAction;
  observation: string;
}

// Interface for the LangGraph agent state
export interface AgentState {
  input: string;
  chatHistory: Message[];
  intermediateSteps: Array<ToolObservation>;
  agentOutcome?: string;
}

/**
 * Create a more comprehensive ReAct agent that supports multiple tools
 * This is the newer implementation designed to work with LangGraph
 */
export const createMultiToolReactAgent = (
  model: BaseChatModel,
  tools: Tool[]
) => {
  // Identify available tools from the provided array
  const hasCalculator = tools.some(tool => tool.name.toLowerCase() === 'calculator');
  const hasSerpApi = tools.some(tool => tool.name.toLowerCase() === 'serpapi');
  
  // Create tool descriptions based on available tools
  const toolDescriptions = tools.map(tool => 
    `${tool.name}: ${tool.description}`
  ).join('\n\n');
  
  // Create a prompt template that supports multiple tools
  // Only using 'human' and 'ai' message types which are supported by Cohere models
  const prompt = ChatPromptTemplate.fromMessages([
    ["human", `I'm going to give you instructions for how to respond to my questions.

You are an AI assistant that helps answer questions.
    
You have access to the following tools:

${toolDescriptions}

${hasCalculator ? 'For math problems like "what is 45*32" or any calculation, ALWAYS use the Calculator tool.' : ''}
${hasSerpApi ? 'For questions about current events, facts, or real-world information, use the SerpAPI tool.' : ''}

Use the following format:

Question: The user's question
Thought: Think step-by-step about how to solve the problem
Action: The tool to use (${tools.map(t => t.name).join(' or ')})
Action Input: The input to the tool
Observation: The result from the tool
Thought: Reflect on the result and decide if you need more information or can provide an answer
${tools.length > 1 ? 'Action/Final Answer: Use another tool or provide your final answer' : 'Final Answer: Your final answer to the user\'s question'}

Begin!

My question is: {input}`],
    new MessagesPlaceholder("chat_history"),
  ]);
  
  return {
    prompt,
    tools
  };
};

// Create a simplified calculator-focused agent (for backward compatibility)
export const createCalculatorReactAgent = (
  model: BaseChatModel,
  calculatorTool: Tool,
  sqlTool: Tool, // Kept for compatibility
  serpApiTool: Tool | null // Updated to be nullable for compatibility
) => {
  // Create a prompt template focused on calculator functionality without using system message
  // Only using 'human' and 'ai' message types which are supported by Cohere models
  const prompt = ChatPromptTemplate.fromMessages([
    ["human", `I'm going to give you instructions for how to respond to my questions.

You are an AI assistant that helps answer questions.
    
You have access to the following tool:

Calculator: Useful for performing mathematical calculations. Use this tool whenever a calculation is needed.

For math problems like "what is 45*32" or any calculation, ALWAYS use the Calculator tool.

Use the following format:

Question: The user's question
Thought: Think step-by-step about how to solve the problem
Action: Calculator
Action Input: The mathematical expression to calculate
Observation: The result of the calculation
Thought: Reflect on the result and formulate a response
Final Answer: Your final answer to the user's question

Begin!

My question is: {input}`],
    new MessagesPlaceholder("chat_history"),
  ]);

  // Enhanced function to parse LLM output into action and tool input
  // This version supports multiple tools including calculator and serpapi
  const extractAction = (llmOutput: string, availableTools: string[] = ["calculator"]): ToolAction | null => {
    // Build regex patterns for all available tools (case-insensitive)
    const toolPatterns = availableTools.map(tool => 
      new RegExp(`action:?\\s*${tool}`, 'i')
    );
    
    // Regex for extracting action input that can span multiple lines
    const actionInputPattern = /action\s*input:?\s*([\s\S]*?)(?=\n\s*(?:action|observation|thought|final answer|$)|\s*$)/i;
    
    // Check for tool actions with pattern matching
    for (let i = 0; i < toolPatterns.length; i++) {
      if (toolPatterns[i].test(llmOutput)) {
        const toolName = availableTools[i].toLowerCase();
        const matches = llmOutput.match(actionInputPattern);
        const toolInput = matches ? matches[1].trim() : "";
        console.log(`🔧 ${toolName} action detected. Input:`, toolInput);
        return { 
          tool: toolName, 
          toolInput: toolInput, 
          log: llmOutput 
        };
      }
    }
    
    // Check if this is a final answer
    if (llmOutput.includes("Final Answer:") || 
        llmOutput.includes("I'll answer directly") || 
        llmOutput.includes("I don't need to use a tool")) {
      return null; // No tool action, just a direct answer
    }
    
    // Special case for calculator: If we detected something that looks like math but wasn't properly formatted
    if (availableTools.includes("calculator")) {
      const mathPattern = /\d+\s*[\+\-\*\/]\s*\d+/;
      if (mathPattern.test(llmOutput)) {
        const mathExpression = llmOutput.match(mathPattern)?.[0] || "";
        console.log("📊 Implicit calculator action detected:", mathExpression);
        return {
          tool: "calculator",
          toolInput: mathExpression,
          log: `Thought: This looks like a math expression\nAction: Calculator\nAction Input: ${mathExpression}`
        };
      }
    }
    
    return null;
  };
  
  // Function to execute any tool
  const executeTool = async (toolName: string, toolInput: string, tools: Tool[]): Promise<string> => {
    console.log("===============================================");
    console.log(`🔧 ${toolName.toUpperCase()} TOOL USED 🔧`);
    console.log("===============================================");
    console.log(`Tool input: ${toolInput}`);
    
    // Find the tool in the available tools
    const tool = tools.find(t => t.name.toLowerCase() === toolName.toLowerCase());
    if (!tool) {
      return `Error: Tool "${toolName}" not found.`;
    }
    
    // Log additional debug info for the tool
    console.log("Tool details:", {
      toolName: tool.name,
      toolDescription: tool.description
    });
    
    try {
      // Execute the tool
      let result;
      
      // Handle structured tools (like SerpAPI) differently from simple tools
      if (tool instanceof DynamicStructuredTool) {
        // For SerpAPI, we need to pass an object with a query property
        if (toolName.toLowerCase() === 'serpapi') {
          result = await tool.invoke({ query: toolInput });
        } else {
          // Generic handling for other structured tools
          result = await tool.invoke({ input: toolInput });
        }
      } else {
        // Standard tool invocation for simple tools like calculator
        result = await tool.invoke(toolInput);
      }
      
      // Log the result
      console.log(`Tool result obtained`);
      console.log("===============================================");
      
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    } catch (error) {
      console.error(`${toolName} error:`, error);
      return `Error: ${error}`;
    }
  };

  // Function to execute the calculator tool (for backward compatibility)
  const executeCalculator = async (toolInput: string): Promise<string> => {
    console.log("===============================================");
    console.log("🧮 CALCULATOR TOOL USED 🧮");
    console.log("===============================================");
    console.log(`Calculation being performed: ${toolInput}`);
    
    // Log additional debug info for calculator queries
    console.log("Tool details:", {
      toolName: calculatorTool.name,
      toolDescription: calculatorTool.description
    });
    
    try {
      // Execute the calculator tool
      const result = await calculatorTool.invoke(toolInput);
      
      // Log the result
      console.log(`Calculation result: ${result}`);
      console.log("===============================================");
      
      return result.toString();
    } catch (error) {
      console.error("Calculator error:", error);
      return `Error: ${error}`;
    }
  };
  
  // Main agent function that supports multiple tools
  const runMultiToolAgent = async (input: string, tools: Tool[], agentPrompt: any, maxIterations = 5): Promise<string> => {
    // Initialize chat history with only 'human' and 'ai' message types
    let chatHistory: Array<["human" | "ai", string]> = [];
    let iterations = 0;
    
    // Get available tool names for action extraction
    const availableToolNames = tools.map(tool => tool.name.toLowerCase());
    
    while (iterations < maxIterations) {
      iterations++;
      
      // Generate the next action
      const promptArgs = {
        input: input,
        chat_history: chatHistory
      };
      
      // Call the model to get the next action
      const rawOutput = await agentPrompt.pipe(model).pipe(new StringOutputParser()).invoke(promptArgs);
      
      // Check if this output includes a final answer
      if (rawOutput.includes("Final Answer:")) {
        const finalAnswerMatch = rawOutput.match(/Final Answer:(.+?)(?:$|(?=\n\s*\n))/s);
        const finalAnswer = finalAnswerMatch ? finalAnswerMatch[1].trim() : rawOutput;
        return finalAnswer;
      }
      
      // Extract tool action
      const toolAction = extractAction(rawOutput, availableToolNames);
      
      // If no tool action was found, treat as final answer
      if (!toolAction) {
        return rawOutput;
      }
      
      // Execute the appropriate tool
      console.log(`🔧 ${toolAction.tool} tool selected for input:`, toolAction.toolInput);
      
      // Execute the tool
      const observation = await executeTool(toolAction.tool, toolAction.toolInput, tools);
      
      // Add the action and observation to chat history
      // Making sure to use only 'human' and 'ai' message types
      chatHistory.push(["ai", toolAction.log]);
      chatHistory.push(["human", `Observation: ${observation}`]);
    }
    
    // If we've reached the maximum number of iterations, return a fallback response
    return "I've thought about this for a while but couldn't reach a conclusive answer.";
  };

  // Original agent function (for backward compatibility)
  const runAgent = async (input: string, maxIterations = 5): Promise<string> => {
    // Initialize chat history with only 'human' and 'ai' message types
    let chatHistory: Array<["human" | "ai", string]> = [];
    let iterations = 0;
    
    while (iterations < maxIterations) {
      iterations++;
      
      // Generate the next action
      const promptArgs = {
        input: input,
        chat_history: chatHistory
      };
      
      // Call the model to get the next action
      const rawOutput = await prompt.pipe(model).pipe(new StringOutputParser()).invoke(promptArgs);
      
      // Check if this output includes a final answer
      if (rawOutput.includes("Final Answer:")) {
        const finalAnswerMatch = rawOutput.match(/Final Answer:(.+?)(?:$|(?=\n\s*\n))/s);
        const finalAnswer = finalAnswerMatch ? finalAnswerMatch[1].trim() : rawOutput;
        return finalAnswer;
      }
      
      // Extract tool action
      const toolAction = extractAction(rawOutput);
      
      // If no tool action was found, treat as final answer
      if (!toolAction) {
        return rawOutput;
      }
      
      // If this is a calculator action, execute it
      if (toolAction.tool === "calculator") {
        console.log("🧮 Calculator tool selected for input:", toolAction.toolInput);
        
        // Execute the calculator
        const observation = await executeCalculator(toolAction.toolInput);
        
        // Add the action and observation to chat history
        // Making sure to use only 'human' and 'ai' message types
        chatHistory.push(["ai", toolAction.log]);
        chatHistory.push(["human", `Observation: ${observation}`]);
      }
    }
    
    // If we've reached the maximum number of iterations, return a fallback response
    return "I've thought about this for a while but couldn't reach a conclusive answer.";
  };
  
  // Return an interface compatible with the original agent
  return {
    invoke: async ({ input }: { input: string }) => {
      console.log("🔍 Processing input with Calculator agent:", input);
      
      try {
        console.log("Starting calculator agent with compatible message types (human/ai only)");
        // Run the agent
        const result = await runAgent(input);
        return { output: result };
      } catch (error) {
        console.error("Error executing calculator agent:", error);
        return { output: `Sorry, I encountered an error: ${error}` };
      }
    }
  };
};

/**
 * Create a LangGraph-compatible ReAct agent that works with the tool selection graph
 */
export const createReactAgent = (
  model: BaseChatModel,
  tools: Tool[]
) => {
  // Get the agent components (prompt and tools)
  const { prompt } = createMultiToolReactAgent(model, tools);
  
  // Define the agent state graph
  const graph = new StateGraph<AgentState>({
    channels: {
      input: {},
      chatHistory: {},
      intermediateSteps: {},
      agentOutcome: {}
    }
  });
  
  // Create the agent node
  const agentNode = async (state: AgentState): Promise<AgentState> => {
    // Format the prompt arguments
    const promptArgs = {
      input: state.input,
      chat_history: state.chatHistory
    };
    
    // Run the LLM to get the agent's output
    const output = await prompt.pipe(model).pipe(new StringOutputParser()).invoke(promptArgs);
    
    // Extract the tool action
    const toolNames = tools.map(tool => tool.name.toLowerCase());
    const toolAction = extractAction(output, toolNames);
    
    // Check if we have a final answer
    if (!toolAction || output.includes("Final Answer:")) {
      // Extract the final answer if present
      let finalAnswer = output;
      if (output.includes("Final Answer:")) {
        const match = output.match(/Final Answer:(.+?)(?:$|(?=\n\s*\n))/s);
        finalAnswer = match ? match[1].trim() : output;
      }
      
      // Return the final answer
      return {
        ...state,
        agentOutcome: finalAnswer
      };
    }
    
    // Otherwise, we need to execute a tool
    console.log(`🔧 Executing ${toolAction.tool} tool with input: ${toolAction.toolInput}`);
    
    // Find the tool
    const tool = tools.find(t => t.name.toLowerCase() === toolAction.tool);
    if (!tool) {
      return {
        ...state,
        agentOutcome: `Error: Tool "${toolAction.tool}" not found.`
      };
    }
    
    // Execute the tool
    try {
      const observation = await executeTool(toolAction.tool, toolAction.toolInput, tools);
      
      // Add this step to the intermediate steps
      const newStep: ToolObservation = {
        action: toolAction,
        observation
      };
      
      // Update the agent state
      return {
        ...state,
        intermediateSteps: [...state.intermediateSteps, newStep]
      };
    } catch (error) {
      console.error(`Error executing ${toolAction.tool} tool:`, error);
      
      // Return the error as the final outcome
      return {
        ...state,
        agentOutcome: `Error: ${error}`
      };
    }
  };
  
  // Define the should continue node
  const shouldContinueNode = (state: AgentState): "continue" | "end" => {
    // If we have a final answer, we're done
    if (state.agentOutcome) {
      return "end";
    }
    
    // If we've reached a reasonable number of steps, stop
    const MAX_ITERATIONS = 10;
    if (state.intermediateSteps.length >= MAX_ITERATIONS) {
      return "end";
    }
    
    // Otherwise, continue
    return "continue";
  };
  
  // Add nodes to the graph
  graph.addNode("agent", agentNode);
  
  // Set the entry point
  graph.setEntryPoint("agent");
  
  // Add edges
  graph.addConditionalEdges(
    "agent",
    shouldContinueNode,
    {
      "continue": "agent",
      "end": END
    }
  );
  
  // Compile the graph
  const reactAgentRunnable = graph.compile();
  
  // Return a wrapper with a simple interface
  return {
    invoke: async ({ input, chatHistory = [] }: { input: string, chatHistory?: Message[] }) => {
      try {
        // Initialize the state
        const initialState: AgentState = {
          input,
          chatHistory,
          intermediateSteps: [],
          agentOutcome: undefined
        };
        
        // Run the graph
        const result = await reactAgentRunnable.invoke(initialState);
        
        // Return the result
        return {
          output: result.agentOutcome || "I couldn't determine an answer.",
          steps: result.intermediateSteps
        };
      } catch (error) {
        console.error("Error executing ReAct agent:", error);
        return {
          output: `Sorry, I encountered an error: ${error}`,
          steps: []
        };
      }
    }
  };
};

// Create a tool that wraps the SerpAPI for use with the agent (kept for compatibility)
export const createSerpApiAgentTool = (fetchSerpApiResults: (query: string) => Promise<any>) => {
  // Create a more flexible tool using Tool instead of DynamicStructuredTool
  // This avoids the strict schema validation
  return {
    name: "serpapi",
    description: "Searches the web for up-to-date information.",
    invoke: async (input: any) => {
      try {
        // Handle different input formats
        let query: string;
        
        // Input is a string directly
        if (typeof input === 'string') {
          try {
            // Try to parse as JSON if it's a stringified object
            const parsedInput = JSON.parse(input);
            if (parsedInput && typeof parsedInput === 'object' && parsedInput.query) {
              query = parsedInput.query;
              console.log("🔍 SerpAPI extracted query from JSON string:", query);
            } else {
              // If parsing succeeded but no query property, use the input as is
              query = input;
              console.log("🔍 SerpAPI using string input directly:", query);
            }
          } catch (e) {
            // Not JSON, use as is
            query = input;
            console.log("🔍 SerpAPI using string input:", query);
          }
        }
        // Input is an object with query property
        else if (typeof input === 'object' && input !== null && input.query) {
          query = input.query;
          console.log("🔍 SerpAPI extracted query from object:", query);
        }
        // Fall back to string conversion
        else {
          query = String(input);
          console.log("🔍 SerpAPI converted input to string:", query);
        }
        
        // Execute the search with the extracted query
        const result = await fetchSerpApiResults(query);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("❌ SerpAPI error:", error);
        return `Error searching the web: ${error}`;
      }
    }
  };
};

/**
 * Function to extract the final answer from a ReAct agent output
 * This is a utility function for working with agent outputs
 */
export const extractFinalAnswer = (output: string): string => {
  if (output.includes("Final Answer:")) {
    const match = output.match(/Final Answer:(.+?)(?:$|(?=\n\s*\n))/s);
    return match ? match[1].trim() : output;
  }
  return output;
};

