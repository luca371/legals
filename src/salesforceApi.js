import { invokeFunction } from './functionsClient';

export async function syncAccountsFromSalesforce() {
  return invokeFunction('sf-sync', {});
}

export async function pushAttachmentToSalesforce(agreementId, attachmentId) {
  return invokeFunction('sf-push', { agreementId, attachmentId });
}

export async function syncAgreementToSalesforce(agreementId) {
  return invokeFunction('sf-sync-agreement', { agreementId });
}

// Admin-only: manage this organization's Salesforce connection.
export async function getSalesforceConnection() {
  return invokeFunction('sf-connection', { action: 'status' });
}

export async function generateSalesforceCertificate() {
  return invokeFunction('sf-connection', { action: 'generate-certificate' });
}

export async function saveSalesforceConnection({ environment, instanceUrl, clientId, username }) {
  return invokeFunction('sf-connection', { action: 'save', environment, instanceUrl, clientId, username });
}

export async function testSalesforceConnection() {
  return invokeFunction('sf-connection', { action: 'test' });
}

export async function disconnectSalesforce() {
  return invokeFunction('sf-connection', { action: 'disconnect' });
}
