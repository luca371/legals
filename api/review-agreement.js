const { reviewAgreement } = require('../lib/reviewAgreement');

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
    const { documentText, metadata } = req.body || {};
    const review = await reviewAgreement({
      documentText,
      metadata,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    res.status(200).json(review);
  } catch (err) {
    console.error('Review AI error:', err);
    res.status(500).json({ error: err.message || 'Review failed.' });
  }
};