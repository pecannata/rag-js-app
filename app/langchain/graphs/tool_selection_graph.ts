import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate, MessagesPlaceholder } from "langchain-core/prompts";
import { StringOutputParser } from "langchain-core/output_parsers";
import { BaseChatModel } from "langchain-core/language_models/chat_models";
import { Tool } from "langchain-core/tools";
import { RunnableSequence } from "langchain-core/runnables";
import { Message } from "langchain-core/messages";

// Define the interface for our graph state
interface ToolSelectionState {
  query: string;                    // The user's original query
  chatHistory: Message[];           // Chat history for context
  selectedTool: string | null;      // Which tool was selected (calculator, serpapi, or null for RAG)
  analysis: string;                 // Reasoning about the query
  toolOutput: string | null;        // Output from the selected tool
  finalResponse: string | null;     // Final response to the user
  serpApiQuery?: string;            // Optional hardcoded SerpAPI query from client
}

// Tool detection patterns
const CALCULATOR_PATTERNS = [
  /what\s+is\s+[\d\s\+\-\*\/\^\(\)\.]+/i,  // "what is 2 + 2"
  /calculate\s+[\d\s\+\-\*\/\^\(\)\.]+/i,  // "calculate 25 * 4"
  /[\d\s\+\-\*\/\^\(\)\.]+\s*=\s*\?/i,     // "25 * 4 = ?"
  /\d+\s*[\+\-\*\/\^]\s*\d+/               // "25*4" or "25 + 4"
];

const SERPAPI_PATTERNS = [
  /^(?:who|what|when|where|why|how|is|are|was|were|did|do|does|can|could|should|would)/i, // Question words
  /latest|news|recent|current/i,         // Current events
  /stock price|market|weather/i,         // Real-time data
  /search for|lookup|find information/i  // Explicit search requests
];

/**
 * Create a tool selection graph using LangGraph
 * 
 * This graph implements a workflow that:
 * 1. Analyzes the user query to determine the appropriate tool
 * 2. Routes to the appropriate tool execution (Calculator, SerpAPI, or RAG)
 * 3. Formats the final response
 */
