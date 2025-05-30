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
  const fetchSerpApiResults = async (input) => {
    try {
      // Handle different input formats (string or object with query property)
      let query = input;

      // Check if input is a stringified JSON object
      if (typeof input === 'string') {
        try {
          const parsedInput = JSON.parse(input);
          if (parsedInput && typeof parsedInput === 'object' && parsedInput.query) {
            query = parsedInput.query;
            console.log("🔍 Extracted query from JSON string:", query);
          }
        } catch (e) {
          // Input is a regular string, not JSON - use it directly
          console.log("🔍 Using direct string query");
        }
      } else if (typeof input === 'object' && input !== null && input.query) {
        // Input is already an object with a query property
        query = input.query;
        console.log("🔍 Extracted query from object:", query);
      }

      // Log the final query being used
      console.log("🔍 SerpAPI executing query:", query);
      
      try {
        // Create URL parameters in a way that works on server-side
        const params = new URLSearchParams();
        params.set('query', query);
        if (serpApiKey) {
          params.set('api_key', serpApiKey);
        }
        
        // In server-side environment, we need an absolute URL with protocol
        // We can use a base URL that works in both server and client environments
        const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3001';
            
        const urlString = `${baseUrl}/api/serpapi?${params.toString()}`;
        console.log("🔍 Using URL:", urlString);
        
        // Make request to the SerpAPI route with properly constructed URL string
        const response = await fetch(urlString, {
          // Ensure we handle redirects properly
          redirect: 'follow'
        });
      
        if (!response.ok) {
          throw new Error(`Failed to fetch SerpAPI results: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
      } catch (error) {
        console.error('Error fetching SerpAPI results:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error fetching SerpAPI results:', error);
      throw error;
    }
  };

  return createSerpApiAgentTool(fetchSerpApiResults);
};

/**
 * Direct multishot workflow implementation that bypasses LangGraph state issues
 * This function provides a simpler implementation for handling multi-step queries
 * without relying on LangGraph's state management which can cause InvalidUpdateError
 */
export const executeMultishotWorkflow = async (
  model: BaseChatModel,
  calculatorTool: Tool,
  serpApiTool: Tool | null,
  ragChain: any,
  input: { query: string, sqlQuery?: string, serpApiQuery?: string }
) => {
  console.log("🚀 Executing direct multishot workflow (bypassing LangGraph state)");
  console.log("📝 Query:", input.query);
  console.log("🔧 Using calculator tool directly in multishot workflow");
  
  // Step 1: Detect the type of multishot query and create a plan
  const isPopulationQuery = /population|people|residents|inhabitants/i.test(input.query);
  const hasMultiplication = /multiply|times|multiplied by|product of/i.test(input.query);
  const hasAddition = /add|sum|combined|total/i.test(input.query);
  const hasPercentage = /percent|percentage|%/i.test(input.query);
  
  console.log("📋 Query analysis:", { 
    isPopulationQuery, hasMultiplication, hasAddition, hasPercentage
  });
  
  // Extract cities or locations using a simple pattern match
  const locationPattern = /(new york|los angeles|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|indianapolis|charlotte|san francisco|seattle|denver|washington|boston|nashville|california|texas|florida)/gi;
  const locationMatches = input.query.match(locationPattern) || [];
  const locations = [...new Set(locationMatches.map(loc => loc.toLowerCase()))]; // Deduplicate
  
  // Extract number using regex if multiplication or percentage is involved
  let multiplier = 0.05; // Default value often used for percentage calculations
  if (hasMultiplication || hasPercentage) {
    const numberPattern = /(\d+(?:\.\d+)?)/g;
    const numbers = input.query.match(numberPattern);
    if (numbers && numbers.length > 0) {
      multiplier = parseFloat(numbers[0]);
      // Convert percentage to decimal if needed
      if (hasPercentage && multiplier > 1) {
        multiplier = multiplier / 100;
      }
    }
    console.log(`🔢 Normalized multiplier for calculator: ${multiplier}`);
  }
  
  console.log("🌍 Detected locations:", locations);
  console.log("🔢 Detected multiplier:", multiplier);
  
  // Check if we have enough locations to proceed
  if (locations.length === 0) {
    return "I couldn't identify specific locations in your query. Please try again with clearer location names.";
  }
  
  // Step 2: Execute search queries for each location
  const locationResults = [];
  
  for (const location of locations) {
    console.log(`🔍 Searching for information about: ${location}`);
    
    if (!serpApiTool) {
      return "I need to search for information, but the search capability is not available. Please try a different query.";
    }
    
    try {
      const searchQuery = isPopulationQuery 
        ? `What is the population of ${location}?`
        : `Information about ${location}`;
        
      console.log("🔍 Search query:", searchQuery);
      
      // Execute the search
      const searchResult = await serpApiTool.invoke({ query: searchQuery });
      
      // Extract numeric information (population) from the result
      let population = null;
      let resultText = "";
      
      if (typeof searchResult === 'string') {
        // Try to parse JSON if it's a string containing JSON
        try {
          const jsonResult = JSON.parse(searchResult);
          
          try {
            // Check for population in knowledge_graph
            if (jsonResult.knowledge_graph && jsonResult.knowledge_graph.population) {
              const populationStr = jsonResult.knowledge_graph.population;
              console.log(`🔢 Found population in knowledge_graph: ${populationStr}`);
              
              // Extract the numeric value
              const millionMatch = populationStr.match(/(\d+(?:\.\d+)?)\s*million/i);
              if (millionMatch && millionMatch[1]) {
                population = parseFloat(millionMatch[1]) * 1000000;
              } else {
                // Regular number with possible commas
                const numericMatch = populationStr.match(/[\d,]+/);
                if (numericMatch) {
                  population = parseFloat(numericMatch[0].replace(/,/g, ''));
                }
              }
              
              resultText = `The population of ${location} is ${populationStr}`;
            }
            // Check answer_box if knowledge_graph didn't have population
            else if (jsonResult.answer_box && jsonResult.answer_box.population) {
              const populationStr = jsonResult.answer_box.population;
              console.log(`🔢 Found population in answer_box: ${populationStr}`);
              
              // Extract the numeric value
              const millionMatch = populationStr.match(/(\d+(?:\.\d+)?)\s*million/i);
              if (millionMatch && millionMatch[1]) {
                population = parseFloat(millionMatch[1]) * 1000000;
              } else {
                // Regular number with possible commas
                const numericMatch = populationStr.match(/[\d,]+/);
                if (numericMatch) {
                  population = parseFloat(numericMatch[0].replace(/,/g, ''));
                }
              }
              
              resultText = `The population of ${location} is ${populationStr}`;
            }
            // If we couldn't find specific population fields, let the LLM extract it
            else {
              // Use the model to extract the relevant information with timeout protection
              const extractionPrompt = `
Extract the population information from the following search result for ${location}.
Return ONLY the population number or "Not found" if no population data is available.

Search result: 
${JSON.stringify(jsonResult, null, 2).substring(0, 2000)}
`;
              
              // Create a promise with timeout to prevent hanging
              const extractionPromise = model.invoke(extractionPrompt);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Population extraction timed out")), 5000);
              });
              
              // Race the extraction against the timeout
              const extractionResult = await Promise.race([extractionPromise, timeoutPromise]);
              resultText = extractionResult.content;
              
              // Try to extract a number from the LLM's response
              const millionMatch = resultText.match(/(\d+(?:\.\d+)?)\s*million/i);
              if (millionMatch && millionMatch[1]) {
                population = parseFloat(millionMatch[1]) * 1000000;
              } else {
                const numericMatch = resultText.match(/[\d,]+/);
                if (numericMatch) {
                  population = parseFloat(numericMatch[0].replace(/,/g, ''));
                }
              }
            }
          } catch (extractionError) {
            console.error(`❌ Error extracting population from JSON result for ${location}:`, extractionError);
            resultText = `Information about ${location} (error extracting data)`;
            population = null;
          }
        } catch (e) {
          // Not JSON, use the string directly
          console.log("📝 Search result is not JSON, using direct string");
          resultText = searchResult;
          
          try {
            // Try to extract population information using the model with timeout protection
            const extractionPrompt = `
Extract the population information from the following search result for ${location}.
Return ONLY the population number or "Not found" if no population data is available.

Search result: 
${searchResult.substring(0, 2000)}
`;
            
            // Create a promise with timeout to prevent hanging
            const extractionPromise = model.invoke(extractionPrompt);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Population extraction timed out")), 5000);
            });
            
            // Race the extraction against the timeout
            const extractionResult = await Promise.race([extractionPromise, timeoutPromise]);
            resultText = extractionResult.content;
            
            // Try to extract a number from the LLM's response
            const millionMatch = resultText.match(/(\d+(?:\.\d+)?)\s*million/i);
            if (millionMatch && millionMatch[1]) {
              population = parseFloat(millionMatch[1]) * 1000000;
            } else {
              const numericMatch = resultText.match(/[\d,]+/);
              if (numericMatch) {
                population = parseFloat(numericMatch[0].replace(/,/g, ''));
              }
            }
          } catch (extractionError) {
            console.error(`❌ Error extracting population from string result for ${location}:`, extractionError);
            resultText = `Information about ${location} (error extracting data)`;
            population = null;
          }
        }
      }
      
      // Log extracted information
      console.log(`📊 Extracted information for ${location}:`, { 
        population: population, 
        resultText: resultText,
        isValidNumber: population !== null && !isNaN(population)
      });
      
      // Ensure population is a valid number
      if (population !== null && isNaN(population)) {
        console.warn(`⚠️ Invalid population value for ${location}: ${population}`);
        population = null;
      }
      
      // Store both the numeric value and the text result
      locationResults.push({
        location,
        population,
        result: resultText
      });
    } catch (error) {
      console.error(`❌ Error searching for information about ${location}:`, error);
      return `I encountered an error while searching for information about ${location}: ${error.message}`;
    }
  }
  
  // Step 3: Perform calculations if needed
  let calculationResult = null;
  let calculationExplanation = "";
  
  if (hasAddition || hasMultiplication) {
    console.log("🧮 Performing calculation with extracted values using calculator tool");
    
    try {
      // Extract the population values and ensure they are valid numbers
      const populationValues = locationResults
        .map(r => {
          // Parse the population value if it's a string or convert to number if needed
          if (r.population === null || r.population === undefined) return null;
          const numValue = typeof r.population === 'string' 
            ? parseFloat(r.population.replace(/,/g, '')) 
            : Number(r.population);
          return isNaN(numValue) ? null : numValue;
        })
        .filter(p => p !== null && !isNaN(p));
      
      console.log("🔢 Population values for calculation:", populationValues);
      
      if (populationValues.length < locations.length) {
        console.warn("⚠️ Could not extract population for all locations");
      }
      
      if (populationValues.length === 0) {
        return "I couldn't extract the necessary population data to perform the calculation. Please try again with a different query.";
      }
      
      // Format values for display
      const formattedValues = populationValues.map(v => v.toLocaleString());
      
      // Use calculator tool with proper timeouts and error handling
      if (hasAddition) {
        // Create a calculator expression for addition
        let additionExpression = populationValues.join(" + ");
        console.log("🔢 Calculator addition expression:", additionExpression);
        
        // Use the calculator tool to perform the addition
        const additionPromise = calculatorTool.invoke(additionExpression);
        const additionTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Calculator addition timed out")), 5000);
        });
        
        try {
          // Race the calculator against the timeout
          const additionResult = await Promise.race([additionPromise, additionTimeoutPromise]);
          console.log("🔢 Calculator addition result:", additionResult);
          
          // Parse the result and handle calculator errors
          const sum = parseFloat(additionResult.replace(/,/g, ''));
          if (isNaN(sum)) {
            throw new Error(`Calculator returned invalid sum: ${additionResult}`);
          }
          
          // Format for display
          const formattedSum = sum.toLocaleString();
          
          if (hasMultiplication) {
            // Create a calculator expression for multiplication
            const multiplicationExpression = `${sum} * ${multiplier}`;
            console.log("🔢 Calculator multiplication expression:", multiplicationExpression);
            
            // Use the calculator tool to perform the multiplication
            const multiplicationPromise = calculatorTool.invoke(multiplicationExpression);
            const multiplicationTimeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Calculator multiplication timed out")), 5000);
            });
            
            // Race the calculator against the timeout
            const multiplicationResult = await Promise.race([multiplicationPromise, multiplicationTimeoutPromise]);
            console.log("🔢 Calculator multiplication result:", multiplicationResult);
            
            // Parse the result and handle calculator errors
            calculationResult = parseFloat(multiplicationResult.replace(/,/g, ''));
            if (isNaN(calculationResult)) {
              throw new Error(`Calculator returned invalid multiplication result: ${multiplicationResult}`);
            }
            
            calculationExplanation = `I added the populations (${formattedValues.join(' + ')}) to get ${formattedSum}, then multiplied by ${multiplier} to get ${calculationResult.toLocaleString()}.`;
          } else {
            calculationResult = sum;
            calculationExplanation = `I added the populations (${formattedValues.join(' + ')}) to get ${formattedSum}.`;
          }
        } catch (calculatorError) {
          console.error("❌ Error using calculator for addition:", calculatorError);
          
          // Fallback to direct calculation if calculator fails
          console.log("⚠️ Falling back to direct calculation for addition");
          let sum = 0;
          for (const value of populationValues) {
            sum += value;
          }
          
          const formattedSum = sum.toLocaleString();
          
          if (hasMultiplication) {
            calculationResult = sum * multiplier;
            calculationExplanation = `I added the populations (${formattedValues.join(' + ')}) to get ${formattedSum}, then multiplied by ${multiplier} to get ${calculationResult.toLocaleString()}.`;
          } else {
            calculationResult = sum;
            calculationExplanation = `I added the populations (${formattedValues.join(' + ')}) to get ${formattedSum}.`;
          }
        }
      } else if (hasMultiplication) {
        // Just multiply the single population using calculator tool
        const multiplicationExpression = `${populationValues[0]} * ${multiplier}`;
        console.log("🔢 Calculator multiplication expression:", multiplicationExpression);
        
        // Use the calculator tool to perform the multiplication
        const multiplicationPromise = calculatorTool.invoke(multiplicationExpression);
        const multiplicationTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Calculator multiplication timed out")), 5000);
        });
        
        try {
          // Race the calculator against the timeout
          const multiplicationResult = await Promise.race([multiplicationPromise, multiplicationTimeoutPromise]);
          console.log("🔢 Calculator multiplication result:", multiplicationResult);
          
          // Parse the result and handle calculator errors
          calculationResult = parseFloat(multiplicationResult.replace(/,/g, ''));
          if (isNaN(calculationResult)) {
            throw new Error(`Calculator returned invalid multiplication result: ${multiplicationResult}`);
          }
          
          calculationExplanation = `I multiplied the population (${populationValues[0].toLocaleString()}) by ${multiplier} to get ${calculationResult.toLocaleString()}.`;
        } catch (calculatorError) {
          console.error("❌ Error using calculator for multiplication:", calculatorError);
          
          // Fallback to direct calculation if calculator fails
          console.log("⚠️ Falling back to direct calculation for multiplication");
          calculationResult = populationValues[0] * multiplier;
          calculationExplanation = `I multiplied the population (${populationValues[0].toLocaleString()}) by ${multiplier} to get ${calculationResult.toLocaleString()}.`;
        }
      }
      
      // Final validation of the calculation result
      if (calculationResult === null || calculationResult === undefined || isNaN(calculationResult)) {
        console.error("❌ Invalid calculation result:", calculationResult);
        calculationResult = 0;
        calculationExplanation = "I encountered an error performing the calculation with the extracted values.";
      }
    } catch (error) {
      console.error("❌ Error during calculation step:", error);
      calculationResult = 0;
      calculationExplanation = "I encountered an error performing the calculation with the extracted values.";
    }
  }
  
  // Step 4: Generate the final response with timeout protection
  let finalResponse = "";
  
  // Prepare a basic fallback response in case model generation fails
  const fallbackResponse = `Based on my research:

${locationResults.map(r => `- ${r.location}: ${r.result}`).join('\n')}

${calculationResult !== null 
  ? `\nCalculation using calculator tool: ${calculationExplanation}\n\nFinal result: ${calculationResult.toLocaleString()}`
  : ''}`;
  
  // Use the model to generate a natural language response with timeout protection
  const responsePrompt = `
I need to answer this user query: "${input.query}"

Here's what I found for each location:
${locationResults.map(r => `${r.location}: ${r.result}`).join('\n')}

${calculationResult !== null ? `I performed this calculation using the calculator tool: ${calculationExplanation}` : ''}

Please generate a comprehensive, natural-sounding response that:
1. Acknowledges the user's question
2. Provides the information found for each location
3. Explains any calculations performed
4. Gives a clear final answer

Keep the response concise but informative.
`;
  
  try {
    // Create a promise with timeout to prevent hanging
    const responsePromise = model.invoke(responsePrompt);
    
    // Set up a timeout for response generation (10 seconds)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Response generation timed out")), 10000);
    });
    
    // Race the response generation against the timeout
    const generatedResponse = await Promise.race([responsePromise, timeoutPromise]);
    finalResponse = generatedResponse.content;
    
    // Validate the response
    if (!finalResponse || finalResponse.trim() === "") {
      console.warn("⚠️ Empty response from model, using fallback");
      finalResponse = fallbackResponse;
    }
  } catch (error) {
    console.error("❌ Error generating final response:", error);
    finalResponse = fallbackResponse;
  }
  
  // Log success and return the response
  console.log("✅ Response generation completed successfully");
  
  // Final validation before returning
  if (!finalResponse || finalResponse.trim() === '') {
    console.warn("⚠️ Empty final response, using simple fallback");
    return `Based on my research about your query "${input.query}", ` + 
           `I found information about ${locations.join(' and ')}.` +
           (calculationResult !== null ? 
             ` The calculation result is ${calculationResult.toLocaleString()}.` : '');
  }
  
  console.log("✅ Direct multishot workflow completed successfully");
  return finalResponse;
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
  
  // Patterns to detect multishot queries that should bypass LangGraph
  const MULTISHOT_BYPASS_PATTERNS = [
    // Population calculation patterns
    /population.*(multiply|times|multiplied by|percentage|percent|%)/i,
    /population.*(add|plus|sum|combined|total)/i,
    /population.*and.*population/i,
    
    // Explicit requests for multiple steps
    /first.*then/i,
    /after that/i,
    /subsequently/i
  ];
  
  // Return a wrapper that matches the existing interface
  return {
    invoke: async (input: { query: string, sqlQuery?: string, serpApiQuery?: string }) => {
      console.log("⚡ Invoking tool selection workflow");
      console.log("📝 Query:", input.query);
      if (input.serpApiQuery) {
        console.log("📝 SerpAPI Query available:", input.serpApiQuery.substring(0, 50) + (input.serpApiQuery.length > 50 ? "..." : ""));
      }
      
      // Check if this is a multishot query that should bypass LangGraph
      const shouldBypassLangGraph = MULTISHOT_BYPASS_PATTERNS.some(pattern => pattern.test(input.query));
      
      if (shouldBypassLangGraph && serpApiTool) {
        console.log("🚀 Detected multishot query, bypassing LangGraph to avoid state issues");
        try {
          const directResult = await executeMultishotWorkflow(
            model,
            calculatorTool,
            serpApiTool,
            ragChain,
            input
          );
          return directResult;
        } catch (directError) {
          console.error("❌ Error in direct multishot workflow:", directError);
          console.log("⚠️ Falling back to LangGraph workflow");
          // Fall back to LangGraph workflow if direct approach fails
        }
      }
      
      try {
        // Execute the tool selection graph
        const result = await toolSelectionGraph.invoke({ 
          query: input.query,
          sqlQuery: input.sqlQuery,
          serpApiQuery: input.serpApiQuery // Pass the hardcoded SerpAPI query from client
        });
        
        console.log(`✅ Tool selection workflow completed using: ${result.toolUsed}`);
        if (result.toolUsed === "serpapi" && input.serpApiQuery) {
          console.log("🔍 Used hardcoded SerpAPI query:", input.serpApiQuery.substring(0, 50) + (input.serpApiQuery.length > 50 ? "..." : ""));
        }
        return result.response;
      } catch (error) {
        console.error("❌ Error in tool selection workflow:", error);
        
        // If we get an InvalidUpdateError, try the direct approach as a fallback
        if (error.name === "InvalidUpdateError" || error.toString().includes("InvalidUpdateError")) {
          console.log("🔄 Caught InvalidUpdateError, trying direct multishot approach as fallback");
          
          if (serpApiTool) {
            try {
              const directResult = await executeMultishotWorkflow(
                model,
                calculatorTool,
                serpApiTool,
                ragChain,
                input
              );
              return directResult;
            } catch (directError) {
              console.error("❌ Error in fallback direct multishot workflow:", directError);
            }
          }
        }
        
        return `I encountered an error while processing your request. Please try rephrasing your question or breaking it into simpler parts.`;
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
  useMultiShotAI = false // Renamed from useLangGraph to useMultiShotAI
) => {
  // First create the RAG chain that will be used as a fallback or direct access
  const ragChain = createRagChain(model, sqlTool, true);
  
  // If multi-shot AI is disabled, create a wrapper that bypasses tool selection
  // when both SQL and SerpAPI queries are empty
  if (!useMultiShotAI) {
    console.log("🔄 Multi-shot Agentic AI is disabled, will use RAG directly when possible");
    
    return {
      invoke: async (input) => {
        console.log("📝 Query:", input.query);
        
        // Check if both SQL and SerpAPI queries are empty
        const sqlQueryEmpty = !input.sqlQuery || input.sqlQuery.trim() === '';
        const serpApiQueryEmpty = !input.serpApiQuery || input.serpApiQuery.trim() === '';
        
        // If both are empty, bypass tool selection and go straight to RAG
        if (sqlQueryEmpty && serpApiQueryEmpty) {
          console.log("⏩ Bypassing tool selection, going straight to LLM with RAG");
          try {
            const result = await ragChain.invoke({
              query: input.query,
              sqlQuery: input.sqlQuery || ""
            });
            console.log("✅ RAG execution completed successfully");
            return result;
          } catch (error) {
            console.error("❌ Error invoking RAG chain:", error);
            return `I encountered an error while processing your request: ${error}`;
          }
        } else {
          // If either SQL or SerpAPI query is present, use the tool selection workflow
          console.log("🔄 SQL or SerpAPI query is present, using tool selection workflow");
          const toolSelectionChain = createToolSelectionWorkflow(model, sqlTool, serpApiKey, ragChain);
          return await toolSelectionChain.invoke(input);
        }
      }
    };
  }
  
  // If multi-shot AI is enabled, use the tool selection workflow
  console.log("🔄 Multi-shot Agentic AI is enabled, using full tool selection workflow");
  return createToolSelectionWorkflow(model, sqlTool, serpApiKey, ragChain);
};

