// Local development proxy for the AI Builder feature — mirrors what the
// Vercel function (api/ai-builder.js) does in production. Run this
// separately from the React dev server:
//
//   1. npm install express cors dotenv --save-dev
//   2. Create a .env file at the project root (same level as package.json)
//      with: ANTHROPIC_API_KEY=sk-ant-...   <- your NEW key, after
//      revoking the one that was pasted in chat
//   3. Add .env to .gitignore (should not be committed, ever)
//   4. In package.json, add:  "proxy": "http://localhost:3001"
//      (this makes CRA forward unmatched requests like /api/ai-builder
//      from localhost:3000 to this server, so the React code can call
//      the exact same relative URL in dev and in production)
//   5. Run this server:  node server/index.js
//   6. In another terminal, run the app as usual:  npm start
//
// The API key lives ONLY in this process's environment — it is never
// sent to, or bundled into, the React app.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callClaude } = require('../lib/aiBuilder');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.post('/api/ai-builder', async (req, res) => {
  try {
    const { documentText, fields } = req.body || {};
    if (!documentText || !Array.isArray(fields)) {
      return res.status(400).json({ error: 'documentText and fields are required.' });
    }

    const suggestions = await callClaude({
      documentText,
      fields,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    res.json({ suggestions });
  } catch (err) {
    console.error('AI Builder error:', err);
    res.status(500).json({ error: err.message || 'AI Builder failed.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AI Builder local proxy running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY is not set — create a .env file (see comments at the top of this file).');
  }
});