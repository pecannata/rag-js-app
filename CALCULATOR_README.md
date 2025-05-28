# Calculator Integration with LangGraph and ReAct

This document describes the changes made to add a calculator agent to the application using LangGraph and ReAct technology.

## Overview

The application has been enhanced with a calculator capability that allows the AI to automatically detect when mathematical calculations are needed and use LangChain's native calculator tool to perform these calculations. This integration is powered by:

1. **LangGraph** - A framework for building stateful, multi-actor applications with LLMs
2. **ReAct** (Reasoning and Acting) - A methodology that enables LLMs to reason about problems and take appropriate actions

## Technical Implementation

### New Files and Components Added

1. **Calculator API Route**
   - Location: `/app/api/calculator/route.ts`
   - Purpose: Provides an API endpoint for calculator functionality

2. **ReAct Agent Implementation**
   - Location: `/app/langchain/agents/react_agent.ts`
   - Purpose: Implements the ReAct methodology to enable reasoning about when to use the calculator vs. other tools

### Modified Components

1. **Chain Implementation**
   - Location: `/app/langchain/chains.ts`
   - Changes: Updated to integrate the calculator functionality with existing RAG and SerpAPI capabilities
   
2. **Chat API Route**
   - Location: `/app/api/chat/route.ts`
   - Changes: Modified to use the agent chain when appropriate

3. **Tools Implementation**
   - Location: `/app/langchain/tools.ts`
   - Changes: Added a calculator tool using LangChain's native calculator

4. **UI Components**
   - Location: `/app/components/Sidebar.tsx`
   - Changes: Added a calculator section to show that the feature is enabled

### Dependencies Added

- `@langchain/langgraph`: For building stateful agent workfl- `@langchain/langgraph`: For building stats a question, the application determines if it should use the ReAct agent based on whether a SerpAPI key is available.
2. If using the ReAct agent, the agent decides whether to:
   - Calculate a mathematical expression using the calculator tool
   - Search for information using SerpAPI
   - Query the database using SQL
   - Answer directly without tools
3. The agent uses a step-by-step reasoning process:
   - First, it analyzes the user's question
   - Then it decides which tool to use (if any)
   - It executes the chosen tool
   - It observes the result
   - Finally, it formulates a response based on the tool output

## Usage Examples

The calculator can be used for various mathematical operations:

- Basic arithmetic: Addition, subtraction, multiplication, division
- Complex expressions: Parentheses, exponents, etc.
- Conversions and more complex operations

For example, if a user asks:
```
What is 345 * 892 divided by 13.5?
```

The system will:
1. Recognize this requires calculation
2. Use the calculator tool to compute the result
3. Return the answer (22,824.89)

## Technical Design Considerations

- The calculator uses - The calculator uses - The calculator uses - The calculeAct is used to detect calculation needs, not pattern matching
- The implementation maintains all existing app workflows and functionality
- The agent can dynamically choose between SerpAPI and calculator as needed
