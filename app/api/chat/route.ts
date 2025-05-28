import { NextRequest, NextResponse } from 'next/server';
import { getCohereModel } from '../../langchain/models';
import { createRagChain, createAgentChain } from '../../langchain/chains';
import { createSqlQueryTool, createCalculatorTool } from '../../langchain/tools';

// Define types for request body
interface ChatRequestBody {
  message: string;
  apiKey: string;
  chatHistory?: ChatMessage[];
  runSqlQuery?: boolean;
  sqlQuery?: string;
  serpApiKey?: string;
}

// Interface for chat messages
interface ChatMessage {
  role: string;
  message: string;
}

// Cohere model configuration
const COHERE_MODELS = {
  // Model options with their max token limits
  'command': {
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
    description: 'Powerful model with strong reasoning'
  },
  'command-light': {
    maxInputTokens: 4096,
    maxOutputTokens: 2048,
    description: 'Faster and more lightweight model'
  },
  'command-r': {
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
    description: 'Model with improved reasoning capabilities'
  },
  'command-r-plus': {
    maxInputTokens: 128000, // Much higher context window
    maxOutputTokens: 4096,
    description: 'Advanced model with large context window'
  }
};

// Select which model to use
const SELECTED_MODEL = 'command-r-plus'; // Using model with large context window (128K tokens)

// Maximum tokens for output generation
const MAX_TOKENS = COHERE_MODELS[SELECTED_MODEL].maxOutputTokens;

// Maximum message length (in characters) to help avoid token limits
// This is a rough estimate - tokens ≈ characters / 4 for English text
const MAX_MESSAGE_LENGTH = COHERE_MODELS[SELECTED_MODEL].maxInputTokens * 3; // Rough character estimate

// Simple function to estimate token count from text
// This is a rough approximation; actual tokenization varies by model
function estimateTokenCount(text: string): number {
  // A rough estimate for English text: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

// Basic validation for Cohere API key format
function isValidCohereApiKey(apiKey: string): boolean {
  // Most API keys have minimum length requirements and specific patterns
  // This is a very basic check - adjust based on Cohere's actual key format
  return apiKey && apiKey.length >= 20;
}

// Function to detect if the query potentially needs a calculator
// This is kept for backward compatibility but the LangGraph workflow will handle this automatically
function mightNeedCalculation(message: string): boolean {
  // Check for patterns that indicate a mathematical calculation is needed
  const mathPattern = /what\s+is\s+[\d\s\+\-\*\/\^\(\)\.]+|calculate\s+[\d\s\+\-\*\/\^\(\)\.]+|[\d\s\+\-\*\/\^\(\)\.]+\s*=\s*\?|compute\s+[\d\s\+\-\*\/\^\(\)\.]+|evaluate\s+[\d\s\+\-\*\/\^\(\)\.]+/i;
  
  // Check for specific arithmetic operators with numbers on both sides
  const operatorPattern = /\d+\s*[\+\-\*\/\^]\s*\d+/;
  
  // Log the detection attempt
  const isMathQuery = mathPattern.test(message) || operatorPattern.test(message);
  if (isMathQuery) {
    console.log("📊 Mathematical query detected:", message);
  }
  
  return isMathQuery;
}

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json() as ChatRequestBody;
    const { message, apiKey, chatHistory = [], runSqlQuery = true, sqlQuery = "", serpApiKey } = body;
    
    // Validate the API key format
    if (!isValidCohereApiKey(apiKey)) {
      return NextResponse.json(
        { 
          error: 'Invalid API key format', 
          details: 'The provided API key appears to be invalid. Please check your Cohere API key in the sidebar.'
        },
        { status: 401 }
      );
    }
    
    // Log the message length and estimated token count
    const estimatedTokens = estimateTokenCount(message);
    console.log(`Received message: ${message.length} characters, ~${estimatedTokens} tokens (estimated)`);
    console.log('Message preview:', 
      message.length > 500 
        ? message.substring(0, 200) + '...[LOG PREVIEW ONLY: Full message will be sent to Cohere]...' + message.substring(message.length - 200) 
        : message
    );
    console.log('Chat history length:', chatHistory.length);
    console.log('Using Cohere model:', SELECTED_MODEL);
    
    // Create the Cohere model with LangChain
    const model = getCohereModel(apiKey, SELECTED_MODEL);
    
    // Create SQL Tool - this is where we maintain existing Oracle connection
    const fetchSql = async (query: string) => {
      // This function calls our existing SQL API
      try {
        const encodedQuery = encodeURIComponent(query);
        const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/sql?query=${encodedQuery}`);
        if (!response.ok) {
          throw new Error(`SQL query failed: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Error in SQL query:', error);
        throw error;
      }
    };
    
    const sqlTool = createSqlQueryTool(fetchSql);
    
    // Create the integrated workflow using LangGraph
    console.log("🚀 Using LangGraph workflow for intelligent tool selection");
    console.log("🔧 Available tools: Calculator, SQL" + (serpApiKey ? ", SerpAPI" : ""));
    
    // Create the agent chain with LangGraph enabled (passing true as the last parameter)
    const chain = createAgentChain(model, sqlTool, serpApiKey || "", true);
    
    // Execute the workflow - it will automatically select the appropriate tool
    const result = await chain.invoke({
      query: message,
      sqlQuery: sqlQuery // Pass the predefined SQL query to chains.ts
    });
    
    console.log('Received response from LangGraph workflow');
    
    // Log the response (truncate if too long)
    console.log('LangChain response:', 
      result.length > 500 
        ? result.substring(0, 200) + '...[truncated]...' + result.substring(result.length - 200) 
        : result
    );
    
    // Return the response with model information
    return NextResponse.json({
      response: result,
      model: SELECTED_MODEL,
    });
  } catch (error) {
    console.error('Error in chat API route:', error);
    
    // Enhanced error handling with more specific messages
    if (error instanceof Error) {
      const errorMessage = error.message || '';
      
      // Check for token limit errors
      if (errorMessage.includes('too many tokens') || errorMessage.includes('token limit') || 
          errorMessage.includes('size limit') || errorMessage.includes('BadRequestError')) {
        console.error('Token limit exceeded error detected');
        return NextResponse.json(
          { 
            error: 'The message with SQL results exceeded the token limit. Try a simpler query or shorter message.' 
          },
          { status: 413 } // 413 Payload Too Large
        );
      }
      
      // Authentication errors
      if (
        errorMessage.toLowerCase().includes('authentication') || 
        errorMessage.toLowerCase().includes('api key') ||
        errorMessage.toLowerCase().includes('unauthorized') ||
        errorMessage.toLowerCase().includes('invalid token') ||
        error.constructor.name === 'UnauthorizedError'
      ) {
        return NextResponse.json(
          { 
            error: 'Authentication failed. Please check your Cohere API key.',
            details: 'Make sure you\'ve entered a valid API key in the sidebar. Cohere API keys usually start with a specific pattern and need to be entered exactly as provided in your Cohere account dashboard.'
          },
          { status: 401 }
        );
      }
    }
    
    // Generic error fallback
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

