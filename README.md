This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Application Structure

This application is built using Next.js with the App Router architecture. It's a simple chatbot application that integrates with an Oracle database and uses Cohere's LLM API to generate responses based on user inputs and database query results.

### Directory Structure

The application is organized into the following structure:

```
app/
├── api/                  # API routes for backend functionality
│   ├── chat/            # Cohere LLM integration
│   └── sql/             # Oracle database integration
├── components/          # Reusable React components
├── globals.css          # Global styles
├── layout.tsx           # Root layout component
└── page.tsx             # Main page component
```

### Core Files

#### Root Level

- `app/layout.tsx`: The root layout component that wraps all pages. Sets up the basic HTML structure, metadata, and font configuration.
  
- `app/page.tsx`: The main page component that serves as the entry point of the application. Manages the API key state and renders the Sidebar and Chat components.
  
- `app/globals.css`: Contains global CSS styles and Tailwind CSS configurations.

- `app/favicon.ico`: The application favicon displayed in browser tabs.

#### Components

- `app/components/Sidebar.tsx`: Sidebar component that allows users to enter and manage their Cohere API key. Features include:
  - API key input with validation
  - Local storage persistence
  - Visual status indicators
  - API key masking for security

- `app/components/Chat.tsx`: Main chat interface component with the following features:
  - Message display with different styling for user and bot messages
  - Input field for typing messages
  - SQL query execution with Oracle database
  - Communication with Cohere LLM 
  - Separate progress indicators for SQL and LLM operations
  - Automatic truncation of SQL results to avoid token limits

#### API Routes

- `app/api/chat/route.ts`: API route that handles communication with Cohere's LLM. Features:
  - Authentication with Cohere using the user-provided API key
  - Message processing and token management
  - Error handling for token limits and API issues
  - Configurable model selection (currently using 'command-light')

- `app/api/sql/route.ts`: API route that executes SQL queries against an Oracle database using the SQLclScript.sh bash script. Features:
  - Executes the hardcoded SQL query "select * from emp"
  - Handles the execution of the external bash script
  - Parses and formats JSON results
  - Error handling for database connection issues

### Data Flow

1. User enters a message in the Chat component
2. The application queries the Oracle database using the SQL API
3. SQL results are truncated and appended to the user's message
4. The enhanced message is sent to Cohere's API via the chat API route
5. The response from Cohere is displayed in the chat interface

This architecture separates concerns between frontend components, API routes, and external integrations, making the code more maintainable and scalable.

## Detailed File Descriptions

This section provides an in-depth analysis of each file in the application, detailing implementation specifics, key functions, data flow, and integration points.

### Root Files

#### `app/layout.tsx`

**Purpose**: Serves as the root layout component that wraps all pages in the application.

**Implementation Details**:
- Uses Next.js's built-in font optimization with the Geist font family
- Implements HTML metadata with title and description
- Sets up the basic HTML structure with language attribute and body styling

**Key Functions and Components**:
- `RootLayout`: The main layout component that receives children elements through props
- Font configuration using `next/font/google` for optimal loading and display

**Code Example**:
```tsx
export const metadata: Metadata = {
  title: "React NextJS Chat App",
  description: "Simple chatbot powered by Next.js and React",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

#### `app/page.tsx`

**Purpose**: The main entry point of the application that manages state and renders core components.

**Implementation Details**:
- Uses the 'use client' directive to enable client-side React features
- Manages API key state across components
- Implements a split-screen layout with sidebar and chat area

**Key State Variables**:
- `apiKey`: Stores the Cohere API key for authentication
- `handleApiKeyChange`: Callback function passed to the Sidebar component

**Integration Points**:
- Imports and renders the `Sidebar` and `Chat` components
- Passes the API key and change handler between components
- Acts as the bridge between API key management and chat functionality

**Code Example**:
```tsx
'use client';

import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';

