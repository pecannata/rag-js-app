import { ConversationSummaryMemory } from 'langchain/memory';
import { getCohereModel } from './models';

export const createConversationMemory = (apiKey: string) => {
  const model = getCohereModel(apiKey);
  
  return new ConversationSummaryMemory({
    memoryKey: "chat_history",
    llm: model,
  });
};

