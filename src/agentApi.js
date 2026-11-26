import { invokeFunction } from './functionsClient';

export async function prepareAccountBrief(accountId) {
  return invokeFunction('agent-account-brief', { accountId });
}

// Proposals only - nothing is saved until the user accepts them
// (createObligations in supabase.js).
export async function findObligations(agreementId) {
  return invokeFunction('agent-obligations', { agreementId });
}

export async function prepareRenewalBrief(agreementId) {
  return invokeFunction('agent-renewal-brief', { agreementId });
}
