import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { PromptTemplate } from 'langchain-core/prompts';
import { createCalculatorTool } from './tools';
import { 
  createCalculatorReactAgent, 
  createSerpApiAgentTool, 
  createReactAgent 
} from './agents/react_agent';
import { createToolSelectionGraph } from './graphs/tool_selection_graph';
import { Tool } from 'langchain-core/tools';
import { BaseChatModel } from 'langchain-core/language_models/chat_models';

// Create a RAG prompt template that includes SQL results
export const createRagPromptTemplate = () => {
  return PromptTemplate.fromTemplate(`
You are a helpful AI assistant that answers questions based on:
1. A user query
2. Optionally, SQL query results from an Oracle database

User Query: {query}

{sql_results}

Please provide a helpful, informative response addressing the user's question.
`);
};

// Create a chain that uses SQL results when available
export const createRagChain = (model, sqlTool, runSqlQuery = true) => {
  const promptTemplate = createRagPromptTemplate();
  const parser = new StringOutputParser();

  // Define the chain
  return RunnableSequence.from([
    {
      query: (input) => input.query,
      sql_results: async (input) => {
        if (!runSqlQuery) {
          return "SQL queries are disabled.";
        }
        
        // Check if the message already contains SQL results
        if (input.query && input.query.includes("SQL Results")) {
          console.log("SQL results already included in the message. Skipping SQL query execution.");
          return "SQL results are already included in your message.";
        }
        
        // Skip SQL query execution if either the input query or sqlQuery is empty or whitespace-only
        if (!input.query || input.query.trim() === '' || !input.sqlQuery || input.sqlQuery.trim() === '') {
          return "No SQL query was executed because the query template is empty.";
        }
        
        try {
          // Use the SQL query provided by Chat.tsx
          // This avoids executing user input as SQL directly
          const sqlQuery = input.sqlQuery || input.query;
          const results = await sqlTool.invoke(sqlQuery);
          return `SQL Results:\n${results}`;
        } catch (error) {
          console.error('Error executing SQL query:', error);
          return "Error fetching SQL results.";
        }
      }
    },
    promptTemplate,
    model,
    parser
  ]);
};

// Function to create a SerpAPI tool adapter for the ReAct agent
const createSerpApiToolAdapter = (serpApiKey) => {
  // Function to fetch SerpAPI results (simplified for agent use)
  const fetchSerpApiResults = async (query) => {
    try {
      // Encode the query for URL usage
      const encodedQuery = encodeURIComponent(query);
      
      // Add the API key parameter
      const params = new URLSearchParams();
      params.append('query', encodedQuery);
      if (serpApiKey) {
        params.append('api_key', serpApiKey);
      }
      
      // Make request to the SerpAPI route
      const response = await fetch(`/api/serpapi?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch SerpAPI results: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching SerpAPI results:', error);
      throw error;
    }
  };

  return createSerpApiAgentTool(fetchSerpApiResults);
};

/**
 * Create an integrated workflow that uses LangGraph for tool selection and execution
 * This function creates a workflow that analyzes the query and routes it to the appropriate tool
 */
export const createToolSelectionWorkflow = (
  model: BaseChatModel,
  sqlTool: Tool,
  serpApiKey: string | null | undefined,
  ragChain: any
) => {
  console.log("🚀 Creating LangGraph tool selection workflow");
  
  // Create array of available tools
  const tools: Tool[] = [];
  
  // Always add calculator tool
  const calculatorTool = createCalculatorTool();
  tools.push(calculatorTool);
  console.log("📊 Calculator tool added to the workflow");
  
  // Handle SerpAPI tool (only if valid key is provided)
  const hasSerpApiKey = serpApiKey && serpApiKey.trim() !== "";
  let serpApiTool = null;
  
  if (hasSerpApiKey) {
    serpApiTool = createSerpApiToolAdapter(serpApiKey);
    tools.push(serpApiTool);
    console.log("🔍 SerpAPI tool added to the workflow");
  } else {
    console.log("ℹ️ SerpAPI tool not available (no API key provided)");
  }
  
  // Add SQL tool if provided
  if (sqlTool) {
    tools.push(sqlTool);
    console.log("💾 SQL tool added to the workflow");
  }
  
  // Create the tool selection graph
  const toolSelectionGraph = createToolSelectionGraph(
    model,
    calculatorTool,
    serpApiTool,
    ragChain,
    sqlTool
  );
  
  console.log("🔄 Tool selection graph created with the following tools:");
  tools.forEach(tool => {
    console.log(`- ${tool.name}: ${tool.description}`);
  });
  
  // Return a wrapper that matches the existing interface
  return {
    invoke: async (input: { query: string }) => {
      console.log("⚡ Invoking LangGraph tool selection workflow");
      console.log("📝 Query:", input.query);
      
      try {
        // Execute the tool selection graph
        const result = await toolSelectionGraph.invoke({ 
          query: input.query 
        });
        
        console.log(`✅ Tool selection workflow completed using: ${result.toolUsed}`);
        return result.response;
      } catch (error) {
        console.error("❌ Error in tool selection workflow:", error);
        return `I encountered an error while processing your request: ${error}`;
      }
    }
  };
};

// Create a chain that uses the ReAct agent with calculator and SerpAPI tools
// Maintains backward compatibility while also supporting the new LangGraph workflow
export const createAgentChain = (
  model,
  sqlTool,
  serpApiKey,
  useLangGraph = true // New parameter to toggle between implementations
) => {
  // If LangGraph is enabled and we have a RAG chain, use the tool selection workflow
  if (useLangGraph) {
    // First create the RAG chain that will be used as a fallback
    const ragChain = createRagChain(model, sqlTool, true);
    
    // Then create the tool selection workflow
    return createToolSelectionWorkflow(model, sqlTool, serpApiKey, ragChain);
  }
  
  // Otherwise, use the original implementation (for backward compatibility)
  // Handle empty serpApiKey gracefully
  const hasSerpApiKey = serpApiKey && serpApiKey.trim() !== "";
  // Create the calculator tool
  const calculatorTool = createCalculatorTool();
  console.log("📊 Calculator tool created and ready to use");
  console.log("Calculator tool details:", {
    name: calculatorTool.name,
    description: calculatorTool.description
  });
  
  // Create the SerpAPI tool only if a valid key is provided
  const serpApiTool = hasSerpApiKey ? createSerpApiToolAdapter(serpApiKey) : null;
  
  // Log SerpAPI tool availability
  if (hasSerpApiKey) {
    console.log("🔍 SerpAPI tool created and ready to use");
  } else {
    console.log("ℹ️ SerpAPI tool not available (no API key provided)");
  }
  
  // Create the ReAct agent with available tools
  // Pass the serpApiTool only if it's available
  const agent = hasSerpApiKey 
    ? createCalculatorReactAgent(model, calculatorTool, sqlTool, serpApiTool)
    : createCalculatorReactAgent(model, calculatorTool, sqlTool, null);
  
  // Return a function that invokes the agent
  return {
    invoke: async (input) => {
      console.log("⚡ Invoking ReAct agent with calculator and SerpAPI tools");
      console.log("📝 Query:", input.query);
      console.log("🔄 The agent will now decide which tools to use (if any)...");
      
      try {
        const result = await agent.invoke({ input: input.query });
        console.log("✅ Agent execution completed successfully");
        return result.output;
      } catch (error) {
        console.error("❌ Error invoking agent:", error);
        return `I encountered an error while processing your request: ${error}`;
      }
    }
  };
};

