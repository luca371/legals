const { callClaude } = require('../lib/aiBuilder');

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
    const { documentText, fields } = req.body || {};
    if (!documentText || !Array.isArray(fields)) {
      res.status(400).json({ error: 'documentText and fields are required.' });
      return;
    }

    const suggestions = await callClaude({
      documentText,
      fields,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    res.status(200).json({ suggestions });
  } catch (err) {
    console.error('AI Builder error:', err);
    res.status(500).json({ error: err.message || 'AI Builder failed.' });
  }
};