import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are the AI assistant embedded in "Legal Space", a contract lifecycle management platform. You help the user answer questions about their organization's accounts and agreements (contracts) — things like "how many agreements does account X have", "what clauses are in contract Y", "which agreements are expiring soon", "list all NDAs with account Z", etc.

You have tools to look up real data — ALWAYS use them rather than guessing or making anything up. Typical flow:
- To find agreements by exact metadata (a specific account, type, status), call list_agreements — agreements already store the account name directly, so you don't need to look up an account id first just for this.
- To find agreements by TOPIC, subject matter, or a concept described in prose (e.g. "contracts about data processing", "anything mentioning exclusivity", "agreements similar to X") — where you don't have an exact title/type/account to filter on — call search_agreements_semantic instead. It searches the actual document content by meaning, not just metadata.
- To answer anything about a SPECIFIC contract's content, clauses, obligations, or terms, first find it with list_agreements or search_agreements_semantic, then call get_agreement_details with its id to read the actual document text.
- To answer questions about an account's own info (not its contracts), use get_account_details.
- If a lookup returns nothing, or several records could match, ask a short clarifying question instead of guessing — never invent agreements, accounts, or contract content that a tool didn't actually return.

CHARTS AND DASHBOARDS: if the user asks for a dashboard, chart, graph, breakdown, or any visual summary of their data (e.g. "show me a dashboard of agreements by status", "chart expiring contracts by month", "pie chart of agreement types for account X"), don't just describe the numbers in text — call render_chart to actually render it. First gather the real records with the other tools (list_agreements, list_accounts, search_agreements_semantic, etc.), then compute the aggregation yourself (counts, group-bys, sums) from that real data, then call render_chart with the finished data points. Never invent numbers — every value in the chart must trace back to records a tool actually returned. After the chart renders, give a brief one to two sentence takeaway in text, don't repeat the whole data table.

Answer conversationally and concisely, in the same language the user asked in. When referencing a specific agreement or account, use its real title/name so the user recognizes it.`;

const TOOLS = [
  {
    name: 'list_accounts',
    description:
      'Lists all accounts (companies/clients) in the organization with basic info (name, type, country). Use to browse accounts or resolve a company name to an account id.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_agreements',
    description:
      "Lists agreements (contracts) with compact summaries (title, account, type, status, dates, createdBy — the email of who created it) — no document text included. There's no server-side filter for createdBy, but every returned record has it, so count/filter by creator yourself after fetching. Use get_agreement_details afterwards to read a specific contract's full content.",
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
    name: 'search_agreements_semantic',
    description:
      'Searches agreements by MEANING across their full document content, not just title or metadata — use this when the question is about a topic, subject, or concept a contract might discuss, rather than an exact field to filter on. Returns the most relevant agreements ranked by relevance (best first).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language description of what to search for, e.g. "data processing obligations" or "exclusivity clauses"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_agreement_details',
    description:
      'Gets full details of ONE agreement by id, including the extracted text of its attached document(s). Use this whenever the user asks about clauses, terms, obligations, or any specific content inside a contract.',
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
  {
    name: 'render_chart',
    description:
      'Renders an interactive chart directly in the chat for the user. Use this for any dashboard/chart/graph/visual-breakdown request — never just describe the numbers in text. Call it AFTER gathering the real data with other tools and computing the aggregation yourself; every data point must come from real records, never invented.',
    input_schema: {
      type: 'object',
      properties: {
        chartType: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'bar for comparing categories, line for a trend over time/ordered buckets, pie for a part-of-whole breakdown' },
        title: { type: 'string', description: 'Short chart title, in the language the user asked in' },
        data: {
          type: 'array',
          description: 'The finished, already-aggregated data points to plot.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Category/x-axis label' },
              value: { type: 'number', description: 'The numeric value for this category' },
            },
            required: ['name', 'value'],
          },
        },
      },
      required: ['chartType', 'title', 'data'],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: 'messages must be a non-empty array.' }, 400);
    }

    const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    return jsonResponse(data);
  } catch (err) {
    console.error('Ask AI error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Ask AI failed.' }, 500);
  }
});
