import { supabase } from './supabase';

export async function sendForSignature({
  documentBase64,
  documentName,
  fileExtension,
  signers,
  emailSubject,
  emailMessage,
}) {
  const { data, error } = await supabase.functions.invoke('docusign-send', {
    body: { documentBase64, documentName, fileExtension, signers, emailSubject, emailMessage },
  });

  if (error) throw new Error(error.message || 'DocuSign send failed.');
  return data;
}

export async function getSignatureStatus(envelopeId) {
  const { data, error } = await supabase.functions.invoke('docusign-status', {
    body: { envelopeId },
  });

  if (error) throw new Error(error.message || 'DocuSign status check failed.');
  return data;
}

export async function getSignedDocument(envelopeId, documentId) {
  const { data, error } = await supabase.functions.invoke('docusign-document', {
    body: { envelopeId, documentId },
  });

  if (error) throw new Error(error.message || 'DocuSign document fetch failed.');
  return data;
}
