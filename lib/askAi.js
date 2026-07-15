const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are the AI assistant embedded in "Legal Space", a contract lifecycle management platform. You help the user answer questions about their organization's accounts and agreements (contracts) — things like "how many agreements does account X have", "what clauses are in contract Y", "which agreements are expiring soon", "list all NDAs with account Z", etc.

You have tools to look up real data — ALWAYS use them rather than guessing or making anything up. Typical flow:
- To find agreements for a company, call list_agreements with accountName — agreements already store the account name directly, so you don't need to look up an account id first just for this.
- To answer anything about a SPECIFIC contract's content, clauses, obligations, or terms, first find it with list_agreements (by title and/or account), then call get_agreement_details with its id to read the actual document text.
- To answer questions about an account's own info (not its contracts), use get_account_details.
- If a lookup returns nothing, or several records could match, ask a short clarifying question instead of guessing — never invent agreements, accounts, or contract content that a tool didn't actually return.

Answer conversationally and concisely, in the same language the user asked in. When referencing a specific agreement or account, use its real title/name so the user recognizes it.`;

const TOOLS = [
  {
    name: 'list_accounts',
    description: 'Lists all accounts (companies/clients) in the organization with basic info (name, type, country). Use to browse accounts or resolve a company name to an account id.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_agreements',
    description: "Lists agreements (contracts) with compact summaries (title, account, type, status, dates) — no document text included. Use get_agreement_details afterwards to read a specific contract's full content.",
    input_schema: {
      type: 'object',
      properties: {
        accountName: { type: 'string', description: 'Filter by account/company name (partial match, case-insensitive)' },
        titleContains: { type: 'string', description: 'Filter by agreement title (partial match, case-insensitive)' },
        status: { type: 'string', description: 'Filter by exact status, e.g. Draft, Activated, Signed' },
        agreementType: { type: 'string', description: 'Filter by agreement type' },
      },
      required: [],
    },
  },
  {
    name: 'get_agreement_details',
    description: 'Gets full details of ONE agreement by id, including the extracted text of its attached document(s). Use this whenever the user asks about clauses, terms, obligations, or any specific content inside a contract.',
    input_schema: {
      type: 'object',
      properties: { agreementId: { type: 'string' } },
      required: ['agreementId'],
    },
  },
  {
    name: 'get_account_details',
    description: 'Gets full details of ONE account by id, including a summary list of every agreement linked to it.',
    input_schema: {
      type: 'object',
      properties: { accountId: { type: 'string' } },
      required: ['accountId'],
    },
  },
];

async function askClaude({ messages, apiKey }) {
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY on the server.');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API error (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json();
}

module.exports = { askClaude, TOOLS };