import { invokeFunction } from './functionsClient';

export async function sendToClaudeWithTools(messages) {
  return invokeFunction('ask-ai', { messages });
}
