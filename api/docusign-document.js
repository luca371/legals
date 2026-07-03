// Vercel serverless function — downloads the (signed) document from a
// DocuSign envelope, base64-encoded, ready to store as a Legal Space
// attachment.

const { getAccessToken, getEnvelopeDocument } = require('../lib/docusign');

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
    const { envelopeId, documentId } = req.body || {};
    if (!envelopeId) {
      res.status(400).json({ error: 'envelopeId is required.' });
      return;
    }

    const accessToken = await getAccessToken({
      integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
      userId: process.env.DOCUSIGN_USER_ID,
      privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
    });

    const document = await getEnvelopeDocument({
      accountId: process.env.DOCUSIGN_ACCOUNT_ID,
      accessToken,
      envelopeId,
      documentId,
    });

    res.status(200).json(document);
  } catch (err) {
    console.error('DocuSign document fetch error:', err);
    res.status(500).json({ error: err.message || 'DocuSign document fetch failed.' });
  }
};