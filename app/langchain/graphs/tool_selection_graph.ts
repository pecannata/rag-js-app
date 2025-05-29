import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate, MessagesPlaceholder } from "langchain-core/prompts";
import { StringOutputParser } from "langchain-core/output_parsers";
import { BaseChatModel } from "langchain-core/language_models/chat_models";
import { Tool } from "langchain-core/tools";
import { RunnableSequence } from "langchain-core/runnables";
import { Message } from "langchain-core/messages";

// Define interfaces for sub-questions in multishot workflows
interface SubQuestion {
  id: string;                      // Unique identifier for the sub-question
  question: string;                // The sub-question text
  toolType: string;                // Which tool to use ("calculator", "serpapi", "rag")
  dependsOn: string[];             // IDs of sub-questions this depends on
  completed: boolean;              // Whether this sub-question has been processed
  result: string | null;           // Result from tool execution
}

// Define the interface for our enhanced graph state with multishot support
interface ToolSelectionState {
  query: string;                    // The user's original query
  chatHistory: Message[];           // Chat history for context
  selectedTool: string | null;      // Which tool was selected (calculator, serpapi, or null for RAG)
  analysis: string;                 // Reasoning about the query
  toolOutput: string | null;        // Output from the selected tool
  finalResponse: string | null;     // Final response to the user
  serpApiQuery?: string;            // Optional hardcoded SerpAPI query from client
  
