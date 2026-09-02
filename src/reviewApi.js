import { invokeFunction } from './functionsClient';

export async function reviewAgreementWithAI(documentText, metadata) {
  return invokeFunction('review-agreement', { documentText, metadata });
}
