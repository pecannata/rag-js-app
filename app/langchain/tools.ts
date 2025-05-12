import { DynamicTool } from 'langchain/tools';

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

