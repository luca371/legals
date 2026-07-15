export async function sendForSignature({
  documentBase64,
  documentName,
  fileExtension,
  signers,
  emailSubject,
  emailMessage,
}) {
  const response = await fetch('/api/docusign-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentBase64,
      documentName,
      fileExtension,
      signers,
      emailSubject,
      emailMessage,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `DocuSign send failed (${response.status}).`);
  }

  return response.json();
}

export async function getSignatureStatus(envelopeId) {
  const response = await fetch('/api/docusign-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelopeId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `DocuSign status check failed (${response.status}).`);
  }

  return response.json();
}

export async function getSignedDocument(envelopeId, documentId) {
  const response = await fetch('/api/docusign-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelopeId, documentId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `DocuSign document fetch failed (${response.status}).`);
  }

  return response.json();
}