export default function Home() {
  const [apiKey, setApiKey] = useState<string>('');

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar on the left */}
      <Sidebar onApiKeyChange={handleApiKeyChange} />
      
      {/* Chat area on the right */}
      <div className="flex-1 overflow-hidden">
        <Chat apiKey={apiKey} />
      </div>
    </div>
  );
}
```

#### `app/globals.css`

**Purpose**: Contains global CSS styles and Tailwind CSS configuration.

**Implementation Details**:
- Imports Tailwind's base, components, and utilities styles
- Defines custom variables and global styles
- Sets up responsive design fundamentals

### Component Files

#### `app/components/Sidebar.tsx`

**Purpose**: Manages the display and handling of the Cohere API key.

**Implementation Details**:
- Uses the 'use client' directive for client-side functionality
- Implements local storage for API key persistence between sessions
- Provides a secure interface for entering and managing API keys

**Key State Variables**:
- `apiKey`: Stores the current API key value
- `isEditing`: Controls whether the user is in edit mode
- `apiKeyStatus`: Tracks the status of the API key ('not-set', 'set', or 'invalid')

**Key Functions**:
- `handleApiKeyChange`: Updates the API key state and validates input
- `saveApiKey`: Saves the API key to localStorage and notifies parent component
- `clearApiKey`: Removes the API key from both state and localStorage

**Integration Points**:
- Receives `onApiKeyChange` callback from parent component
- Updates parent component state when API key changes
- Uses localStorage to persist key between sessions

**Code Example**:
```tsx
// Load API key from localStorage on component mount
useEffect(() => {
  const storedApiKey = localStorage.getItem('cohereApiKey');
  if (storedApiKey) {
    setApiKey(storedApiKey);
    onApiKeyChange(storedApiKey);
    setApiKeyStatus('set');
  }
}, [onApiKeyChange]);

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
```

**UI Components**:
- API key input field with validation
- Masked API key display (showing only first and last 4 characters)
- Status indicators and action buttons
- Link to obtain a Cohere API key

#### `app/components/Chat.tsx`

**Purpose**: Core chat interface that handles user messages, SQL queries, and LLM interaction.

**Implementation Details**:
- Uses the 'use client' directive for client-side functionality
- Manages complex state for messages, loading states, and API responses
- Implements token estimation and SQL result truncation to avoid LLM token limits

**Key Constants**:
- `SQL_QUERY`: Defines the SQL query sent to the Oracle database

**Key State Variables**:
- `messages`: Array of user and bot messages in the chat
- `isLoadingSql`: Loading state for SQL query execution
- `isLoadingLlm`: Loading state for Cohere API requests
- `sqlResults`: Stores the results of SQL queries
- `modelInfo`: Information about the Cohere model being used

**Key Functions**:
- `estimateTokenCount`: Estimates token count for Cohere API limits
- `truncateSqlResults`: Truncates SQL results to avoid token limits
- `fetchSqlResults`: Calls the SQL API endpoint with the defined query
- `handleSubmit`: Main function that processes user messages:
  1. Adds user message to chat
  2. Fetches SQL results
  3. Truncates and appends SQL results to the message
  4. Sends enhanced message to Cohere API
  5. Updates chat with response

**Internal Workflow**:
1. User enters message and clicks send
2. SQL query is executed against Oracle database
3. SQL results are truncated to avoid token limits
4. Results are appended to user message
5. Combined message is sent to Cohere API
6. Response is displayed in chat interface

**Code Example**:
```tsx
// Fetch SQL results first
setIsLoadingSql(true);
sqlData = await fetchSqlResults();
setSqlResults(sqlData);
setIsLoadingSql(false);

// Get a truncated version of the SQL results for the LLM
const truncatedResults = truncateSqlResults(sqlData);

// Create a compact message format
enhancedMessage = `${userMessage.content}\n\nSQL Results (${SQL_QUERY}):\n${truncatedResults}`;

// Set LLM loading state
setIsLoadingLlm(true);

