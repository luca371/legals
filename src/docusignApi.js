import { invokeFunction } from './functionsClient';

export async function sendForSignature({
  documentBase64,
  documentName,
  fileExtension,
  signers,
  ccRecipients,
  emailSubject,
  emailMessage,
}) {
  return invokeFunction('docusign-send', {
    documentBase64,
    documentName,
    fileExtension,
    signers,
    ccRecipients,
    emailSubject,
    emailMessage,
  });
}

export async function getSignatureStatus(envelopeId) {
  return invokeFunction('docusign-status', { envelopeId });
}

export async function getSignedDocument(envelopeId, documentId) {
  return invokeFunction('docusign-document', { envelopeId, documentId });
}
