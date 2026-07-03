// Shared between server/index.js (local dev proxy) and api/docusign-*.js
// (Vercel serverless functions). Holds the DocuSign JWT auth + envelope
// logic — the RSA private key and Integration Key only ever live here,
// server-side, exactly like the Anthropic API key in lib/aiBuilder.js.
//
// This targets the DocuSign SANDBOX (demo) environment. When you eventually
// go live, DOCUSIGN_AUTH_SERVER and DOCUSIGN_BASE_PATH both change (see
// comments below), and you'll need a new RSA keypair + consent for the
// production Integration Key.

const jwt = require('jsonwebtoken');

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com'; // production: account.docusign.com
const DOCUSIGN_BASE_PATH = 'https://demo.docusign.net/restapi'; // production: https://{your account's base URI}/restapi

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

// Sends one document to one signer. Uses an anchor-text tab: DocuSign
// looks for the literal text "/sig1/" somewhere in the document and places
// the signature field right there. Add that exact text to a template
// wherever the signature should go (tip: make it small/white in Word so
// it isn't visually distracting — DocuSign still finds it in the text
// layer). Falls back to a fixed position on page 1 if no anchor is found,
// so sending never silently fails just because the anchor is missing.
async function sendEnvelopeForSignature({
  accountId,
  accessToken,
  documentBase64,
  documentName,
  fileExtension,
  signerEmail,
  signerName,
  emailSubject,
  emailMessage,
}) {
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
      signers: [
        {
          email: signerEmail,
          name: signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [
              {
                anchorString: '/sig1/',
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '-10',
                anchorIgnoreIfNotPresent: 'true',
              },
              {
                documentId: '1',
                pageNumber: '1',
                xPosition: '100',
                yPosition: '700',
                anchorIgnoreIfNotPresent: 'true',
              },
            ],
          },
        },
      ],
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