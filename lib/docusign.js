const jwt = require('jsonwebtoken');

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com'; 
const DOCUSIGN_BASE_PATH = 'https://demo.docusign.net/restapi'; 

async function getAccessToken({ integrationKey, userId, privateKey }) {
  if (!integrationKey || !userId || !privateKey) {
    throw new Error('Missing DocuSign credentials on the server (integration key, user id, or private key).');
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: integrationKey,
      sub: userId,
      aud: DOCUSIGN_AUTH_SERVER,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    },
    privateKey,
    { algorithm: 'RS256' }
  );

  const response = await fetch(`https://${DOCUSIGN_AUTH_SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign auth failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function sendEnvelopeForSignature({
  accountId,
  accessToken,
  documentBase64,
  documentName,
  fileExtension,
  signers, 
  emailSubject,
  emailMessage,
}) {
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new Error('At least one signer is required.');
  }

  const signerRecipients = signers.map((signer, index) => {
    const n = index + 1;
    return {
      email: signer.email,
      name: signer.name,
      recipientId: String(n),
      routingOrder: String(n),
      tabs: {
        signHereTabs: [
          {
            anchorString: `/sig${n}/`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-10',
          },
        ],
        fullNameTabs: [
          {
            anchorString: `/name${n}/`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-10',
            anchorIgnoreIfNotPresent: 'true',
          },
        ],
        titleTabs: [
          {
            anchorString: `/title${n}/`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-10',
            anchorIgnoreIfNotPresent: 'true',
          },
        ],
        dateSignedTabs: [
          {
            anchorString: `/date${n}/`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-10',
            anchorIgnoreIfNotPresent: 'true',
          },
        ],
      },
    };
  });

  const envelopeDefinition = {
    emailSubject: emailSubject || `Please sign: ${documentName || 'document'}`,
    emailBlurb: emailMessage || '',
    documents: [
      {
        documentBase64,
        name: documentName || 'document',
        fileExtension: fileExtension || 'pdf',
        documentId: '1',
      },
    ],
    recipients: {
      signers: signerRecipients,
    },
    status: 'sent',
  };

  const response = await fetch(`${DOCUSIGN_BASE_PATH}/v2.1/accounts/${accountId}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelopeDefinition),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign envelope creation failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json(); // { envelopeId, status, statusDateTime, uri }
}

async function getEnvelopeStatus({ accountId, accessToken, envelopeId }) {
  const response = await fetch(`${DOCUSIGN_BASE_PATH}/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign status check failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json(); // { status, statusDateTime, ... }
}

async function getEnvelopeDocument({ accountId, accessToken, envelopeId, documentId = '1' }) {
  const response = await fetch(
    `${DOCUSIGN_BASE_PATH}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${documentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign document fetch failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const dataBase64 = Buffer.from(arrayBuffer).toString('base64');
  return { dataBase64, mimeType: 'application/pdf' };
}

module.exports = { getAccessToken, sendEnvelopeForSignature, getEnvelopeStatus, getEnvelopeDocument };