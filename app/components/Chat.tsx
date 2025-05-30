'use client';

import { useState, useRef, useEffect } from 'react';

// Type definitions
// Define types for the chat messages
interface ChatMessage {
  role: 'user' | 'bot';
  content: string;
}

interface ChatProps {
  apiKey: string;
  serpApiKey?: string;
  onModelInfoChange?: (modelInfo: ModelInfo | null) => void;
  runSqlQuery: boolean;
  includeOrganicResults?: boolean;
  useMultiShotAI?: boolean; // Add this line
}

// Type for SQL query result
interface SqlQueryResult {
  [key: string]: any;
}

// We're removing the SerpAPI result interface since we're no longer making client-side SerpAPI calls

// Type for model information
interface ModelInfo {
  name: string;
  description?: string;
}

// Helper function to estimate token count (more accurate than the server-side version)
const estimateTokenCount = (text: string): number => {
  // Tokens are roughly 4 characters in English, but with some adjustments:
  // - Numbers and special characters often count as individual tokens
  // - Common words are often single tokens despite character length
  
  // A slightly more accurate estimate than simple character count
  const charCount = text.length;
  const numberCount = (text.match(/\d+/g) || []).length;
  const symbolCount = (text.match(/[^\w\s]/g) || []).length;
  
  // Estimate: base rate of chars/4, plus adjustments for numbers, symbols
  return Math.ceil(charCount / 4 + numberCount * 0.5 + symbolCount * 0.5);
};


const Chat = ({ apiKey, serpApiKey, onModelInfoChange, runSqlQuery, includeOrganicResults = false, useMultiShotAI = false }: ChatProps) => {
  // State declarations grouped by functionality
  // UI states
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Loading states
  const [isLoadingSql, setIsLoadingSql] = useState(false);
  const [isLoadingLlm, setIsLoadingLlm] = useState(false);
  const [isLoadingSerpApi, setIsLoadingSerpApi] = useState(false);
  
  // Data states
  const [sqlResults, setSqlResults] = useState<SqlQueryResult | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  // Scroll to the bottom of the chat when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
// SQL query template - do not remove SQL_QUERY_TEMPLATE_VECTOR
const SQL_QUERY_TEMPLATE_VECTOR = `
            SELECT seg
            FROM segs
            ORDER BY vector_distance(vec, (SELECT vector_embedding(ALL_MINILM_L12_V2 using \' + {{USER_INPUT}} + \' as data)), COSINE)
            FETCH FIRST 2 ROWS ONLY
`;

// Possible queries
// select * from emp
const SQL_QUERY_TEMPLATE = `

`;

// Hardcoded SerpAPI query - this will be sent to the server for execution
// Can you provide the number of wins and losses for each of the top four MLB teams so far this year?
const SERP_API_QUERY = "";

  // Function to fetch SQL query results
  const fetchSqlResults = async (userInput: string): Promise<SqlQueryResult> => {
    try {
      // Generate the SQL query using the template and user input
      const sqlQuery = SQL_QUERY_TEMPLATE.replace('{{USER_INPUT}}', userInput);
      
      // Encode the SQL query for URL usage
      const encodedQuery = encodeURIComponent(sqlQuery);
      
      // Append the query parameter to the endpoint URL
      const response = await fetch(`/api/sql?query=${encodedQuery}`);
      
      if (!response.ok) {
        // Handle HTTP errors
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || 
          `Failed to fetch SQL results: ${response.status} ${response.statusText}`
        );
      }
      
      const data = await response.json();
      // SQL results are already logged in the SQL route, so we don't log them again here
      console.log('SQL query completed successfully');
      return data;
    } catch (error) {
      console.error('Error fetching SQL results:', error);
      throw error;
    }
  };

