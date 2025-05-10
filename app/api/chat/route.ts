import { NextRequest, NextResponse } from 'next/server';
import { CohereClient } from 'cohere-ai';

// Define types for request body
interface ChatRequestBody {
  message: string;
  apiKey: string;
  chatHistory?: {
    role: 'USER' | 'CHATBOT';
    message: string;
  }[];
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

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json() as ChatRequestBody;
    const { message, apiKey, chatHistory = [] } = body;
    
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
    
    // No truncation needed with command-r-plus model which has a 128K token context window
    // Using the full message with complete SQL results for better analysis
    let processedMessage = message;
    
    // Note: The truncation seen in the console log above is ONLY for display purposes
    // The complete message is being sent to the LLM without any truncation

    // Initialize Cohere client with the provided API key
    const cohere = new CohereClient({
      token: apiKey,
    });

    // Call Cohere chat API with increased maxTokens to handle the SQL data
    console.log('Sending chat request to Cohere API...');
    console.log(`Estimated total tokens in request: ~${estimateTokenCount(processedMessage)}`);
    
    // Log which model we're using
    console.log(`Using Cohere model: ${SELECTED_MODEL} (${COHERE_MODELS[SELECTED_MODEL].description})`);
    
    const cohereResponse = await cohere.chat({
      message: processedMessage, // Use the processed message (potentially truncated)
      chatHistory,
      model: SELECTED_MODEL,  // Using the selected Cohere model
      temperature: 0.7,
      maxTokens: MAX_TOKENS,
    });
    
    console.log('Received response from Cohere API');

    // Log the response (truncate if too long)
    console.log('Cohere response:', 
      cohereResponse.text.length > 500 
        ? cohereResponse.text.substring(0, 200) + '...[truncated]...' + cohereResponse.text.substring(cohereResponse.text.length - 200) 
        : cohereResponse.text
    );
    
    // Return the response with model information
    return NextResponse.json({
      response: cohereResponse.text,
      // Include any additional data from Cohere's response that might be useful
      citations: cohereResponse.citations || [],
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