export function createToolSelectionGraph(
  model: BaseChatModel,
  calculatorTool: Tool,
  serpApiTool: Tool | null,
  ragChain: any,
  sqlTool: Tool | null = null
) {
  // Create the graph and define its state
  const graph = new StateGraph<ToolSelectionState>({
    channels: {
      query: {},
      chatHistory: {},
      selectedTool: {},
      analysis: {},
      toolOutput: {},
      finalResponse: {},
      serpApiQuery: {}, // Add channel for serpApiQuery
    }
  });

  // =====================
  // Define graph nodes
  // =====================

  // 1. Query Analysis Node - determines which tool to use
  const queryAnalysisNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🔍 Analyzing query:", state.query);
    
    // Simple pattern-based analysis before calling the LLM
    // This helps reduce unnecessary LLM calls for obvious cases
    
    // Check for calculator patterns - Calculator takes priority over SerpAPI
    const isCalculatorQuery = CALCULATOR_PATTERNS.some(pattern => pattern.test(state.query));
    if (isCalculatorQuery) {
      console.log("📊 Query appears to need calculation");
      return {
        ...state,
        selectedTool: "calculator",
        analysis: "This query appears to require mathematical calculation."
      };
    }
    
    // Only check for SerpAPI patterns if:
    // 1. No calculator pattern was matched (we already returned above if one was)
    // 2. SerpAPI tool is available
    // 3. Query string is not empty
    if (serpApiTool && state.query && state.query.trim() !== "") {
      const isSerpApiQuery = SERPAPI_PATTERNS.some(pattern => pattern.test(state.query));
      if (isSerpApiQuery) {
        console.log("🔎 Query appears to need web search");
        return {
          ...state,
          selectedTool: "serpapi",
          analysis: "This query appears to require a web search for current information."
        };
      }
    }
    
    // For less obvious cases, let's use the model to analyze
    const analyzerPrompt = ChatPromptTemplate.fromMessages([
      ["human", `You need to analyze a user query and determine which tool would be most appropriate.

Options:
- "calculator" - For mathematical calculations, arithmetic problems, and numeric computations
- "serpapi" - For queries about current events, factual information that might change over time, or information not in your training data
- "rag" - For general questions or when neither of the above tools would help

User query: {query}

Think step by step:
1. Does this require mathematical calculation?
2. Does this require up-to-date information from the web?
3. Is this a general question that doesn't need calculation or current web data?

Your task is to output ONLY ONE of these tool names: "calculator", "serpapi", or "rag", followed by a very brief explanation.`]
    ]);
    
    // Create the analyzer chain
    const analyzerChain = RunnableSequence.from([
      analyzerPrompt,
      model,
      new StringOutputParser()
    ]);
    
    // Run the analyzer
    const analysis = await analyzerChain.invoke({ query: state.query });
    console.log("🧠 LLM Analysis:", analysis);
    
    // Extract the tool selection from the analysis
    let selectedTool: string | null = null;
    if (analysis.toLowerCase().includes("calculator")) {
      selectedTool = "calculator";
    } else if (analysis.toLowerCase().includes("serpapi") && serpApiTool) {
      selectedTool = "serpapi";
    } else {
      selectedTool = "rag";
    }
    
    console.log(`🔍 Selected tool: ${selectedTool}`);
    
    return {
      ...state,
      selectedTool,
      analysis
    };
  };

  // 2. Calculator Execution Node
  const calculatorNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🧮 Executing calculator for query:", state.query);
    
    try {
      // Use a prompt to extract the mathematical expression
      const expressionPrompt = ChatPromptTemplate.fromMessages([
        ["human", `Extract only the mathematical expression from this query. 
Return ONLY the expression, nothing else.

Query: {query}`]
      ]);
      
      // Create the expression extractor chain
      const expressionChain = RunnableSequence.from([
        expressionPrompt,
        model,
        new StringOutputParser()
      ]);
      
      // Get the expression
      const expression = await expressionChain.invoke({ query: state.query });
      console.log("🔢 Extracted expression:", expression);
      
      // Calculate the result using the calculator tool
      const result = await calculatorTool.invoke(expression);
      console.log("🧮 Calculator result:", result);
      
      // Create a prompt to format the final response
      const responsePrompt = ChatPromptTemplate.fromMessages([
        ["human", `The user asked: {query}

I've calculated the result: {result}

Please generate a helpful and natural-sounding response that explains the calculation and provides the result.`]
      ]);
      
      // Generate the formatted response
      const responseChain = RunnableSequence.from([
        responsePrompt,
        model,
        new StringOutputParser()
      ]);
      
      const formattedResponse = await responseChain.invoke({ 
        query: state.query, 
        result 
      });
      
      return {
        ...state,
        toolOutput: result,
        finalResponse: formattedResponse
      };
    } catch (error) {
      console.error("❌ Calculator error:", error);
      
      // Fallback to RAG if calculator fails
      return {
        ...state,
        selectedTool: "rag",
        toolOutput: `Error using calculator: ${error}`,
        analysis: `Attempted to use calculator but failed: ${error}`
      };
    }
  };

  // 3. SerpAPI Execution Node
  const serpApiNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🔎 Executing SerpAPI for query:", state.query);
    
    if (!serpApiTool) {
      console.log("⚠️ SerpAPI tool not available, falling back to RAG");
      return {
        ...state,
        selectedTool: "rag",
        analysis: "SerpAPI tool is not available. Falling back to RAG."
      };
    }
    
    try {
      let searchQuery: string;
      
      // Check if a hardcoded SerpAPI query is available
      if (state.serpApiQuery && state.serpApiQuery.trim() !== "") {
        // Use the hardcoded query from the client
        searchQuery = state.serpApiQuery;
        console.log("🔎 Using hardcoded SerpAPI query:", searchQuery);
      } else {
        // No hardcoded query available, extract one from the user's input
        // Use a prompt to extract the search query
        const searchPrompt = ChatPromptTemplate.fromMessages([
          ["human", `Convert this user question into a clear, concise search query for a search engine.
Return ONLY the search query, nothing else.

User question: {query}`]
        ]);
        
        // Create the search query extractor chain
        const searchQueryChain = RunnableSequence.from([
          searchPrompt,
          model,
          new StringOutputParser()
        ]);
        
        // Get the search query
        searchQuery = await searchQueryChain.invoke({ query: state.query });
        console.log("🔎 Generated search query:", searchQuery);
      }
      
      // Execute the search - SerpAPI tool expects an object with a query property
      const searchResult = await serpApiTool.invoke({ query: searchQuery });
      console.log("🔎 SerpAPI result obtained");
      
      // Log a detailed preview of the search result to help with debugging
      console.log("🔍 SERP API RESULT TYPE:", typeof searchResult);
      const resultPreview = typeof searchResult === 'string' 
        ? searchResult.substring(0, 200) 
        : JSON.stringify(searchResult, null, 2).substring(0, 200);
      console.log(`🔎 SerpAPI result preview:\n${resultPreview}...`);
      
      // Format the search result for the LLM with more robust handling
      let formattedSearchResult;
      let extractedInfo = "No relevant information found.";
      
      if (typeof searchResult === 'string') {
        // For string results, use directly
        formattedSearchResult = searchResult;
        extractedInfo = searchResult;
      } else if (typeof searchResult === 'object' && searchResult !== null) {
        try {
          // Extract the most useful information from the result object
          if (searchResult.organic_results && searchResult.organic_results.length > 0) {
            // Extract information from organic results
            extractedInfo = searchResult.organic_results
              .map((result, index) => {
                return `[Result ${index + 1}]\nTitle: ${result.title || ''}\nSnippet: ${result.snippet || ''}\nSource: ${result.source || ''}\n`;
              })
              .join('\n');
          } else if (searchResult.sports_results) {
            // Handle sports-specific results
            extractedInfo = `Sports Results: ${JSON.stringify(searchResult.sports_results, null, 2)}`;
          } else if (searchResult.answer_box) {
            // Handle answer box
            extractedInfo = `Answer: ${searchResult.answer_box.answer || searchResult.answer_box.snippet || JSON.stringify(searchResult.answer_box, null, 2)}`;
          } else {
            // Default to stringify the whole object
            extractedInfo = JSON.stringify(searchResult, null, 2);
          }
          
          // Keep a complete version for debugging
          formattedSearchResult = JSON.stringify(searchResult, null, 2);
        } catch (e) {
          console.error("Error formatting search results:", e);
          formattedSearchResult = "Error formatting search results: " + e.message;
          extractedInfo = "Error extracting information from search results.";
        }
      } else {
        console.warn("SerpAPI returned unexpected result type:", searchResult);
        formattedSearchResult = "No relevant information found.";
        extractedInfo = "No relevant information found.";
      }
      
      // Log what we extracted to verify it's meaningful
      console.log("🔍 Extracted information preview:", extractedInfo.substring(0, 200) + "...");
      
      // Limit the size of the extracted info to avoid token limit issues
      // but using a smarter approach that preserves the most relevant parts
      if (extractedInfo.length > 3000) {
        const firstThird = extractedInfo.substring(0, 1000);
        const lastThird = extractedInfo.substring(extractedInfo.length - 1000);
        extractedInfo = `${firstThird}\n\n...[Content truncated for brevity]...\n\n${lastThird}`;
        console.log("🔍 Truncated extracted information to fit token limits");
      }
      
      // DIRECT APPROACH: Manually construct a prompt with clear section markers
      // This makes it absolutely explicit that we're including the search results
      const manualPrompt = `
=== USER QUERY ===
${state.query}

=== SEARCH RESULTS ===
${extractedInfo}

=== INSTRUCTIONS ===
Generate a helpful and natural-sounding response that answers the user's question based on the search results above.
Include relevant facts from the search results, but be concise.
If the search results don't directly answer the question, acknowledge that and provide the best information available.
`;
      
      console.log("🔍 Sending prompt to LLM:", manualPrompt.substring(0, 200) + "...");
      
      // Generate the formatted response by directly calling the model
      let formattedResponse;
      try {
        // Direct call to the model with our manually constructed prompt
        const result = await model.invoke(manualPrompt);
        formattedResponse = result.content;
        console.log("✅ Successfully generated response from SerpAPI results");
        console.log("✅ Response preview:", formattedResponse.substring(0, 100) + "...");
      } catch (error) {
        console.error("❌ Error generating response from SerpAPI results:", error);
        // Create a more informative fallback response that includes some of the extracted info
        formattedResponse = `I found some information about "${state.query}", but I'm having trouble formatting it into a helpful response. Here's what I found:\n\n${extractedInfo.substring(0, 300)}...`;
      }
      
      return {
        ...state,
        toolOutput: formattedSearchResult,
        finalResponse: formattedResponse
      };
    } catch (error) {
      console.error("❌ SerpAPI error:", error);
      
      // Fallback to RAG if SerpAPI fails
      return {
        ...state,
        selectedTool: "rag",
        toolOutput: `Error using SerpAPI: ${error}`,
        analysis: `Attempted to use SerpAPI but failed: ${error}`
      };
    }
  };

  // 4. RAG Execution Node (fallback)
  const ragNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("📚 Executing RAG for query:", state.query);
    
    try {
      // Use the existing RAG chain
      const result = await ragChain.invoke({
        query: state.query,
        sqlQuery: "" // This will be handled by the chain itself
      });
      
      return {
        ...state,
        toolOutput: "Used RAG chain",
        finalResponse: result
      };
    } catch (error) {
      console.error("❌ RAG error:", error);
      
      // If even RAG fails, return a generic error message
      return {
        ...state,
        toolOutput: `Error using RAG: ${error}`,
        finalResponse: "I apologize, but I encountered an error while processing your request. Could you please try rephrasing your question?"
      };
    }
  };

  // Add nodes to the graph
  graph.addNode("analyzeQuery", queryAnalysisNode);
  graph.addNode("executeCalculator", calculatorNode);
  graph.addNode("executeSerpApi", serpApiNode);
  graph.addNode("executeRag", ragNode);

  // =====================
  // Define edges
  // =====================
  
  // Start with query analysis
  graph.setEntryPoint("analyzeQuery");
  
  // Route based on selected tool
  graph.addConditionalEdges(
    "analyzeQuery",
    (state) => {
      return state.selectedTool || "rag"; // Default to RAG if no tool selected
    },
    {
      "calculator": "executeCalculator",
      "serpapi": "executeSerpApi",
      "rag": "executeRag"
    }
  );
  
  // All tool execution nodes lead to the end
  graph.addEdge("executeCalculator", END);
  graph.addEdge("executeSerpApi", END);
  graph.addEdge("executeRag", END);

  // =====================
  // Compile the graph
  // =====================
  const toolSelectionChain = graph.compile();
  
  // Return a wrapper that simplifies the interface
  return {
    invoke: async ({ query, chatHistory = [], sqlQuery = "", serpApiQuery = "" }: { 
      query: string, 
      chatHistory?: Message[],
      sqlQuery?: string,
      serpApiQuery?: string 
    }) => {
      console.log("🚀 Starting tool selection workflow for query:", query);
      if (serpApiQuery) {
        console.log("🔎 Hardcoded SerpAPI query available:", serpApiQuery.substring(0, 50) + (serpApiQuery.length > 50 ? "..." : ""));
      }
      
      // Initialize the state
      const initialState: ToolSelectionState = {
        query,
        chatHistory: chatHistory || [],
        selectedTool: null,
        analysis: "",
        toolOutput: null,
        finalResponse: null,
        serpApiQuery
      };
      
      // Execute the graph
      const result = await toolSelectionChain.invoke(initialState);
      
      // Log which tool was used
      console.log(`✅ Tool selection workflow completed. Used: ${result.selectedTool}`);
      
      // Return the final response and metadata
      return {
        response: result.finalResponse || "I couldn't process your request. Please try again.",
        toolUsed: result.selectedTool,
        analysis: result.analysis
      };
    }
  };
}

