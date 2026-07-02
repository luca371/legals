// Vercel serverless function — thin proxy for the Ask AI chat. Set
// ANTHROPIC_API_KEY as an Environment Variable in the Vercel project
// dashboard (same one used by api/ai-builder.js). Never exposed to the
// browser — this function runs server-side only, and never touches
// Firestore itself (see lib/askAi.js for why).

const { askClaude } = require('../lib/askAi');

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
    const { messages } = req.body || {};
    const result = await askClaude({ messages, apiKey: process.env.ANTHROPIC_API_KEY });
    res.status(200).json(result);
  } catch (err) {
    console.error('Ask AI error:', err);
    res.status(500).json({ error: err.message || 'Ask AI failed.' });
  }
};