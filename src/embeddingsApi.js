import { invokeFunction } from './functionsClient';

// Fire-and-forget by design at most call sites — indexing failing should
// never block the user's actual save/create action.
export async function indexAgreement(agreementId) {
  return invokeFunction('index-agreement', { agreementId });
}

export async function semanticSearchAgreements(query, matchCount) {
  const data = await invokeFunction('semantic-search-agreements', { query, matchCount });
  return data?.results || [];
}
