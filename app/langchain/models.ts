import { ChatCohere } from '@langchain/cohere';
import { StringOutputParser } from 'langchain-core/output_parsers';

export const getCohereModel = (apiKey: string, modelName: string = 'command-r-plus') => {
  return new ChatCohere({
    apiKey,
    model: modelName,
    temperature: 0.7,
  });
};

export const outputParser = new StringOutputParser();

