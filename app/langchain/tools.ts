import { DynamicTool } from 'langchain/tools';
import { Calculator as MathCalculator } from '@langchain/community/tools/calculator';

// This tool will use our existing SQL query function but wrap it for LangChain
export const createSqlQueryTool = (fetchSqlResults: (query: string) => Promise<any>) => {
  return new DynamicTool({
    name: "sql_query",
    description: "Execute SQL queries against the Oracle database",
    func: async (input: string) => {
      try {
        const result = await fetchSqlResults(input);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error executing SQL query: ${error}`;
      }
    },
  });
};

// Create a calculator tool using LangChain's native calculator
export const createCalculatorTool = () => {
  // If MathCalculator import fails, we'll create a basic calculator tool
  try {
    return new MathCalculator();
  } catch (error) {
    console.error("Failed to import Calculator from @langchain/community, creating a basic calculator:", error);
    
    // Create a simple calculator tool that uses JavaScript's eval
    return new DynamicTool({
      name: "calculator",
      description: "Useful for performing mathematical calculations",
      func: async (input: string) => {
        try {
          // Create a safe version of eval that only handles math expressions
          const safeEval = (expr: string) => {
            // Remove all characters except numbers, basic operators, parentheses, and decimal points
            const sanitizedExpr = expr.replace(/[^0-9+\-*/().]/g, '');
            
            // Use Function instead of eval for slightly safer execution
            // Still not completely safe, but better than direct eval
            return Function('"use strict"; return (' + sanitizedExpr + ')')();
          };
          
          const result = safeEval(input);
          return result.toString();
        } catch (error) {
          return `Error performing calculation: ${error}`;
        }
      }
    });
  }
};
