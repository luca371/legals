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

// Checks the account against its playbooks' screening criteria; the result is
// also stored on the account (lastScreening).
export async function screenAccount(accountId) {
  return invokeFunction('agent-account-screening', { accountId });
}

// Proposes the approval chain from the playbooks' approval rules. Fills the
// approval form only - a person reviews and sends it.
export async function proposeApprovers(agreementId) {
  return invokeFunction('agent-approval-route', { agreementId });
}
