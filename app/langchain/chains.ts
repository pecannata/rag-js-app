import { RunnableSequence } from 'langchain-core/runnables';
import { StringOutputParser } from 'langchain-core/output_parsers';
import { PromptTemplate } from 'langchain-core/prompts';

// Create a RAG prompt template that includes SQL results
export const createRagPromptTemplate = () => {
  return PromptTemplate.fromTemplate(`
You are a helpful AI assistant that answers questions based on:
1. A user query
2. Optionally, SQL query results from an Oracle database

User Query: {query}

{sql_results}

Please provide a helpful, informative response addressing the user's question.
`);
};

// Create a chain that uses SQL results when available
export const createRagChain = (model, sqlTool, runSqlQuery = true) => {
  const promptTemplate = createRagPromptTemplate();
  const parser = new StringOutputParser();

  // Define the chain
  return RunnableSequence.from([
    {
      query: (input) => input.query,
      sql_results: async (input) => {
        if (!runSqlQuery) {
          return "SQL queries are disabled.";
        }
        
        try {
          // Use the SQL_QUERY_TEMPLATE from the application
          const sqlQuery = `
with q1 as (select lstat, medv, 
            ROUND(PREDICTION(BOSTON_GLM_REGRESSION_MODEL USING lstat, medv), 1) AS predict_mdev
            FROM BOSTON_TRAIN_TEST where train_test = 'test')
select q1.*, predict_mdev - medv as diff
from q1
order by 4
`;
          const results = await sqlTool.invoke(sqlQuery);
          return `SQL Results (${sqlQuery}):\n${results}`;
        } catch (error) {
          console.error('Error executing SQL query:', error);
          return "Error fetching SQL results.";
        }
      }
    },
    promptTemplate,
    model,
    parser
  ]);
};

