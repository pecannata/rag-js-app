import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { PromptTemplate } from 'langchain-core/prompts';
import { createCalculatorTool } from './tools';
import { createCalculatorReactAgent, createSerpApiAgentTool } from './agents/react_agent';
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

// Create a chain that uses the ReAct agent with calculator and SerpAPI tools
export const createAgentChain = (
  model,
  sqlTool,
  serpApiKey
) => {
  // Create the calculator tool
  const calculatorTool = createCalculatorTool();
  console.log("📊 Calculator tool created and ready to use");
  
  // Create the SerpAPI tool
  const serpApiTool = createSerpApiToolAdapter(serpApiKey);
  
  // Create the ReAct agent with both tools
  const agent = createCalculatorReactAgent(model, calculatorTool, sqlTool, serpApiTool);
  
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

