// Vercel serverless function — checks the current status of a DocuSign
// envelope (sent, delivered, completed, declined, voided...).

const { getAccessToken, getEnvelopeStatus } = require('../lib/docusign');

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
    const { envelopeId } = req.body || {};
    if (!envelopeId) {
      res.status(400).json({ error: 'envelopeId is required.' });
      return;
    }

    const accessToken = await getAccessToken({
      integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
      userId: process.env.DOCUSIGN_USER_ID,
      privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
    });

    const status = await getEnvelopeStatus({
      accountId: process.env.DOCUSIGN_ACCOUNT_ID,
      accessToken,
      envelopeId,
    });

    res.status(200).json(status);
  } catch (err) {
    console.error('DocuSign status error:', err);
    res.status(500).json({ error: err.message || 'DocuSign status check failed.' });
  }
};