import { supabase } from './supabase';

export async function analyzeTemplateWithAI(documentText, fields) {
  const { data, error } = await supabase.functions.invoke('ai-builder', {
    body: { documentText, fields },
  });

  if (error) throw new Error(error.message || 'AI Builder request failed.');
  return data?.suggestions || [];
}