// We're removing the fetchSerpApiResults function since we're no longer making client-side SerpAPI calls
// All tool selection and execution will happen on the server side through the ReACT agent

  // Handle form submission and process the chat flow
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    if (!input.trim() || !apiKey) return;
    
    // Add user message to chat
    const userMessage: ChatMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput(''); // Clear input field
    
    try {
      // Step 1: Fetch SQL results and enhance the message if SQL is enabled
      let enhancedMessage = userMessage.content;
      let sqlData: SqlQueryResult | null = null;
      
      // Fetch SQL results if enabled
      if (runSqlQuery) {
        setIsLoadingSql(true);
        try {
          // Execute SQL query with user message content
          sqlData = await fetchSqlResults(userMessage.content);
          setSqlResults(sqlData);
          
          // No need for replacement in the simple query
          const sqlQuery = SQL_QUERY_TEMPLATE;
          
          // Format the results and enhance the message
          const formattedResults = JSON.stringify(sqlData, null, 2);
          enhancedMessage = `${userMessage.content}\n\nSQL Results (${sqlQuery}):\n${formattedResults}`;
          
          // Log debug information (without duplicating SQL results)
          const estimatedTokens = estimateTokenCount(enhancedMessage);
          console.log('Message preview:', userMessage.content.slice(0, 50), '...');
          console.log(`SQL results retrieved and appended to message (${enhancedMessage.length} chars, ~${estimatedTokens} tokens)`);
          
          // No additional truncation needed with command-r-plus model (128K token limit)
        } catch (sqlError) {
          console.error('Failed to fetch SQL results:', sqlError);
          // Continue with the original message if SQL fetch fails
        } finally {
          setIsLoadingSql(false);
        }
      }
      
      // We're removing the client-side SerpAPI call
      // All tool selection (including SerpAPI) will be handled by the server-side ReACT agent
      
      // Set loading state for SerpAPI if:
      // 1. We have a SerpAPI key
      // 2. The query looks like it might need web search (starts with question words)
      // 3. We have a non-empty SERP_API_QUERY to send
      const mightUseSerpApi = 
        serpApiKey && 
        SERP_API_QUERY && 
        SERP_API_QUERY.trim() !== "" && 
        /^(?:who|what|when|where|why|how|is|are|was|were|did|do|does|can|could|should|would)/i.test(userMessage.content);
      
      if (mightUseSerpApi) {
        console.log("Query might use SerpAPI, showing loading indicator");
        setIsLoadingSerpApi(true);
      }
      
      // Step 2: Send message to Cohere API
      setIsLoadingLlm(true);
      
      // Prepare chat history for API
      const chatHistory = messages.map(msg => ({
        role: msg.role === 'user' ? 'USER' : 'CHATBOT',
        message: msg.content
      }));
      
      // Call API with the message and additional parameters
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          // Send the enhanced message that includes SQL results if available
          message: enhancedMessage, 
          apiKey,
          chatHistory,
          // Only set runSqlQuery to true if the message is not empty and SQL template is not empty
          runSqlQuery: runSqlQuery && userMessage.content.trim() !== '' && SQL_QUERY_TEMPLATE.trim() !== '', // Don't run SQL if template is empty
          // Pass the predefined SQL query so that chains.ts has a valid SQL query to execute
          sqlQuery: SQL_QUERY_TEMPLATE,
          // Pass the SerpAPI key and hardcoded query to the server
          // The server-side ReACT agent will decide whether to use SerpAPI based on the user's query
          // Only pass the SerpAPI key and query if both exist and the query is non-empty
          serpApiKey: serpApiKey,
          serpApiQuery: SERP_API_QUERY && SERP_API_QUERY.trim() !== "" ? SERP_API_QUERY : undefined,
          // Pass the multi-shot agentic AI setting
          useMultiShotAI: useMultiShotAI
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }
      
      // Step 3: Process API response
      // Extract model information if available
      if (data.model) {
        const newModelInfo = {
          name: data.model,
          description: data.modelDescription
        };
        setModelInfo(newModelInfo);
        
        // Notify parent component about model info change
        if (onModelInfoChange) {
          onModelInfoChange(newModelInfo);
        }
        
        console.log(`Using model: ${data.model}`);
      }
      
      // Add bot response to chat
      // The LLM has now processed the user query and used the appropriate tools (Calculator, SerpAPI, etc.)
      setMessages(prev => [
        ...prev, 
        { role: 'bot', content: data.response }
      ]);
      
      // Log that we've sent the message to the LLM with hardcoded queries
      console.log('Sent message to LLM with hardcoded SQL and SerpAPI queries');
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message to chat
      setMessages(prev => [
        ...prev, 
        { role: 'bot', content: 'Sorry, I encountered an error. Please try again.' }
      ]);
    } finally {
      // Reset all loading states
      setIsLoadingSql(false);
      setIsLoadingLlm(false);
      setIsLoadingSerpApi(false);
    }
  }; // Close handleSubmit function

  // Reset chat conversation
  const resetChat = () => {
    setMessages([]);
    // No need to reset other states like SQL results or model info
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Model info bar */}
      {modelInfo && (
        <div className="bg-gray-100 px-4 py-2 text-xs text-gray-600 border-b flex justify-between items-center">
          <div>
            <span>Model: </span>
            <span className="font-semibold">{modelInfo.name}</span>
            {modelInfo.description && <span className="ml-2 text-gray-500">({modelInfo.description})</span>}
          </div>
          <div className="flex items-center space-x-2">
            <span className={`mr-2 px-2 py-0.5 rounded-full text-xs ${runSqlQuery ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              SQL Queries: {runSqlQuery ? 'Enabled' : 'Disabled'}
            </span>
            {runSqlQuery && (
              <code className="bg-gray-200 px-1 py-0.5 rounded">{SQL_QUERY_TEMPLATE}</code>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs ${serpApiKey ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}`}>
              SerpAPI: {serpApiKey ? 'Enabled' : 'Disabled'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${useMultiShotAI ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-500'}`}>
              Multi-shot AI: {useMultiShotAI ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      )}
      
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <h2 className="text-xl font-semibold mb-2">Welcome to React NextJS Chat App</h2>
              <p>Start a conversation by typing a message below.</p>
              {runSqlQuery ? (
                <>
                  <p className="mt-2 text-sm">SQL Query: <code>{SQL_QUERY_TEMPLATE}</code></p>
                  <p className="text-xs">Results will be automatically appended to your messages.</p>
                </>
              ) : (
                <p className="mt-2 text-sm">SQL Queries are disabled. Messages will be sent directly to the AI.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div 
                key={index} 
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`max-w-3/4 rounded-lg px-4 py-2 ${
                    message.role === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-800'
                  }`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
          </>
        )}
        
        {/* Progress indicators */}
        <div className="space-y-2">
          {isLoadingSql && runSqlQuery && SQL_QUERY_TEMPLATE.trim() !== '' && (
            <div className="flex justify-start">
              <div className="bg-blue-100 text-blue-800 rounded-lg px-4 py-2 max-w-md">
                <div className="flex items-center mb-1">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-medium">Querying Oracle Database...</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-1.5">
                  <div className="bg-blue-600 h-1.5 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <p className="text-xs mt-1">Executing: {SQL_QUERY_TEMPLATE}</p>
              </div>
            </div>
          )}
          
          {isLoadingSerpApi && serpApiKey && SERP_API_QUERY && SERP_API_QUERY.trim() !== "" && (
            <div className="flex justify-start">
              <div className="bg-green-100 text-green-800 rounded-lg px-4 py-2 max-w-md">
                <div className="flex items-center mb-1">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-medium">Searching the Web...</span>
                </div>
                <div className="w-full bg-green-200 rounded-full h-1.5">
                  <div className="bg-green-600 h-1.5 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <p className="text-xs mt-1">Using SerpAPI to find relevant information about: {SERP_API_QUERY.substring(0, 50)}{SERP_API_QUERY.length > 50 ? "..." : ""}</p>
              </div>
            </div>
          )}
          
          {isLoadingLlm && (
            <div className="flex justify-start">
              <div className="bg-purple-100 text-purple-800 rounded-lg px-4 py-2 max-w-md">
                <div className="flex items-center mb-1">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-medium">Generating AI RAG Response...</span>
                </div>
                <div className="w-full bg-purple-200 rounded-full h-1.5">
                  <div className="bg-purple-600 h-1.5 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <p className="text-xs mt-1">Using model: {modelInfo?.name || 'Cohere'}</p>
              </div>
            </div>
          )}
        </div>
        <div ref={messagesEndRef}></div>
      </div>
      
      {/* Input area */}
      <div className="border-t border-gray-200 p-4">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={(isLoadingSql || isLoadingLlm || isLoadingSerpApi) || !apiKey}
            className="flex-1 p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || (isLoadingSql || isLoadingLlm || isLoadingSerpApi) || !apiKey}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-400"
          >
            Send
          </button>
          <button
            type="button"
            onClick={resetChat}
            disabled={(isLoadingSql || isLoadingLlm || isLoadingSerpApi) || messages.length === 0}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            Reset
          </button>
        </form>
        {!apiKey && (
          <p className="mt-2 text-sm text-red-500">Please add your Cohere API key in the sidebar to start chatting.</p>
        )}
      </div>
    </div>
  );
};


export default Chat;
