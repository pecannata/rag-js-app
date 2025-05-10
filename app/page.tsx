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
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [runSqlQuery, setRunSqlQuery] = useState<boolean>(true);

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
  };

  const handleModelInfoChange = (newModelInfo: ModelInfo | null) => {
    setModelInfo(newModelInfo);
  };

  const handleRunSqlQueryChange = (newRunSqlQuery: boolean) => {
    setRunSqlQuery(newRunSqlQuery);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar on the left */}
      <Sidebar 
        onApiKeyChange={handleApiKeyChange} 
        modelInfo={modelInfo}
        runSqlQuery={runSqlQuery}
        onRunSqlQueryChange={handleRunSqlQueryChange}
      />
      
      {/* Chat area on the right */}
      <div className="flex-1 overflow-hidden">
        <Chat 
          apiKey={apiKey} 
          onModelInfoChange={handleModelInfoChange}
          runSqlQuery={runSqlQuery}
        />
      </div>
    </div>
  );
}