// Call API with the enhanced message
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    message: enhancedMessage,
    apiKey,
    chatHistory
  })
});
```

**UI Components**:
- Chat message display with different styling for user and bot messages
- Progress indicators for SQL and LLM operations
- Message input area with send button
- Model information display

### API Route Files

#### `app/api/chat/route.ts`

**Purpose**: Backend API route that handles communication with Cohere's LLM.

**Implementation Details**:
- Uses Next.js API route pattern with GET/POST handlers
- Initializes the Cohere client with user-provided API key
- Implements token management and error handling

**Key Constants**:
- `COHERE_MODELS`: Configuration for different Cohere models
- `SELECTED_MODEL`: The currently selected Cohere model ('command-light')
- `MAX_TOKENS`: Maximum token limit for the selected model

**Key Functions**:
- `POST`: Handles incoming chat requests:
  1. Extracts message, API key, and chat history from request
  2. Initializes Cohere client with the API key
  3. Processes message to ensure it's within token limits
  4. Sends request to Cohere API
  5. Returns response to client

**Error Handling**:
- Specific handling for token limit errors
- Authentication error detection
- Generic error fallback

**Code Example**:
```typescript
// Initialize Cohere client with the provided API key
const cohere = new CohereClient({
  token: apiKey,
});

// Call Cohere chat API with the selected model
const cohereResponse = await cohere.chat({
  message: processedMessage,
  chatHistory,
  model: SELECTED_MODEL,
  temperature: 0.7,
  maxTokens: MAX_TOKENS,
});

// Return the response with model information
return NextResponse.json({
  response: cohereResponse.text,
  citations: cohereResponse.citations || [],
  model: SELECTED_MODEL,
});
```

#### `app/api/sql/route.ts`

**Purpose**: Backend API route that executes SQL queries against an Oracle database.

**Implementation Details**:
- Uses Next.js API route pattern with GET handler
- Executes an external bash script (SQLclScript.sh) to run SQL queries
- Processes and returns results as JSON

**Key Functions**:
- `GET`: Handles incoming SQL query requests:
  1. Gets the SQL query from request URL parameters
  2. Constructs the path to the SQLclScript.sh script
  3. Executes the script with the SQL query
  4. Parses the JSON result
  5. Returns formatted data to client

**External Integration**:
- Uses Node.js `child_process.execSync` to execute the SQLclScript.sh script
- Passes SQL query as a parameter to the script
- Handles path resolution for the script location

**Error Handling**:
- Script existence verification
- JSON parsing with fallback strategies
- Comprehensive error response formatting

**Code Example**:
```typescript
// Get the SQL query from the request URL search parameters
const { searchParams } = new URL(request.url);
const query = searchParams.get('query');

// Construct the path to the script
const scriptPath = path.resolve(process.cwd(), '../SQLclScript.sh');

// Execute the bash script with the query
const command = `"${scriptPath}" "${query}"`;
console.log(`Executing command: ${command}`);

const result = execSync(command, { 
  encoding: 'utf-8',
  maxBuffer: 1024 * 1024 * 10 // 10MB buffer
});
```

### Integration and Data Flow

The files described above work together in a coherent architecture:

1. The `page.tsx` serves as the main container, managing API key state and layout.
2. `Sidebar.tsx` handles API key input and persistence, updating the parent state.
3. `Chat.tsx` manages the chat interface, SQL queries, and communication with API routes.
4. `api/sql/route.ts` executes SQL queries against the Oracle database.
5. `api/chat/route.ts` communicates with Cohere's API to generate responses.

This structure follows modern React patterns including:

- **Component Composition**: Building complex UIs from smaller, focused components
- **State Lifting**: Managing shared state at the highest necessary level
- **Side Effect Management**: Using `useEffect` for lifecycle operations
- **Async/Await Pattern**: For clean handling of asynchronous operations
- **Progressive Enhancement**: Graceful fallbacks when operations fail

The application implements a RAG (Retrieval Augmented Generation) pattern by fetching data from the database, appending it to user queries, and using it to enhance the LLM's responses with contextual information.
