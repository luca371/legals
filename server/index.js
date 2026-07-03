// Local development proxy — mirrors what the Vercel functions do in
// production (api/ai-builder.js and api/ask-ai.js). Run this separately
// from the React dev server:
//
//   1. npm install express cors dotenv --save-dev   (already done if you
//      set up AI Builder earlier)
//   2. Create a .env file at the project root with:
//      ANTHROPIC_API_KEY=sk-ant-...
//   3. Add .env to .gitignore (should not be committed, ever)
//   4. Add src/setupProxy.js pointing '/api' at this server (already done
//      if you set up AI Builder earlier)
//   5. Run this server:  node server/index.js
//   6. In another terminal, run the app as usual:  npm start
//
// The API key lives ONLY in this process's environment — it is never
// sent to, or bundled into, the React app.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callClaude } = require('../lib/aiBuilder');
const { askClaude } = require('../lib/askAi');
const { reviewAgreement } = require('../lib/reviewAgreement');
const { getAccessToken, sendEnvelopeForSignature, getEnvelopeStatus, getEnvelopeDocument } = require('../lib/docusign');

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

app.post('/api/ask-ai', async (req, res) => {
  try {
    const { messages } = req.body || {};
    const result = await askClaude({ messages, apiKey: process.env.ANTHROPIC_API_KEY });
    res.json(result);
  } catch (err) {
    console.error('Ask AI error:', err);
    res.status(500).json({ error: err.message || 'Ask AI failed.' });
  }
});

app.post('/api/review-agreement', async (req, res) => {
  try {
    const { documentText, metadata } = req.body || {};
    const review = await reviewAgreement({ documentText, metadata, apiKey: process.env.ANTHROPIC_API_KEY });
    res.json(review);
  } catch (err) {
    console.error('Review AI error:', err);
    res.status(500).json({ error: err.message || 'Review failed.' });
  }
});

app.post('/api/docusign-send', async (req, res) => {
  try {
    const { documentBase64, documentName, fileExtension, signers, emailSubject, emailMessage } = req.body || {};
    if (!documentBase64 || !Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ error: 'documentBase64 and at least one signer are required.' });
    }
    if (signers.some((s) => !s.email || !s.name)) {
      return res.status(400).json({ error: 'Every signer needs a name and email.' });
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
      signers,
      emailSubject,
      emailMessage,
    });
    res.json(envelope);
  } catch (err) {
    console.error('DocuSign send error:', err);
    res.status(500).json({ error: err.message || 'DocuSign send failed.' });
  }
});

app.post('/api/docusign-status', async (req, res) => {
  try {
    const { envelopeId } = req.body || {};
    if (!envelopeId) return res.status(400).json({ error: 'envelopeId is required.' });
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
    res.json(status);
  } catch (err) {
    console.error('DocuSign status error:', err);
    res.status(500).json({ error: err.message || 'DocuSign status check failed.' });
  }
});

app.post('/api/docusign-document', async (req, res) => {
  try {
    const { envelopeId, documentId } = req.body || {};
    if (!envelopeId) return res.status(400).json({ error: 'envelopeId is required.' });
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
    res.json(document);
  } catch (err) {
    console.error('DocuSign document fetch error:', err);
    res.status(500).json({ error: err.message || 'DocuSign document fetch failed.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AI proxy (AI Builder + Ask AI + Review + DocuSign) running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY is not set — create a .env file (see comments at the top of this file).');
  }
  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    console.warn('⚠️  DOCUSIGN_INTEGRATION_KEY is not set — DocuSign features will fail until it is.');
  }
});