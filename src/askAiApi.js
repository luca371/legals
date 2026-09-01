import { supabase } from './supabase';

export async function sendToClaudeWithTools(messages) {
  const { data, error } = await supabase.functions.invoke('ask-ai', {
    body: { messages },
  });

  if (error) throw new Error(error.message || 'Ask AI request failed.');
  return data;
}
