import { invokeFunction } from './functionsClient';

// Fire-and-forget by design at most call sites — indexing failing should
// never block the user's actual save/create action.
export async function indexObject(objectType, objectId) {
  return invokeFunction('index-object', { objectType, objectId });
}

export async function semanticSearch(query, objectType, matchCount) {
  const data = await invokeFunction('semantic-search', { query, objectType, matchCount });
  return data?.results || [];
}
