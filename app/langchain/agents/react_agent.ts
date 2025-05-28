import { Tool } from 'langchain-core/tools';
import { ChatPromptTemplate, MessagesPlaceholder } from 'langchain-core/prompts';
import { BaseChatModel } from 'langchain-core/language_models/chat_models';
import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { DynamicStructuredTool } from '@langchain/core/tools';

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

// Create a simplified calculator-focused agent
export const createCalculatorReactAgent = (
  model: BaseChatModel,
  calculatorTool: Tool,
  sqlTool: Tool, // Kept for compatibility
  serpApiTool: Tool // Kept for compatibility
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

  // Function to parse LLM output into action and tool input
  const extractAction = (llmOutput: string): ToolAction | null => {
    // Case-insensitive regex patterns for action detection
    const calculatorPattern = /action:?\s*calculator/i;
    
    // Regex for extracting action input that can span multiple lines
    const actionInputPattern = /action\s*input:?\s*([\s\S]*?)(?=\n\s*(?:action|observation|thought|final answer|$)|\s*$)/i;
    
    // Check for calculator action with improved pattern matching
    if (calculatorPattern.test(llmOutput)) {
      const matches = llmOutput.match(actionInputPattern);
      const toolInput = matches ? matches[1].trim() : "";
      console.log("📊 Calculator action detected. Input:", toolInput);
      return { 
        tool: "calculator", 
        toolInput: toolInput, 
        log: llmOutput 
      };
    }
    
    // Check if this is a final answer
    if (llmOutput.includes("Final Answer:") || 
        llmOutput.includes("I'll answer directly") || 
        llmOutput.includes("I don't need to use a tool")) {
      return null; // No tool action, just a direct answer
    }
    
    // If we detected something that looks like math but wasn't properly formatted
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
    
    return null;
  };
  
  // Function to execute the calculator tool
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
  
  // Main agent function
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

// Create a tool that wraps the SerpAPI for use with the agent (kept for compatibility)
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