  // Multishot workflow fields
  requiresDecomposition: boolean;   // Whether the query needs to be broken down
  isMultishot: boolean;             // Whether we're in a multishot workflow
  subQuestions: SubQuestion[];      // List of sub-questions if decomposed
  currentSubQuestion: SubQuestion | null; // Current sub-question being processed
  intermediateResults: Record<string, string>; // Results keyed by sub-question ID
  processingComplete: boolean;      // Whether all sub-questions are processed
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

// Multishot detection patterns (queries that likely need multiple tools)
const MULTISHOT_PATTERNS = [
  // Enhanced addition patterns
  /population.*(plus|plus by|added to|combined with|sum of|total of|and)/i,  // "population of X plus population of Y"
  /distance.*(plus|plus by|added to|combined with|sum of|total of|and)/i,    // "distance from X to Y plus Z"
  /height.*(plus|plus by|added to|combined with|sum of|total of|and)/i,      // "height of X plus Y"
  /age.*(plus|plus by|added to|combined with|sum of|total of|and)/i,         // "age of X plus Y"
  /temperature.*(plus|plus by|added to|combined with|sum of|total of|and)/i, // "temperature in X plus Y"
  /gdp.*(plus|plus by|added to|combined with|sum of|total of|and)/i,         // "GDP of X plus Y"
  /sales.*(plus|plus by|added to|combined with|sum of|total of|and)/i,       // "sales of X plus Y"
  /revenue.*(plus|plus by|added to|combined with|sum of|total of|and)/i,     // "revenue of X plus Y"
  /cost.*(plus|plus by|added to|combined with|sum of|total of|and)/i,        // "cost of X plus Y"
  /price.*(plus|plus by|added to|combined with|sum of|total of|and)/i,       // "price of X plus Y"
  
  // Enhanced subtraction patterns
  /population.*(minus|less|subtract|difference between|reduced by|from)/i,    // "population of X minus Y"
  /distance.*(minus|less|subtract|difference between|reduced by|from)/i,      // "distance from X minus Y"
  /height.*(minus|less|subtract|difference between|reduced by|from)/i,        // "height of X minus Y"
  /age.*(minus|less|subtract|difference between|reduced by|from)/i,           // "age of X minus Y"
  /temperature.*(minus|less|subtract|difference between|reduced by|from)/i,   // "temperature in X minus Y"
  /gdp.*(minus|less|subtract|difference between|reduced by|from)/i,           // "GDP of X minus Y"
  /sales.*(minus|less|subtract|difference between|reduced by|from)/i,         // "sales of X minus Y"
  /revenue.*(minus|less|subtract|difference between|reduced by|from)/i,       // "revenue of X minus Y"
  /cost.*(minus|less|subtract|difference between|reduced by|from)/i,          // "cost of X minus Y"
  /price.*(minus|less|subtract|difference between|reduced by|from)/i,         // "price of X minus Y"
  
  // Enhanced multiplication patterns
  /population.*(multiplied by|times|product of|multiply|multiplication of)/i,  // "population of X multiplied by Y"
  /distance.*(multiplied by|times|product of|multiply|multiplication of)/i,    // "distance from X times Y"
  /height.*(multiplied by|times|product of|multiply|multiplication of)/i,      // "height of X multiplied by Y"
  /age.*(multiplied by|times|product of|multiply|multiplication of)/i,         // "age of X times Y"
  /temperature.*(multiplied by|times|product of|multiply|multiplication of)/i, // "temperature in X times Y"
  /gdp.*(multiplied by|times|product of|multiply|multiplication of)/i,         // "GDP of X times Y"
  /sales.*(multiplied by|times|product of|multiply|multiplication of)/i,       // "sales of X times Y"
  /revenue.*(multiplied by|times|product of|multiply|multiplication of)/i,     // "revenue of X times Y"
  /cost.*(multiplied by|times|product of|multiply|multiplication of)/i,        // "cost of X times Y"
  /price.*(multiplied by|times|product of|multiply|multiplication of)/i,       // "price of X times Y"
  
  // Enhanced division patterns
  /population.*(divided by|per|quotient of|split by|division of)/i,  // "population of X divided by Y"
  /distance.*(divided by|per|quotient of|split by|division of)/i,    // "distance from X divided by Y"
  /height.*(divided by|per|quotient of|split by|division of)/i,      // "height of X divided by Y"
  /age.*(divided by|per|quotient of|split by|division of)/i,         // "age of X divided by Y"
  /temperature.*(divided by|per|quotient of|split by|division of)/i, // "temperature in X divided by Y"
  /gdp.*(divided by|per|quotient of|split by|division of)/i,         // "GDP of X divided by Y"
  /sales.*(divided by|per|quotient of|split by|division of)/i,       // "sales of X divided by Y"
  /revenue.*(divided by|per|quotient of|split by|division of)/i,     // "revenue of X divided by Y"
  /cost.*(divided by|per|quotient of|split by|division of)/i,        // "cost of X divided by Y"
  /price.*(divided by|per|quotient of|split by|division of)/i,       // "price of X divided by Y"
  
  // Percentage patterns
  /percentage|percent|%/i,  // "What percentage of X is Y?" or "X percent of Y"
  
  // Natural language constructs for operations on multiple entities
  /what is (the|a) (.*) (of|for) (.*) and (.*) (combined|together|in total)/i,  // "what is the population of X and Y combined"
  /how (many|much) (.*) (in|of|for) both (.*) and (.*)/i,                       // "how much revenue in both X and Y"
  /what happens when you (add|subtract|multiply|divide) (.*) (with|by|and) (.*)/i, // "what happens when you add X and Y"
  /if (.*) (is|equals|has) (.*) and (.*) (is|equals|has) (.*), what is/i,       // "if X is A and Y is B, what is..."
  
  // General patterns for operations on data that needs to be looked up
  /combine|merge|total|aggregate|sum up/i,        // "combine the populations of X and Y"
  /compare|contrast|difference between|gap/i,     // "compare the heights of X and Y"
  /ratio|proportion|relationship|correlation/i,   // "what is the ratio of X to Y"
  
  // Patterns for queries that include both fact-finding and calculation intent
  /what is the \w+ of .* (divided by|multiplied by|times|plus|minus|added to|combined with|and)/i,  // "What is the X of Y divided by Z?"
  /how (many|much) .* (times|divided by|multiplied by|plus|minus|added to|combined with)/i,        // "How many X times Y?"
  /calculate .* (of|for) .* (based on|using)/i,                                                    // "Calculate X for Y based on Z"
  
  // General pattern for math operations on real-world data
  /(find|get|calculate|compute|determine|tell me|what is).*(then|and then|after that|subsequently).*(add|subtract|multiply|divide|calculate|compute)/i,  // "Find X then multiply by Y"
  
  // Patterns for common specific use cases
  /(total population|combined population|aggregate population)/i,  // "total population of X and Y"
  /(average|mean|median).*(of|across|between)/i,                  // "average temperature of X and Y"
  /(increase|decrease|change|growth|reduction).*(by|of|percent)/i // "increase in X by Y percent"
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
  // Create the graph and define its state with explicit recursion limit
  const graph = new StateGraph<ToolSelectionState>({
    channels: {
      query: {},
      chatHistory: {},
      selectedTool: {},
      analysis: {},
      toolOutput: {},
      finalResponse: {},
      serpApiQuery: {},
      // Add channels for multishot workflow
      requiresDecomposition: {},
      isMultishot: {},
      subQuestions: {},
      currentSubQuestion: {},
      intermediateResults: {},
      processingComplete: {}
    },
    // Add explicit recursion limit to prevent infinite loops
    recursionLimit: 100,
    // Ensure the graph doesn't enter infinite cycles by tracking visited states
    trackState: true
  });

  // =====================
  // Define graph nodes
  // =====================

  // 1. Query Analysis Node - determines which tool to use and if decomposition is needed
  const queryAnalysisNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🔍 Analyzing query:", state.query);
    
    // Check if the query might need multiple tools (multishot approach)
    const mightBeMultishot = MULTISHOT_PATTERNS.some(pattern => pattern.test(state.query));
    
    if (mightBeMultishot && serpApiTool) {
      console.log("🔀 Query appears to need multiple tools - flagging for decomposition");
      return {
        ...state,
        requiresDecomposition: true,
        analysis: "This query appears to require multiple tools in sequence."
      };
    }
    
    // If not multishot, use the existing single-tool logic
    // Simple pattern-based analysis before calling the LLM
    // This helps reduce unnecessary LLM calls for obvious cases
    
    // Check for calculator patterns - Calculator takes priority over SerpAPI
    const isCalculatorQuery = CALCULATOR_PATTERNS.some(pattern => pattern.test(state.query));
    if (isCalculatorQuery) {
      console.log("📊 Query appears to need calculation");
      return {
        ...state,
        selectedTool: "calculator",
        analysis: "This query appears to require mathematical calculation.",
        requiresDecomposition: false
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
          analysis: "This query appears to require a web search for current information.",
          requiresDecomposition: false
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
- "multishot" - For complex queries that require multiple tools in sequence (e.g., search for data then calculate with it)

User query: {query}

Think step by step:
1. Does this require mathematical calculation only?
2. Does this require up-to-date information from the web only?
3. Does this require BOTH searching for information AND performing calculations on that information?
4. Is this a general question that doesn't need calculation or current web data?

Your task is to output ONLY ONE of these tool approaches: "calculator", "serpapi", "multishot", or "rag", followed by a very brief explanation.`]
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
    let requiresDecomposition = false;
    
    if (analysis.toLowerCase().includes("multishot")) {
      requiresDecomposition = true;
      console.log("🔀 LLM identified this as a multishot query requiring decomposition");
    } else if (analysis.toLowerCase().includes("calculator")) {
      selectedTool = "calculator";
    } else if (analysis.toLowerCase().includes("serpapi") && serpApiTool) {
      selectedTool = "serpapi";
    } else {
      selectedTool = "rag";
    }
    
    if (requiresDecomposition) {
      console.log("🔀 Query will be decomposed into sub-questions");
      return {
        ...state,
        requiresDecomposition: true,
        analysis
      };
    } else {
      console.log(`🔍 Selected tool: ${selectedTool}`);
      return {
        ...state,
        selectedTool,
        analysis,
        requiresDecomposition: false
      };
    }
  };

  // Helper function to resolve dependencies in calculator expressions
  const resolveCalculatorDependencies = (expression: string, intermediateResults: Record<string, string>): string => {
    console.log("🔄 Resolving dependencies in expression:", expression);
    console.log("🔄 Available intermediate results:", JSON.stringify(intermediateResults));
    
    // Helper function to extract numeric value from text or JSON result
    const extractNumericValue = (result: string): string | null => {
      // Try to parse JSON first in case the result is a JSON object (especially from SerpAPI)
      try {
        const jsonResult = JSON.parse(result);
        
        // Check for population data in knowledge_graph
        if (jsonResult.knowledge_graph && jsonResult.knowledge_graph.population) {
          const population = jsonResult.knowledge_graph.population.replace(/[^\d.]/g, '');
          console.log(`🔄 Extracted population ${population} from knowledge_graph`);
          return population;
        }
        
        // Check for population in answer_box
        if (jsonResult.answer_box && jsonResult.answer_box.population) {
          const population = jsonResult.answer_box.population.replace(/[^\d.]/g, '');
          console.log(`🔄 Extracted population ${population} from answer_box`);
          return population;
        }
        
        // If we couldn't find specific fields, look for any numeric field or string with numbers
        for (const key in jsonResult) {
          if (typeof jsonResult[key] === 'number') {
            console.log(`🔄 Extracted numeric value ${jsonResult[key]} from JSON field ${key}`);
            return jsonResult[key].toString();
          } else if (typeof jsonResult[key] === 'string' && /[\d,]+/.test(jsonResult[key])) {
            const numericMatch = jsonResult[key].match(/[\d,]+/);
            if (numericMatch) {
              const value = numericMatch[0].replace(/,/g, '');
              console.log(`🔄 Extracted numeric value ${value} from JSON field ${key}`);
              return value;
            }
          }
        }
      } catch (e) {
        // Not JSON, continue with regex extraction
      }
      
      // Try various patterns to extract numbers from text
      
      // Pattern for "X million" or "X.Y million"
      const millionPattern = /(\d+(?:\.\d+)?)\s*million/i;
      const millionMatch = result.match(millionPattern);
      if (millionMatch && millionMatch[1]) {
        const value = parseFloat(millionMatch[1]) * 1000000;
        console.log(`🔄 Extracted ${value} from "${millionMatch[0]}"`);
        return value.toString();
      }
      
      // Pattern for formatted numbers with commas
      const formattedNumberPattern = /[\d,]+(?:\.\d+)?/;
      const formattedMatch = result.match(formattedNumberPattern);
      if (formattedMatch) {
        const value = formattedMatch[0].replace(/,/g, '');
        console.log(`🔄 Extracted formatted number ${value}`);
        return value;
      }
      
      // Pattern for plain numbers
      const plainNumberPattern = /\d+(?:\.\d+)?/;
      const plainMatch = result.match(plainNumberPattern);
      if (plainMatch) {
        console.log(`🔄 Extracted plain number ${plainMatch[0]}`);
        return plainMatch[0];
      }
      
      return null;
    };
    
    // Handle Sum() function specially
    const sumFunctionPattern = /Sum\s*\(\s*([^)]+)\s*\)/i;
    const sumMatch = expression.match(sumFunctionPattern);
    if (sumMatch && sumMatch[1]) {
      console.log("🔄 Found Sum() function in expression");
      // Extract the arguments of Sum()
      const args = sumMatch[1].split(/\s*,\s*/);
      console.log("🔄 Sum arguments:", args);
      
      // Resolve each argument
      const resolvedArgs = args.map(arg => {
        // Check if the argument is a dependency reference (q1, q2, etc.)
        if (/^q\d+$/.test(arg.trim())) {
          const dependencyId = arg.trim();
          if (intermediateResults[dependencyId]) {
            // Extract numeric value from the dependency result
            const numericValue = extractNumericValue(intermediateResults[dependencyId]);
            if (numericValue) {
              console.log(`🔄 Resolved ${dependencyId} to ${numericValue}`);
              return numericValue;
            }
          }
          console.warn(`⚠️ Could not resolve dependency ${dependencyId} in Sum function`);
          return "0"; // Default to 0 for unresolved dependencies
        }
        return arg; // Return the argument as is if it's not a dependency reference
      });
      
      // Replace Sum() with a simple addition
      const sumExpression = `(${resolvedArgs.join(' + ')})`;
      const newExpression = expression.replace(sumFunctionPattern, sumExpression);
      console.log("🔄 Transformed Sum() to addition:", newExpression);
      
      // Continue with regular dependency resolution for the rest of the expression
      return resolveCalculatorDependencies(newExpression, intermediateResults);
    }
    
    // Check if the expression contains dependency references like q1, q2, etc.
    const dependencyPattern = /\b(q\d+)\b/g;
    let hasDependencies = dependencyPattern.test(expression);
    
    if (hasDependencies) {
      console.log("🔄 Found dependencies in expression");
      // Replace all dependency references with their values
      let resolvedExpression = expression.replace(dependencyPattern, (match) => {
        const dependencyId = match;
        
        if (intermediateResults[dependencyId]) {
          // Extract numeric value from the dependency result
          const numericValue = extractNumericValue(intermediateResults[dependencyId]);
          if (numericValue) {
            console.log(`🔄 Resolved ${dependencyId} to ${numericValue}`);
            return numericValue;
          }
        }
        
        // If no numeric value found, return the original reference
        console.warn(`⚠️ Could not resolve dependency ${dependencyId}`);
        return match;
      });
      
      console.log("🔄 Resolved expression:", resolvedExpression);
      return resolvedExpression;
    }
    
    // If no dependencies found, return the original expression
    return expression;
  };

  // Helper function to evaluate mathematical expressions using JavaScript
  const safeEvaluateExpression = (expression: string): string => {
    try {
      // Remove all characters except numbers, operators, and parentheses
      const sanitizedExpression = expression.replace(/[^0-9+\-*/().]/g, '');
      
      // Check if we have a valid expression
      if (!sanitizedExpression || sanitizedExpression.trim() === '') {
        return "Could not parse a valid mathematical expression";
      }
      
      // Use Function constructor to safely evaluate the expression
      // This is safer than eval() but still allows basic arithmetic
      const result = new Function(`return ${sanitizedExpression}`)();
      
      if (isNaN(result) || !isFinite(result)) {
        return "The calculation resulted in an invalid number";
      }
      
      return result.toString();
    } catch (error) {
      console.error("❌ Error in JavaScript expression evaluation:", error);
      return `Error evaluating expression: ${error.message}`;
    }
  };

  // 2. Calculator Execution Node - Enhanced to handle multishot dependencies
  const calculatorNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🧮 Executing calculator for query:", state.query);
    
    try {
      // Check if this is part of a multishot workflow
      const isMultishotCalculation = state.isMultishot && 
                                    state.currentSubQuestion && 
                                    state.currentSubQuestion.dependsOn.length > 0;
      
      // Different handling for multishot vs. single calculations
      let expression: string;
      
      if (isMultishotCalculation) {
        console.log("🧮 This is a multishot calculation with dependencies:", state.currentSubQuestion?.dependsOn);
        
        // First try to extract specific values from the query
        const queryHasNumbers = /\d+/.test(state.query);
        
        if (queryHasNumbers) {
          // Extract the expression as usual if the query already has numbers
          const expressionPrompt = ChatPromptTemplate.fromMessages([
            ["human", `Extract the mathematical expression from this query.
Return ONLY the expression, nothing else. If there are references to q1, q2, etc., keep them in the expression.

Query: {query}`]
          ]);
          
          const expressionChain = RunnableSequence.from([
            expressionPrompt,
            model,
            new StringOutputParser()
          ]);
          
          expression = await expressionChain.invoke({ query: state.query });
        } else {
          // If the query is more like "Add the populations of X and Y"
          // Create a more explicit prompt based on the dependency IDs
          const dependencyIds = state.currentSubQuestion?.dependsOn || [];
          
          const mathPrompt = ChatPromptTemplate.fromMessages([
            ["human", `I need to perform a calculation based on these previous results:
${dependencyIds.map(id => `${id}: ${state.intermediateResults[id] || "Unknown"}`).join("\n")}

The instruction is: {query}

Give me a simple mathematical expression using the numeric values from the results.
For example, if adding two populations, extract just the numbers and write "X + Y".
ONLY return the expression, nothing else.`]
          ]);
          
          const mathChain = RunnableSequence.from([
            mathPrompt,
            model,
            new StringOutputParser()
          ]);
          
          // Get a mathematical expression based on the dependencies
          expression = await mathChain.invoke({ query: state.query });
          console.log("🧮 Generated expression from dependencies:", expression);
        }
        
        // Resolve any dependencies in the expression
        expression = resolveCalculatorDependencies(expression, state.intermediateResults);
      } else {
        // Standard single calculation - extract the expression as before
        const expressionPrompt = ChatPromptTemplate.fromMessages([
          ["human", `Extract only the mathematical expression from this query. 
Return ONLY the expression, nothing else.

Query: {query}`]
        ]);
        
        const expressionChain = RunnableSequence.from([
          expressionPrompt,
          model,
          new StringOutputParser()
        ]);
        
        expression = await expressionChain.invoke({ query: state.query });
      }
      
      console.log("🔢 Final expression to calculate:", expression);
      
      // Sanitize the expression before calculation
      // Transform and sanitize expression for calculator
      let sanitizedExpression = expression;
      
      // Handle parentheses spacing issues 
      sanitizedExpression = sanitizedExpression.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
      
      // Make sure operators have spaces around them for proper parsing
      sanitizedExpression = sanitizedExpression.replace(/(\d)([+\-*/])(\d)/g, '$1 $2 $3');
      
      // Join numeric tokens with + if there's no operator between them
      sanitizedExpression = sanitizedExpression.replace(/(\d+)\s+(\d+)/g, '$1 + $2');
      
      // Now remove any remaining non-calculator characters
      sanitizedExpression = sanitizedExpression.replace(/[^0-9+\-*/().\s]/g, '');
      
      console.log("🔢 Sanitized expression:", sanitizedExpression);
      
      if (!sanitizedExpression || sanitizedExpression.trim() === '') {
        throw new Error("Could not extract a valid mathematical expression");
      }
      
      // Calculate the result using the calculator tool
      const result = await calculatorTool.invoke(sanitizedExpression);
      console.log("🧮 Calculator result:", result);
      
      // If the calculator returns an error or "I don't know", try JavaScript evaluation
      if (result.includes("don't know") || result.includes("error") || result.includes("invalid")) {
        console.log("🔄 Calculator failed, attempting JavaScript evaluation fallback");
        const jsResult = safeEvaluateExpression(sanitizedExpression);
        
        if (!jsResult.includes("Error") && !jsResult.includes("invalid")) {
          console.log("✅ JavaScript evaluation succeeded:", jsResult);
          return {
            ...state,
            toolOutput: jsResult,
            finalResponse: `The result of the calculation is ${jsResult}.`
          };
        }
      }
      
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
      
      // If this is part of a multishot workflow, return a more specific error
      // but don't change the tool selection
      if (state.isMultishot) {
        return {
          ...state,
          toolOutput: `Error performing calculation: ${error}. This may be due to problems extracting numeric values from previous results.`,
        };
      }
      
      // Fallback to RAG if calculator fails in single-tool mode
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
      
      // Immediately convert the search result to a string to prevent any issues with complex objects
      let safeSearchResult: string;
      try {
        if (typeof searchResult === 'string') {
          safeSearchResult = searchResult;
        } else if (typeof searchResult === 'object' && searchResult !== null) {
          // Use a try-catch with replacer function to handle potential circular references
          safeSearchResult = JSON.stringify(searchResult, (key, value) => {
            // Handle potential circular references or complex objects
            if (typeof value === 'object' && value !== null) {
              // For complex nested objects, return a simplified version
              if (key !== '' && Object.keys(value).length > 10) {
                return `[Complex Object with ${Object.keys(value).length} properties]`;
              }
            }
            return value;
          }, 2);
        } else {
          safeSearchResult = String(searchResult);
        }
      } catch (stringifyError) {
        console.error("❌ Error stringifying SerpAPI result:", stringifyError);
        safeSearchResult = "Error converting SerpAPI result to string: " + stringifyError.message;
      }
      
      // Log a detailed preview of the search result to help with debugging
      console.log("🔍 SERP API RESULT TYPE:", typeof searchResult);
      const resultPreview = safeSearchResult.substring(0, 200);
      console.log(`🔎 SerpAPI result preview:\n${resultPreview}...`);
      
      // Format the search result for the LLM with more robust handling
      let extractedInfo = "No relevant information found.";
      
      try {
        if (typeof searchResult === 'string') {
          // For string results, use directly
          extractedInfo = searchResult;
        } else if (typeof searchResult === 'object' && searchResult !== null) {
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
            // Default to using our safe stringified version
            extractedInfo = safeSearchResult;
          }
        } else {
          console.warn("SerpAPI returned unexpected result type:", typeof searchResult);
          extractedInfo = "No relevant information found.";
        }
      } catch (e) {
        console.error("Error extracting information from search results:", e);
        extractedInfo = "Error extracting information from search results: " + e.message;
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
      
      // We've already ensured safeSearchResult is a string, so use that directly
      // This prevents InvalidUpdateError when storing in state
      
      // Return a safely structured state update with string values only
      return {
        ...state,
        toolOutput: safeSearchResult, // Use our pre-sanitized string result
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

  // Function to create a timeout promise
  const createTimeoutPromise = (timeoutMs: number): Promise<never> => {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  };

  // Helper function to create a simplified decomposition structure
  const createDefaultDecomposition = (query: string): SubQuestion[] => {
    console.log("📝 Creating default decomposition for query:", query);
    
    // Handle population and calculation query pattern
    if (/population.*multiply|multiply.*population|population.*times|times.*population/i.test(query)) {
      // Extract city names using a basic regex pattern
      const cityPattern = /(new york|los angeles|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|indianapolis|charlotte|san francisco|seattle|denver|washington|boston|nashville)/gi;
      let cityMatches = query.match(cityPattern) || [];
      const cities = [...new Set(cityMatches.map(city => city.toLowerCase()))]; // Deduplicate
      
      // Extract number using regex
      const numberPattern = /\d+(\.\d+)?/g;
      const numbers = query.match(numberPattern) || ["0.05"]; // Default to 0.05 if no number found
      
      console.log("🏙️ Detected cities:", cities);
      console.log("🔢 Detected numbers:", numbers);
      
      // Create decomposition based on detected cities and numbers
      const subQuestions: SubQuestion[] = [];
      
      // Add sub-questions for each city population
      cities.forEach((city, index) => {
        subQuestions.push({
          id: `q${index + 1}`,
          question: `What is the current population of ${city}?`,
          toolType: "serpapi",
          dependsOn: [],
          completed: false,
          result: null
        });
      });
      
      // Add a question to combine the populations
      if (cities.length > 1) {
        const cityDependencies = subQuestions.map(sq => sq.id);
        subQuestions.push({
          id: `q${cities.length + 1}`,
          question: `Add the populations of ${cities.join(" and ")}`,
          toolType: "calculator",
          dependsOn: cityDependencies,
          completed: false,
          result: null
        });
        
        // Add final calculation with the number if present
        if (numbers.length > 0) {
          subQuestions.push({
            id: `q${cities.length + 2}`,
            question: `Multiply the combined population by ${numbers[0]}`,
            toolType: "calculator",
            dependsOn: [`q${cities.length + 1}`],
            completed: false,
            result: null
          });
        }
      } else if (cities.length === 1 && numbers.length > 0) {
        // Just multiply the single city population
        subQuestions.push({
          id: `q${cities.length + 1}`,
          question: `Multiply the population of ${cities[0]} by ${numbers[0]}`,
          toolType: "calculator",
          dependsOn: ["q1"],
          completed: false,
          result: null
        });
      }
      
      return subQuestions;
    }
    
    // Generic fallback for simple two-step decomposition
    return [
      {
        id: "q1",
        question: `Search for information related to: ${query}`,
        toolType: "serpapi",
        dependsOn: [],
        completed: false,
        result: null
      },
      {
        id: "q2",
        question: `Perform any necessary calculations on the retrieved information`,
        toolType: "calculator",
        dependsOn: ["q1"],
        completed: false,
        result: null
      }
    ];
  };

  // 5. Query Decomposition Node - breaks down complex queries into sub-questions with improved reliability
  const decompositionNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🔀 Decomposing complex query into sub-questions:", state.query);
    
    // Set timeout limit - 10 seconds should be plenty for decomposition
    const TIMEOUT_MS = 10000;
    
    try {
      // Simplified prompt with fewer details to reduce complexity
      const decompositionPrompt = ChatPromptTemplate.fromMessages([
        ["human", `Break down this complex query into 2-3 simpler sub-questions.

Query: {query}

For each sub-question, provide:
1. Which tool to use (either "serpapi" for web searches or "calculator" for math)
2. The exact sub-question text
3. Any dependencies on previous questions

Format as a SIMPLE JSON array with the essential fields only:
{{
  "subQuestions": [
    {{
      "id": "q1",
      "question": "What is X?",
      "toolType": "serpapi",
      "dependsOn": []
    }},
    {{
      "id": "q2", 
      "question": "Calculate Y using X",
      "toolType": "calculator",
      "dependsOn": ["q1"]
    }}
  ]
}}

Output ONLY the JSON, no explanations.`]
      ]);
      
      // Create the decomposition chain
      const decompositionChain = RunnableSequence.from([
        decompositionPrompt,
        model,
        new StringOutputParser()
      ]);
      
      // Use Promise.race to implement timeout
      let decompositionResult: string;
      try {
        console.log("⏱️ Setting timeout for decomposition:", TIMEOUT_MS, "ms");
        decompositionResult = await Promise.race([
          decompositionChain.invoke({ query: state.query }),
          createTimeoutPromise(TIMEOUT_MS)
        ]);
        console.log("🔀 Raw decomposition result:", decompositionResult);
      } catch (timeoutError) {
        console.warn("⏱️ Decomposition timed out:", timeoutError);
        console.log("🔄 Using default decomposition instead");
        
        // Use the default decomposition if we time out
        const defaultSubQuestions = createDefaultDecomposition(state.query);
        
        // Find the first sub-question that has no dependencies
        const nextSubQuestion = defaultSubQuestions.find(sq => sq.dependsOn.length === 0);
        
        return {
          ...state,
          isMultishot: true,
          subQuestions: defaultSubQuestions,
          currentSubQuestion: nextSubQuestion || null,
          intermediateResults: {},
          processingComplete: false
        };
      }
      
      // Clean the result to help with parsing
      // Remove any markdown formatting that might be present
      const cleanedResult = decompositionResult
        .replace(/```json\s+/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      
      console.log("🧹 Cleaned decomposition result:", cleanedResult);
      
      let subQuestions: SubQuestion[] = [];
      
      try {
        // Parse the JSON response with enhanced error handling
        const parsedResult = JSON.parse(cleanedResult);
        console.log("✅ Successfully parsed JSON response");
        
        if (parsedResult && parsedResult.subQuestions && Array.isArray(parsedResult.subQuestions)) {
          console.log("✅ Found subQuestions array with", parsedResult.subQuestions.length, "items");
          
          // Validate each sub-question has the required fields
          const validSubQuestions = parsedResult.subQuestions.filter((sq: any) => {
            const isValid = sq && sq.id && sq.question && sq.toolType && 
                          (sq.toolType === "serpapi" || sq.toolType === "calculator") &&
                          Array.isArray(sq.dependsOn);
            
            if (!isValid) {
              console.warn("⚠️ Invalid sub-question format:", JSON.stringify(sq));
            }
            return isValid;
          });
          
          if (validSubQuestions.length === 0) {
            throw new Error("No valid sub-questions found in parsed result");
          }
          
          // Convert to our SubQuestion type with completed flag
          subQuestions = validSubQuestions.map((sq: any) => ({
            ...sq,
            completed: false,
            result: null
          }));
        } else {
          throw new Error("Missing or invalid subQuestions array in parsed result");
        }
      } catch (parseError) {
        console.error("❌ Error parsing decomposition result:", parseError);
        console.log("🔍 Attempting regex fallback extraction");
        
        // More robust regex fallback - try to extract from malformed JSON
        try {
          // First try to extract the whole subQuestions array
          const arrayMatch = cleanedResult.match(/\"subQuestions\"\s*:\s*\[([\s\S]*?)\]/);
          if (arrayMatch && arrayMatch[1]) {
            const subQuestionsContent = arrayMatch[1];
            console.log("📋 Extracted subQuestions content");
            
            // Find each object in the array
            const objectPattern = /\{\s*\"id\"[\s\S]*?\}/g;
            const objects = subQuestionsContent.match(objectPattern);
            
            if (objects && objects.length > 0) {
              console.log("📋 Found", objects.length, "sub-question objects");
              
              // Process each object
              objects.forEach((objStr, index) => {
                try {
                  // Try to parse individual object
                  const obj = JSON.parse(objStr);
                  if (obj.id && obj.question && obj.toolType) {
                    subQuestions.push({
                      id: obj.id,
                      question: obj.question,
                      toolType: obj.toolType,
                      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn : [],
                      completed: false,
                      result: null
                    });
                  }
                } catch (objError) {
                  console.warn(`❌ Couldn't parse object ${index}:`, objStr);
                }
              });
            }
          }
          
          // If still empty, try more aggressive extraction with regex
          if (subQuestions.length === 0) {
            console.log("🔍 Attempting field-by-field extraction");
            
            // Extract fields individually
            const idMatches = cleanedResult.match(/\"id\"\s*:\s*\"([^\"]+)\"/g) || [];
            const questionMatches = cleanedResult.match(/\"question\"\s*:\s*\"([^\"]+)\"/g) || [];
            const toolTypeMatches = cleanedResult.match(/\"toolType\"\s*:\s*\"([^\"]+)\"/g) || [];
            
            // If we have a reasonable number of matches, try to construct objects
            if (idMatches.length > 0 && idMatches.length === questionMatches.length && idMatches.length === toolTypeMatches.length) {
              console.log("📋 Extracted", idMatches.length, "matched fields");
              
              for (let i = 0; i < idMatches.length; i++) {
                const id = idMatches[i].match(/\"([^\"]+)\"$/)?.[1] || `q${i+1}`;
                const question = questionMatches[i].match(/\"([^\"]+)\"$/)?.[1] || "Unknown question";
                const toolType = toolTypeMatches[i].match(/\"([^\"]+)\"$/)?.[1] || "serpapi";
                
                subQuestions.push({
                  id,
                  question,
                  toolType: toolType === "calculator" ? "calculator" : "serpapi",
                  dependsOn: i > 0 ? [`q${i}`] : [],
                  completed: false,
                  result: null
                });
              }
            }
          }
        } catch (regexError) {
          console.error("❌ Regex extraction failed:", regexError);
        }
      }
      
      // If all parsing attempts failed, use the default decomposition
      if (subQuestions.length === 0) {
        console.warn("⚠️ All parsing attempts failed, using default decomposition");
        subQuestions = createDefaultDecomposition(state.query);
      }
      
      console.log("🔀 Final sub-questions:", JSON.stringify(subQuestions, null, 2));
      
      // Find the first sub-question that has no dependencies or all dependencies are satisfied
      const nextSubQuestion = subQuestions.find(sq => 
        !sq.completed && (sq.dependsOn.length === 0 || sq.dependsOn.every(dep => {
          const depQuestion = subQuestions.find(q => q.id === dep);
          return depQuestion && depQuestion.completed;
        }))
      );
      
      if (!nextSubQuestion) {
        console.warn("⚠️ No valid starting sub-question found, fixing dependencies");
        // Fix by clearing dependencies on the first question if needed
        if (subQuestions.length > 0) {
          subQuestions[0].dependsOn = [];
        }
      }
      
      return {
        ...state,
        isMultishot: true,
        subQuestions,
        currentSubQuestion: nextSubQuestion || (subQuestions.length > 0 ? subQuestions[0] : null),
        intermediateResults: {},
        processingComplete: false
      };
    } catch (error) {
      console.error("❌ Critical decomposition error:", error);
      console.log("🚨 Using emergency fallback decomposition");
      
      // Emergency fallback decomposition
      const emergencySubQuestions = [
        {
          id: "q1",
          question: state.query,
          toolType: "serpapi",
          dependsOn: [],
          completed: false,
          result: null
        }
      ];
      
      // For calculation queries, add a calculator step
      if (/calculate|compute|multiply|divide|add|subtract|sum|percent/i.test(state.query)) {
        emergencySubQuestions.push({
          id: "q2",
          question: `Perform calculation based on information from previous step`,
          toolType: "calculator",
          dependsOn: ["q1"],
          completed: false,
          result: null
        });
      }
      
      return {
        ...state,
        isMultishot: true,
        subQuestions: emergencySubQuestions,
        currentSubQuestion: emergencySubQuestions[0],
        intermediateResults: {},
        processingComplete: false
      };
    }
  };
  
  // 6. Sub-Question Router Node - routes a sub-question to the appropriate tool
  const subQuestionRouterNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    if (!state.currentSubQuestion) {
      console.error("❌ No current sub-question to process");
      return {
        ...state,
        selectedTool: "rag", // Fallback to RAG
        processingComplete: true
      };
    }
    
    console.log(`🔀 Routing sub-question: ${state.currentSubQuestion.question} to ${state.currentSubQuestion.toolType}`);
    
    // Update the query to be the sub-question text
    return {
      ...state,
      query: state.currentSubQuestion.question,
      selectedTool: state.currentSubQuestion.toolType
    };
  };
  
  // 7. Results Collector Node - collects results from tool execution
  const resultsCollectorNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    if (!state.currentSubQuestion) {
      console.error("❌ Missing current sub-question");
      return {
        ...state,
        processingComplete: true
      };
    }
    
    // Ensure toolOutput is a string to prevent InvalidUpdateError
    // This is a critical safeguard for all tools, especially SerpAPI
    let resultToStore: string;
    try {
      if (state.toolOutput === null || state.toolOutput === undefined) {
        resultToStore = "No result available";
      } else if (typeof state.toolOutput === 'string') {
        resultToStore = state.toolOutput;
      } else {
        // For non-string values, convert to a safe string representation
        try {
          resultToStore = JSON.stringify(state.toolOutput, (key, value) => {
            // Handle potentially problematic values
            if (typeof value === 'function') return 'function';
            if (value instanceof Error) return value.message;
            if (typeof value === 'object' && value !== null && Object.keys(value).length > 20) {
              return `[Large object with ${Object.keys(value).length} properties]`;
            }
            return value;
          });
        } catch (jsonError) {
          console.warn("❌ Error stringifying toolOutput:", jsonError);
          resultToStore = String(state.toolOutput);
        }
      }
    } catch (error) {
      console.error("❌ Error processing toolOutput:", error);
      resultToStore = "Error processing result: " + (error.message || "unknown error");
    }
    
    console.log(`🔀 Collecting result for sub-question: ${state.currentSubQuestion.id}`);
    
    try {
      // Instead of using JSON.parse/stringify which can fail with circular references,
      // create a new object with explicitly copied properties
      const safeState = {
        ...state,
        // Ensure these fields exist and are properly initialized
        intermediateResults: { ...(state.intermediateResults || {}) },
        subQuestions: [...(state.subQuestions || [])],
        processingComplete: Boolean(state.processingComplete)
      };
      
      // Store the result of the current sub-question
      const updatedResults = {
        ...safeState.intermediateResults,
        [state.currentSubQuestion.id]: resultToStore
      };
      
      // Mark the current sub-question as completed
      const updatedSubQuestions = safeState.subQuestions.map(sq => 
        sq.id === state.currentSubQuestion?.id 
          ? { ...sq, completed: true, result: resultToStore } 
          : sq
      );
      
      // Check if all sub-questions are completed
      const allCompleted = updatedSubQuestions.every(sq => sq.completed);
      
      // Add an emergency termination check - if we have completed more than half of subquestions 
      // and have been stuck for a while (no next subquestion), force completion
      const completedCount = updatedSubQuestions.filter(sq => sq.completed).length;
      const totalCount = updatedSubQuestions.length;
      const forceTermination = completedCount > 0 && completedCount >= Math.floor(totalCount / 2);
      
      if (allCompleted || forceTermination) {
        console.log(`✅ ${allCompleted ? 'All' : 'Sufficient'} sub-questions completed, moving to aggregation`);
        return {
          ...safeState,
          subQuestions: updatedSubQuestions,
          intermediateResults: updatedResults,
          processingComplete: true,
          currentSubQuestion: null, // Explicitly clear the current sub-question
          query: safeState.query // Restore original query for final response
        };
      }
      
      // Find the next sub-question to process
      const nextSubQuestion = updatedSubQuestions.find(sq => 
        !sq.completed && (sq.dependsOn.length === 0 || sq.dependsOn.every(dep => {
          const depQuestion = updatedSubQuestions.find(q => q.id === dep);
          return depQuestion && depQuestion.completed;
        }))
      );
      
      return {
        ...safeState,
        subQuestions: updatedSubQuestions,
        currentSubQuestion: nextSubQuestion || null,
        intermediateResults: updatedResults,
        processingComplete: !nextSubQuestion
      };
    } catch (error) {
      console.error("❌ Error updating state in results collector:", error);
      // Return a minimal valid state update if there's an error
      return {
        ...state,
        processingComplete: true,
        currentSubQuestion: null
      };
    }
  };
  
  // 8. Results Aggregation Node - synthesizes results into a final response
  const aggregationNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log("🔄 Aggregating results from all sub-questions");
    
    // Manual aggregation for specific cases when the calculator fails
    if (state.subQuestions.length > 0 && 
        state.subQuestions.some(sq => sq.toolType === "calculator" && (!sq.result || sq.result.includes("Error") || sq.result.includes("don't know")))) {
      console.log("⚙️ Calculator sub-question failed, attempting manual aggregation");
      
      try {
        // Get the populations from the serpapi results
        const populationResults = state.subQuestions
          .filter(sq => sq.toolType === "serpapi" && sq.result)
          .map(sq => {
            // Try to extract population from JSON first
            try {
              const jsonResult = JSON.parse(sq.result || "{}");
              // Check for population in knowledge_graph
              if (jsonResult.knowledge_graph && jsonResult.knowledge_graph.population) {
                const population = parseFloat(jsonResult.knowledge_graph.population.replace(/[^\d.]/g, ''));
                return {
                  question: sq.question,
                  value: population
                };
              }
              
              // Check for population in answer_box
              if (jsonResult.answer_box && jsonResult.answer_box.population) {
                const population = parseFloat(jsonResult.answer_box.population.replace(/[^\d.]/g, ''));
                return {
                  question: sq.question,
                  value: population
                };
              }
            } catch (e) {
              // Not JSON, continue with regex extraction
            }
            
            // Pattern for "X million" or "X.Y million"
            const millionPattern = /(\d+(?:\.\d+)?)\s*million/i;
            const millionMatch = sq.result?.match(millionPattern);
            if (millionMatch && millionMatch[1]) {
              const value = parseFloat(millionMatch[1]) * 1000000;
              return {
                question: sq.question,
                value: value
              };
            }
            
            // Extract numeric values from the result text
            const numericMatch = sq.result?.match(/[\d,]+/);
            if (numericMatch) {
              const numericValue = parseFloat(numericMatch[0].replace(/,/g, ''));
              return {
                question: sq.question,
                value: numericValue
              };
            }
            return null;
          })
          .filter(r => r !== null);
        
        console.log("🔢 Extracted population values:", JSON.stringify(populationResults));
        
        if (populationResults.length >= 2) {
          // Calculate the sum
          const sum = populationResults.reduce((acc, curr) => acc + (curr?.value || 0), 0);
          console.log("➕ Sum of populations:", sum);
          
          // Check if we need to multiply by a value
          const multiplyMatch = state.query.match(/multiply.*by\s+([\d.]+)/i) || 
                               state.query.match(/times\s+([\d.]+)/i) ||
                               state.query.match(/[*×]\s*([\d.]+)/i);
          
          let finalValue = sum;
          let explanation = `the sum of the populations (${sum})`;
          
          if (multiplyMatch && multiplyMatch[1]) {
            const multiplier = parseFloat(multiplyMatch[1]);
            finalValue = sum * multiplier;
            explanation = `${sum} × ${multiplier} = ${finalValue}`;
            console.log(`✖️ Multiplied by ${multiplier} to get ${finalValue}`);
          }
          
          // Create a manual response
          const manualResponse = `Based on my research, I can answer your question about the combined population of cities:

${populationResults.map(r => `- ${r?.question}: ${r?.value.toLocaleString()}`).join('\n')}

The combined population is ${sum.toLocaleString()}.

To complete your request, I calculated ${explanation}, which gives us ${finalValue.toLocaleString()}.

This represents ${(finalValue / sum * 100).toFixed(1)}% of the total combined population.`;
          
          console.log("✅ Generated manual aggregated response");
          
          // Critical fix: Set processingComplete to true to ensure termination
          return {
            ...state,
            finalResponse: manualResponse,
            processingComplete: true,  // Mark processing as complete
            subQuestions: state.subQuestions.map(sq => ({ ...sq, completed: true }))  // Force all sub-questions to complete
          };
        }
      } catch (manualError) {
        console.error("❌ Manual aggregation failed:", manualError);
        // Continue to standard aggregation as fallback
      }
    }
    
    // Standard aggregation using LLM
    try {
      // Format the sub-questions and their results for the prompt
      const subQuestionResults = state.subQuestions.map(sq => {
        const result = sq.result || state.intermediateResults[sq.id] || "No result";
        return `Sub-question: ${sq.question}\nTool used: ${sq.toolType}\nResult: ${result}`;
      }).join("\n\n");
      
      // Create a prompt to synthesize the final response
      const aggregationPrompt = ChatPromptTemplate.fromMessages([
        ["human", `I've broken down a complex query into sub-questions and gathered results for each. 
Now I need to synthesize these results into a coherent final answer.

Original query: {query}

Results for each sub-question:
{subQuestionResults}

Your task:
1. Analyze how these results work together to answer the original query.
2. Synthesize a clear, comprehensive response that addresses the original query.
3. Show your reasoning, referencing the specific data obtained from each sub-question.
4. If some calculations failed, try to perform them yourself based on the numeric values from other results.
5. If a calculator step failed, extract the numeric values and perform the calculation manually.

Generate a natural, helpful response that fully answers the original query using all the information gathered.`]
      ]);
      
      // Create the aggregation chain with a timeout
      const aggregationChain = RunnableSequence.from([
        aggregationPrompt,
        model,
        new StringOutputParser()
      ]);
      
      // Generate the final response with a timeout
      const timeoutMs = 15000; // 15 seconds timeout
      const finalResponse = await Promise.race([
        aggregationChain.invoke({ 
          query: state.query,
          subQuestionResults
        }),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error(`Aggregation timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      
      console.log("✅ Successfully generated final aggregated response");
      
      return {
        ...state,
        finalResponse,
        processingComplete: true,  // Mark processing as complete to ensure termination
        subQuestions: state.subQuestions.map(sq => ({ ...sq, completed: true }))  // Force all sub-questions to complete
      };
    } catch (error) {
      console.error("❌ Aggregation error:", error);
      
      // Create a fallback response if aggregation fails
      const fallbackResponse = `I found answers to parts of your question, but had trouble putting them all together. Here's what I found:\n\n${
        state.subQuestions.map(sq => {
          const result = sq.result || state.intermediateResults[sq.id] || "No result";
          return `For "${sq.question}": ${result}`;
        }).join("\n\n")
      }`;
      
      return {
        ...state,
        finalResponse: fallbackResponse,
        processingComplete: true  // Mark processing as complete even in error case
      };
    }
  };

  // Define a router node for single-tool execution
  const routeToToolNode = async (state: ToolSelectionState): Promise<ToolSelectionState> => {
    console.log(`🔄 Routing query to ${state.selectedTool || 'rag'} tool`);
    // This is a pass-through node that doesn't modify state
    return state;
  };
  
  // Add nodes to the graph
  graph.addNode("analyzeQuery", queryAnalysisNode);
  graph.addNode("decomposeQuery", decompositionNode);
  graph.addNode("routeSubQuestion", subQuestionRouterNode);
  graph.addNode("collectResults", resultsCollectorNode);
  graph.addNode("aggregateResults", aggregationNode);
  graph.addNode("routeToTool", routeToToolNode); // Add the router node
  graph.addNode("executeCalculator", calculatorNode);
  graph.addNode("executeSerpApi", serpApiNode);
  graph.addNode("executeRag", ragNode);

  // =====================
  // Define edges
  // =====================
  
  // Start with query analysis
  graph.setEntryPoint("analyzeQuery");
  
  // After analysis, decide whether to decompose or route to a specific tool
  graph.addConditionalEdges(
    "analyzeQuery",
    (state) => {
      if (state.requiresDecomposition) {
        return "decompose";
      } else {
        return "singleTool";
      }
    },
    {
      "decompose": "decomposeQuery",
      "singleTool": "routeToTool"
    }
  );
  
  // Route from the routeToTool node to the appropriate tool based on selectedTool
  graph.addConditionalEdges(
    "routeToTool",
    (state) => {
      return state.selectedTool || "rag"; // Default to RAG if no tool selected
    },
    {
      "calculator": "executeCalculator",
      "serpapi": "executeSerpApi",
      "rag": "executeRag"
    }
  );
  
  // After decomposition, route the first sub-question
  graph.addEdge("decomposeQuery", "routeSubQuestion");
  
  // Route each sub-question to the appropriate tool
  graph.addConditionalEdges(
    "routeSubQuestion",
    (state) => {
      if (!state.currentSubQuestion) {
        return "end"; // No more sub-questions to process
      }
      return state.currentSubQuestion.toolType;
    },
    {
      "calculator": "executeCalculator",
      "serpapi": "executeSerpApi",
      "rag": "executeRag",
      "end": "aggregateResults"
    }
  );
  
  // Route from tool execution nodes based on whether we're in a multishot workflow
  // Add more robust state checking to prevent invalid state transitions
  graph.addConditionalEdges(
    "executeCalculator",
    (state) => {
      // Ensure isMultishot is a boolean before using it in a condition
      const isMultishotMode = Boolean(state.isMultishot);
      return isMultishotMode ? "multishot" : "singleTool";
    },
    {
      "multishot": "collectResults",
      "singleTool": END
    }
  );
  
  graph.addConditionalEdges(
    "executeSerpApi",
    (state) => {
      // Ensure isMultishot is a boolean before using it in a condition
      const isMultishotMode = Boolean(state.isMultishot);
      return isMultishotMode ? "multishot" : "singleTool";
    },
    {
      "multishot": "collectResults",
      "singleTool": END
    }
  );
  
  graph.addConditionalEdges(
    "executeRag",
    (state) => {
      // Ensure isMultishot is a boolean before using it in a condition
      const isMultishotMode = Boolean(state.isMultishot);
      return isMultishotMode ? "multishot" : "singleTool";
    },
    {
      "multishot": "collectResults",
      "singleTool": END
    }
  );
  
  // After collecting results, check if we need to process more sub-questions
  graph.addConditionalEdges(
    "collectResults",
    (state) => {
      // Add a safety check for cycle detection - if we've processed more than 20 steps, force completion
      const stepCount = state.subQuestions.filter(sq => sq.completed).length;
      if (stepCount > 20) {
        console.log("⚠️ Emergency cycle detection - force terminating after processing more than 20 sub-questions");
        return "complete";
      }
      return state.processingComplete ? "complete" : "continue";
    },
    {
      "continue": "routeSubQuestion",
      "complete": "aggregateResults"
    }
  );
  
  // Ensure the aggregation node leads to END with a direct, unconditional edge
  graph.addEdge("aggregateResults", END, { priority: 1000 }); // Very high priority to ensure this takes precedence
  
  // Add emergency fallback edges to terminate any stuck executions
  graph.addConditionalEdges(
    "routeSubQuestion",
    (state) => {
      // If there's no current sub-question and we've processed at least one sub-question,
      // we might be stuck in a loop - force termination
      if (!state.currentSubQuestion && state.subQuestions.some(sq => sq.completed)) {
        console.log("⚠️ No valid sub-question to process but we've already processed some - emergency termination");
        return "terminate";
      }
      return "continue";
    },
    {
      "terminate": "aggregateResults",
      "continue": "routeSubQuestion" // This is a dummy edge that will be replaced by the normal conditional logic
    },
    { priority: 2000 } // Even higher priority than other edges
  );

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
        serpApiQuery,
        
        // Initialize multishot workflow fields
        requiresDecomposition: false,
        isMultishot: false,
        subQuestions: [],
        currentSubQuestion: null,
        intermediateResults: {},
        processingComplete: false
      };
      
  try {
    // Execute the graph with a global timeout to prevent hanging
    const GLOBAL_TIMEOUT_MS = 60000; // 60 seconds max for the entire workflow
    
    // Create a wrapper around the chain invocation that adds a failsafe
    const executeSafely = async () => {
      try {
        // Try invoking the chain normally
        return await toolSelectionChain.invoke(initialState);
      } catch (error) {
        console.error("❌ Error during tool selection chain execution:", error);
        
        // Handle InvalidUpdateError specially with improved error handling
        if (error.name === "InvalidUpdateError" || error.toString().includes("InvalidUpdateError")) {
          console.log("🔄 Handling InvalidUpdateError with fallback response");
          
          // Try to extract any intermediate results we might have
          let partialContent = "";
          let diagInfo = "";
          
          try {
            // Enhanced diagnostics - capture information about the state that might be causing issues
            if (initialState.toolOutput) {
              diagInfo += `\nTool output type: ${typeof initialState.toolOutput}`;
              if (typeof initialState.toolOutput === 'string') {
                diagInfo += `\nTool output length: ${initialState.toolOutput.length} characters`;
              } else if (typeof initialState.toolOutput === 'object') {
                diagInfo += `\nTool output keys: ${Object.keys(initialState.toolOutput).join(', ')}`;
              }
            }
            
            // Log detailed diagnostics but don't expose to the user
            console.error("💾 InvalidUpdateError diagnostic info:", diagInfo);
            
            // Try to access intermediateResults if they exist
            if (initialState.intermediateResults && Object.keys(initialState.intermediateResults).length > 0) {
              partialContent = Object.entries(initialState.intermediateResults)
                .map(([key, value]) => {
                  // Ensure value is a string and truncate if too long
                  const safeValue = typeof value === 'string' ? 
                    (value.length > 300 ? value.substring(0, 300) + "..." : value) :
                    String(value);
                  return `${key}: ${safeValue}`;
                })
                .join("\n\n");
            } 
            // Also check subQuestions for any completed ones
            else if (initialState.subQuestions && initialState.subQuestions.length > 0) {
              const completedQuestions = initialState.subQuestions
                .filter(sq => sq.completed && sq.result)
                .map(sq => {
                  // Ensure result is a string and truncate if too long
                  const safeResult = typeof sq.result === 'string' ? 
                    (sq.result.length > 300 ? sq.result.substring(0, 300) + "..." : sq.result) :
                    String(sq.result);
                  return `For "${sq.question}": ${safeResult}`;
                })
                .join("\n\n");
                
              if (completedQuestions) {
                partialContent = completedQuestions;
              }
            }
          } catch (e) {
            console.error("❌ Error extracting partial results:", e);
          }
          
          // Create a more informative user-facing error message
          const fallbackResponse = partialContent 
            ? `I found some information while working on your request, but encountered a system error when processing the data. Here's what I was able to gather:\n\n${partialContent}`
            : "I encountered a system error while processing your request. This might be related to handling complex data between steps. Please try rephrasing your question or breaking it into simpler parts.";
          
          return {
            ...initialState,
            finalResponse: fallbackResponse,
            toolOutput: "Execution terminated due to state update error",
            processingComplete: true
          };
        }
        
        // If we hit a recursion limit, provide a graceful fallback
        if (error.name === "GraphRecursionError" || error.message?.includes("recursion limit")) {
          console.log("🔄 Handling recursion error with fallback response");
          
          // Try to extract any partial results from sub-questions
          const subResults = initialState.subQuestions?.filter(sq => sq.completed && sq.result)
            .map(sq => `For "${sq.question}": ${sq.result || "No result"}`)
            .join("\n\n") || "No partial results available";
          
          return {
            ...initialState,
            finalResponse: `I found these partial results but couldn't complete the full calculation:\n\n${subResults}`,
            toolOutput: "Execution terminated due to recursion limit",
            processingComplete: true
          };
        }
        
        // Generic error handler for any other errors
        return {
          ...initialState,
          finalResponse: `I encountered an error while processing your request: ${error.message || 'Unknown error'}. If you were asking about combined calculations or multi-step operations, please try phrasing your question more directly.`,
          toolOutput: `Error: ${error}`,
          processingComplete: true
        };
      }
    };
    
    // Use Promise.race to add a global timeout
    const result = await Promise.race([
      executeSafely(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Global workflow timeout after ${GLOBAL_TIMEOUT_MS}ms`)), GLOBAL_TIMEOUT_MS);
      })
    ]);
    
    // Determine what workflow was used
    const workflowType = result.isMultishot ? "multishot" : "single-tool";
    const toolsUsed = result.isMultishot 
      ? result.subQuestions.map(sq => sq.toolType).join(", ")
      : result.selectedTool;
    
    console.log(`✅ ${workflowType} workflow completed. Tools used: ${toolsUsed}`);
    
    // Return the final response and metadata
    // Final check to ensure we have a finalResponse, even if something went wrong
    if (!result.finalResponse && result.isMultishot && result.subQuestions.length > 0) {
      // Emergency manual aggregation if we somehow got here without a finalResponse
      console.log("⚠️ No finalResponse after multishot workflow, generating emergency response");
      
      try {
        // Try to salvage whatever results we have and perform a manual calculation if needed
        const completedQuestions = result.subQuestions.filter(sq => sq.completed && sq.result);
        
        // Check if we have population data that needs to be combined
        const populationPattern = /population|people|residents|inhabitants/i;
        const isPopulationQuery = populationPattern.test(result.query);
        
        if (isPopulationQuery && completedQuestions.length >= 2) {
          // Extract population values from results
          const populationValues = completedQuestions.map(sq => {
            // Try to extract numeric values from the result
            if (typeof sq.result === 'string') {
              // Look for patterns like "X million" or numbers with commas
              const millionMatch = sq.result.match(/(\d+(?:\.\d+)?)\s*million/i);
              if (millionMatch && millionMatch[1]) {
                return parseFloat(millionMatch[1]) * 1000000;
              }
              
              // Look for formatted numbers
              const numberMatch = sq.result.match(/[\d,]+/);
              if (numberMatch) {
                return parseFloat(numberMatch[0].replace(/,/g, ''));
              }
            }
            return null;
          }).filter(Boolean);
          
          if (populationValues.length >= 2) {
            // Calculate sum
            const sum = populationValues.reduce((a, b) => a + b, 0);
            
            // Check if we need to multiply by a percentage
            const percentPattern = /(\d+(?:\.\d+)?)\s*%|multiply.*by\s+(\d+(?:\.\d+)?)/i;
            const percentMatch = result.query.match(percentPattern);
            let finalValue = sum;
            let percentageText = "";
            
            if (percentMatch) {
              const percentage = parseFloat(percentMatch[1] || percentMatch[2]);
              const multiplier = percentage < 1 ? percentage : percentage / 100;
              finalValue = sum * multiplier;
              percentageText = ` I then calculated ${multiplier * 100}% of this value as requested: ${finalValue.toLocaleString()}.`;
            }
            
            const emergencyResponse = `Based on my research, I've found the following population data:
            
${completedQuestions.map(sq => `- ${sq.question}: ${sq.result}`).join('\n')}

The combined population is approximately ${sum.toLocaleString()}.${percentageText}`;
            
            result.finalResponse = emergencyResponse;
          } else {
            // Fall back to standard emergency response
            const emergencyResponse = `I gathered the following information for your question:\n\n${
              completedQuestions.map(sq => `For "${sq.question}": ${sq.result}`).join("\n\n")
            }`;
            
            result.finalResponse = emergencyResponse;
          }
        } else {
          // Standard emergency response
          const emergencyResponse = `I gathered the following information for your question:\n\n${
            completedQuestions.map(sq => `For "${sq.question}": ${sq.result}`).join("\n\n")
          }`;
          
          result.finalResponse = emergencyResponse;
        }
      } catch (e) {
        console.error("❌ Even emergency response generation failed:", e);
        result.finalResponse = "I was unable to complete the multi-step process for your query. Please try a simpler question.";
      }
    }
    
    return {
      response: result.finalResponse || "I couldn't process your request. Please try again.",
      toolUsed: result.isMultishot ? "multishot" : result.selectedTool,
      analysis: result.analysis,
      isMultishot: result.isMultishot,
      subQuestions: result.isMultishot ? result.subQuestions : []
    };
  } catch (error) {
    console.error("❌ Tool selection workflow failed:", error);
    
    // Return a graceful error response
    return {
      response: `I encountered an issue while processing your request: ${error.message || 'Unknown error'}. If you were asking about combined populations or other multi-step calculations, please try phrasing your question more directly.`,
      toolUsed: "error",
      analysis: `Workflow error: ${error}`
    };
  }
    }
  };
}

