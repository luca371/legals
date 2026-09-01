import jwt from 'npm:jsonwebtoken@9.0.3';

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com';
const DOCUSIGN_BASE_PATH = 'https://demo.docusign.net/restapi';

export interface DocusignCreds {
  integrationKey?: string;
  userId?: string;
  privateKey?: string;
}

export async function getAccessToken({ integrationKey, userId, privateKey }: DocusignCreds) {
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
  return data.access_token as string;
}

export async function sendEnvelopeForSignature({
  accountId,
  accessToken,
  documentBase64,
  documentName,
  fileExtension,
  signers,
  ccRecipients,
  emailSubject,
  emailMessage,
}: {
  accountId?: string;
  accessToken: string;
  documentBase64: string;
  documentName?: string;
  fileExtension?: string;
  signers: Array<{ email: string; name: string }>;
  ccRecipients?: Array<{ email: string; name: string }>;
  emailSubject?: string;
  emailMessage?: string;
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
          { anchorString: `/sig${n}/`, anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '-10' },
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

  const ccRecipientEntries = (ccRecipients || [])
    .filter((r) => r.email)
    .map((r, index) => ({
      email: r.email,
      name: r.name || r.email,
      recipientId: String(signerRecipients.length + index + 1),
      routingOrder: String(signers.length + 1),
    }));

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
      ...(ccRecipientEntries.length > 0 ? { carbonCopies: ccRecipientEntries } : {}),
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

  return response.json();
}

export async function getEnvelopeStatus({
  accountId,
  accessToken,
  envelopeId,
}: {
  accountId?: string;
  accessToken: string;
  envelopeId: string;
}) {
  const response = await fetch(`${DOCUSIGN_BASE_PATH}/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign status check failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json();
}

export async function getEnvelopeDocument({
  accountId,
  accessToken,
  envelopeId,
  documentId = '1',
}: {
  accountId?: string;
  accessToken: string;
  envelopeId: string;
  documentId?: string;
}) {
  const response = await fetch(
    `${DOCUSIGN_BASE_PATH}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${documentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DocuSign document fetch failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const dataBase64 = btoa(binary);
  return { dataBase64, mimeType: 'application/pdf' };
}
