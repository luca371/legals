import { supabase } from './supabase';

export async function reviewAgreementWithAI(documentText, metadata) {
  const { data, error } = await supabase.functions.invoke('review-agreement', {
    body: { documentText, metadata },
  });

  if (error) throw new Error(error.message || 'Review request failed.');
  return data;
}
