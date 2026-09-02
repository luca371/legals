import { invokeFunction } from './functionsClient';

export async function analyzeTemplateWithAI(documentText, fields) {
  const data = await invokeFunction('ai-builder', { documentText, fields });
  return data?.suggestions || [];
}

export async function suggestClausesWithAI(documentText, metadata) {
  const data = await invokeFunction('suggest-clauses', { documentText, metadata });
  return {
    missingClauses: data?.missingClauses || [],
    existingClauses: data?.existingClauses || [],
  };
}

export async function analyzeClauseWithAI(clauseTitle, clauseText, metadata) {
  return invokeFunction('analyze-clause', { clauseTitle, clauseText, metadata });
}
