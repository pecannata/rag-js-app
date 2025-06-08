'use client';

import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';

// Define model info interface
interface ModelInfo {
  name: string;
  description?: string;
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string>('');
  const [serpApiKey, setSerpApiKey] = useState<string>('enabled_demo_serp_key_12345'); // Set default SerpAPI key
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [runSqlQuery, setRunSqlQuery] = useState<boolean>(true);
  const [includeOrganicResults, setIncludeOrganicResults] = useState<boolean>(false); // Default to excluding organic results
  const [useMultiShotAI, setUseMultiShotAI] = useState<boolean>(false); // Set to false - multi-shot agentic AI disabled by default

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
  };

  const handleSerpApiKeyChange = (newSerpApiKey: string) => {
    setSerpApiKey(newSerpApiKey);
  };

  const handleModelInfoChange = (newModelInfo: ModelInfo | null) => {
    setModelInfo(newModelInfo);
  };

  const handleRunSqlQueryChange = (newRunSqlQuery: boolean) => {
    setRunSqlQuery(newRunSqlQuery);
  };

  const handleIncludeOrganicResultsChange = (newIncludeOrganicResults: boolean) => {
    setIncludeOrganicResults(newIncludeOrganicResults);
  };

  const handleUseMultiShotAIChange = (newUseMultiShotAI: boolean) => {
    setUseMultiShotAI(newUseMultiShotAI);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar on the left */}
      <Sidebar 
        onApiKeyChange={handleApiKeyChange}
        onSerpApiKeyChange={handleSerpApiKeyChange}
        modelInfo={modelInfo}
        runSqlQuery={runSqlQuery}
        onRunSqlQueryChange={handleRunSqlQueryChange}
        includeOrganicResults={includeOrganicResults}
        onIncludeOrganicResultsChange={handleIncludeOrganicResultsChange}
        useMultiShotAI={useMultiShotAI}
        onUseMultiShotAIChange={handleUseMultiShotAIChange}
      />
      
      {/* Chat area on the right */}
      <div className="flex-1 overflow-hidden">
        <Chat 
          apiKey={apiKey}
          serpApiKey={serpApiKey}
          onModelInfoChange={handleModelInfoChange}
          runSqlQuery={runSqlQuery}
          includeOrganicResults={includeOrganicResults}
          useMultiShotAI={useMultiShotAI}
        />
      </div>
    </div>
  );
}
