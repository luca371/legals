import { supabase } from './supabase';

export async function analyzeTemplateWithAI(documentText, fields) {
  const { data, error } = await supabase.functions.invoke('ai-builder', {
    body: { documentText, fields },
  });

  if (error) throw new Error(error.message || 'AI Builder request failed.');
  return data?.suggestions || [];
}

export async function suggestClausesWithAI(documentText, metadata) {
  const { data, error } = await supabase.functions.invoke('suggest-clauses', {
    body: { documentText, metadata },
  });

  if (error) throw new Error(error.message || 'Suggest clauses request failed.');
  return {
    missingClauses: data?.missingClauses || [],
    existingClauses: data?.existingClauses || [],
  };
}
