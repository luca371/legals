// Vercel serverless function — sends a document to DocuSign for signature.
// Requires these Environment Variables in the Vercel dashboard:
//   DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID,
//   DOCUSIGN_PRIVATE_KEY (the full RSA private key, PEM format)

const { getAccessToken, sendEnvelopeForSignature } = require('../lib/docusign');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { documentBase64, documentName, fileExtension, signerEmail, signerName, emailSubject, emailMessage } =
      req.body || {};

    if (!documentBase64 || !signerEmail || !signerName) {
      res.status(400).json({ error: 'documentBase64, signerEmail, and signerName are required.' });
      return;
    }

    const accessToken = await getAccessToken({
      integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
      userId: process.env.DOCUSIGN_USER_ID,
      privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
    });

    const envelope = await sendEnvelopeForSignature({
      accountId: process.env.DOCUSIGN_ACCOUNT_ID,
      accessToken,
      documentBase64,
      documentName,
      fileExtension,
      signerEmail,
      signerName,
      emailSubject,
      emailMessage,
    });

    res.status(200).json(envelope);
  } catch (err) {
    console.error('DocuSign send error:', err);
    res.status(500).json({ error: err.message || 'DocuSign send failed.' });
  }
};