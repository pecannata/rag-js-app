'use client';

import { useState, useEffect } from 'react';

// Define model info interface
interface ModelInfo {
  name: string;
  description?: string;
}

interface SidebarProps {
  onApiKeyChange: (apiKey: string) => void;
  onSerpApiKeyChange: (apiKey: string) => void;
  modelInfo: ModelInfo | null;
  runSqlQuery: boolean;
  onRunSqlQueryChange: (runSqlQuery: boolean) => void;
  includeOrganicResults?: boolean;
  onIncludeOrganicResultsChange: (includeOrganicResults: boolean) => void;
  useMultiShotAI?: boolean;
  onUseMultiShotAIChange: (useMultiShotAI: boolean) => void;
}

const Sidebar = ({ 
  onApiKeyChange, 
  onSerpApiKeyChange, 
  modelInfo, 
  runSqlQuery, 
  onRunSqlQueryChange,
  includeOrganicResults = false, 
  onIncludeOrganicResultsChange,
  useMultiShotAI = false, // Multi-shot AI disabled by default
  onUseMultiShotAIChange
}: SidebarProps) => {
  // Cohere API key state
  const [apiKey, setApiKey] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'not-set' | 'set' | 'invalid'>('not-set');
  
  // SerpAPI key state
  const [serpApiKey, setSerpApiKey] = useState<string>('');
  const [isEditingSerpApi, setIsEditingSerpApi] = useState<boolean>(false);
  const [serpApiKeyStatus, setSerpApiKeyStatus] = useState<'not-set' | 'set' | 'invalid'>('not-set');

  // Load API keys from localStorage on component mount
  useEffect(() => {
    // Load Cohere API key
    const storedApiKey = localStorage.getItem('cohereApiKey');
    if (storedApiKey) {
      setApiKey(storedApiKey);
      onApiKeyChange(storedApiKey);
      setApiKeyStatus('set');
    }
    
    // Load SerpAPI key
    const storedSerpApiKey = localStorage.getItem('serpApiKey');
    if (storedSerpApiKey) {
      setSerpApiKey(storedSerpApiKey);
      onSerpApiKeyChange(storedSerpApiKey);
      setSerpApiKeyStatus('set');
    }
  }, [onApiKeyChange, onSerpApiKeyChange]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    
    // Basic validation - API keys should have a minimum length
    if (value && value.length < 20) {
      setApiKeyStatus('invalid');
    } else if (value) {
      setApiKeyStatus('set');
    } else {
      setApiKeyStatus('not-set');
    }
  };

  const saveApiKey = () => {
    if (apiKey && apiKey.length >= 20) {
      // Save to localStorage
      localStorage.setItem('cohereApiKey', apiKey);
      
      // Notify parent component
      onApiKeyChange(apiKey);
      
      // Update UI state
      setIsEditing(false);
      setApiKeyStatus('set');
    }
  };

  const clearApiKey = () => {
    // Clear from localStorage
    localStorage.removeItem('cohereApiKey');
    
    // Clear state
    setApiKey('');
    onApiKeyChange('');
    setApiKeyStatus('not-set');
    setIsEditing(true);
  };
  
  // SerpAPI key handlers
  const handleSerpApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSerpApiKey(value);
    
    // Basic validation for SerpAPI key
    if (value && value.length < 20) {
      setSerpApiKeyStatus('invalid');
    } else if (value) {
      setSerpApiKeyStatus('set');
    } else {
      setSerpApiKeyStatus('not-set');
    }
  };

  const saveSerpApiKey = () => {
    if (serpApiKey && serpApiKey.length >= 20) {
      // Save to localStorage
      localStorage.setItem('serpApiKey', serpApiKey);
      
      // Notify parent component
      onSerpApiKeyChange(serpApiKey);
      
      // Update UI state
      setIsEditingSerpApi(false);
      setSerpApiKeyStatus('set');
    }
  };

  const clearSerpApiKey = () => {
    // Clear from localStorage
    localStorage.removeItem('serpApiKey');
    
    // Clear state
    setSerpApiKey('');
    onSerpApiKeyChange('');
    setSerpApiKeyStatus('not-set');
    setIsEditingSerpApi(true);
  };

  return (
    <div className="flex flex-col w-64 h-screen bg-gray-50 p-4 border-r border-gray-200">
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-2">React NextJS Chat App</h1>
        <p className="text-sm text-gray-500">Simple chatbot powered by Next.js and React</p>
      </div>
      
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Cohere API Key</h2>
          {apiKeyStatus === 'set' && !isEditing && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
              <span className="w-2 h-2 mr-1 rounded-full bg-green-500"></span>
              Active
            </span>
          )}
        </div>
        
        {isEditing ? (
          <div>
            <input
              type="password"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder="Enter your Cohere API key"
              className={`w-full p-2 text-sm border rounded-md focus:outline-none focus:ring-2 ${
                apiKeyStatus === 'invalid' 
                  ? 'border-red-300 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            
            {apiKeyStatus === 'invalid' && (
              <p className="mt-1 text-xs text-red-600">API key seems too short</p>
            )}
            
            <div className="flex space-x-2 mt-3">
              <button
                onClick={saveApiKey}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Save
              </button>
              
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            {apiKeyStatus === 'set' ? (
              <div className="flex flex-col space-y-2">
                <div className="flex items-center">
                  <div className="w-full bg-gray-200 p-2 rounded-md">
                    <p className="text-sm font-mono">
                      {apiKey.substring(0, 4)}...{apiKey.substring(apiKey.length - 4)}
                    </p>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-xs bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    Edit
                  </button>
                  
                  <button
                    onClick={clearApiKey}
                    className="px-3 py-1.5 text-xs bg-red-100 text-red-800 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="w-full p-2 text-sm bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Add API Key
              </button>
            )}
          </div>
        )}
      </div>

      {/* SerpAPI Key Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">SerpAPI Key</h2>
          {serpApiKeyStatus === 'set' && !isEditingSerpApi && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
              <span className="w-2 h-2 mr-1 rounded-full bg-green-500"></span>
              Active
            </span>
          )}
        </div>
        
        {isEditingSerpApi ? (
          <div>
            <input
              type="password"
              value={serpApiKey}
              onChange={handleSerpApiKeyChange}
              placeholder="Enter your SerpAPI key"
              className={`w-full p-2 text-sm border rounded-md focus:outline-none focus:ring-2 ${
                serpApiKeyStatus === 'invalid' 
                  ? 'border-red-300 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            
            {serpApiKeyStatus === 'invalid' && (
              <p className="mt-1 text-xs text-red-600">API key seems too short</p>
            )}
            
            <div className="flex space-x-2 mt-3">
              <button
                onClick={saveSerpApiKey}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Save
              </button>
              
              <button
                onClick={() => setIsEditingSerpApi(false)}
                className="px-3 py-1.5 text-xs bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            {serpApiKeyStatus === 'set' ? (
              <div className="flex flex-col space-y-2">
                <div className="flex items-center">
                  <div className="w-full bg-gray-200 p-2 rounded-md">
                    <p className="text-sm font-mono">
                      {serpApiKey.substring(0, 4)}...{serpApiKey.substring(serpApiKey.length - 4)}
                    </p>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    onClick={() => setIsEditingSerpApi(true)}
                    className="px-3 py-1.5 text-xs bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    Edit
                  </button>
                  
                  <button
                    onClick={clearSerpApiKey}
                    className="px-3 py-1.5 text-xs bg-red-100 text-red-800 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingSerpApi(true)}
                className="w-full p-2 text-sm bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Add API Key
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* SQL Query Settings Section */}
      <div className="mb-6">
        <h2 className="text-sm font-medium mb-2">SQL Query Settings</h2>
        <div className="bg-gray-100 p-3 rounded-md border border-gray-200">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={runSqlQuery}
              onChange={(e) => onRunSqlQueryChange(e.target.checked)}
              className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm">Run SQL Queries</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            {runSqlQuery 
              ? "SQL query results will be included with each message"
              : "SQL queries are disabled, using direct AI responses only"
            }
          </p>
        </div>
      </div>
      
      {/* Multi-shot Agentic AI Settings Section */}
      <div className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Settings</h2>
        <div className="bg-gray-100 p-3 rounded-md border border-gray-200">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useMultiShotAI}
              onChange={(e) => onUseMultiShotAIChange(e.target.checked)}
              className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm">Use multi-shot Agentic AI</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            {useMultiShotAI 
              ? "Enables advanced multi-step reasoning and tool selection"
              : "Queries will go directly to the LLM when possible"
            }
          </p>
        </div>
      </div>
      
      {/* Model Information Section */}
      <div className="mb-6 mt-4">
        <h2 className="text-sm font-medium mb-2">Cohere Model</h2>
        
        {modelInfo ? (
          <div className="bg-purple-50 p-3 rounded-md border border-purple-200">
            <div className="flex items-center mb-1">
              <span className="inline-flex items-center px-2 py-1 mr-2 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                <span className="w-2 h-2 mr-1 rounded-full bg-purple-500"></span>
                Active
              </span>
              <span className="font-medium text-sm">{modelInfo.name}</span>
            </div>
            
            {modelInfo.description && (
              <p className="text-xs text-gray-600 mt-1">{modelInfo.description}</p>
            )}
          </div>
        ) : (
          <div className="bg-gray-100 p-3 rounded-md border border-gray-200">
            <p className="text-sm text-gray-500">Model information will appear here after your first query.</p>
          </div>
        )}
      </div>
      
      <div className="mt-auto">
        <div className="text-xs text-gray-500 mb-2">
          <p>Don&apos;t have a Cohere API key?</p>
        </div>
        <a
          href="https://dashboard.cohere.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Get one from Cohere dashboard →
        </a>
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-2">
            Need a SerpAPI key?
          </p>
          <a
            href="https://serpapi.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Get one from SerpAPI dashboard →
          </a>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;

