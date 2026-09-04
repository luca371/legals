import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';

const SYSTEM_PROMPT = `You are the AI assistant embedded in "Legal Space", a contract lifecycle management platform. You help the user answer questions about their organization's accounts and agreements (contracts) — things like "how many agreements does account X have", "what clauses are in contract Y", "which agreements are expiring soon", "list all NDAs with account Z", etc.

You have tools to look up real data — ALWAYS use them rather than guessing or making anything up. Typical flow:
- To find agreements by exact metadata (a specific account, type, status), call list_agreements — agreements already store the account name directly, so you don't need to look up an account id first just for this.
- To find agreements by TOPIC, subject matter, or a concept described in prose (e.g. "contracts about data processing", "anything mentioning exclusivity", "agreements similar to X") — where you don't have an exact title/type/account to filter on — call search_agreements_semantic instead. It searches the actual document content by meaning, not just metadata.
- To answer anything about a SPECIFIC contract's content, clauses, obligations, or terms, first find it with list_agreements or search_agreements_semantic, then call get_agreement_details with its id to read the actual document text.
- To answer questions about an account's own info (not its contracts), use get_account_details.
- If a lookup returns nothing, or several records could match, ask a short clarifying question instead of guessing — never invent agreements, accounts, or contract content that a tool didn't actually return.

CHARTS AND DASHBOARDS: if the user asks for a dashboard, chart, graph, breakdown, or any visual summary of their data (e.g. "show me a dashboard of agreements by status", "chart expiring contracts by month", "pie chart of agreement types for account X"), don't just describe the numbers in text — call render_chart to actually render it. Gather the real records first with the other tools (list_agreements, list_accounts, search_agreements_semantic, etc.), then pass those records (one object per agreement/account, trimmed to just the fields that matter) straight to render_chart along with which field is the category and, when relevant, which other fields the user should be able to filter by (account, type, status, etc.) — the chart renders WITH those as interactive dropdown filters client-side, so you don't need to pre-aggregate by hand or generate separate charts per breakdown; the user filters the one chart themselves. Never invent records or fields — everything must trace back to what a tool actually returned. After the chart renders, give a brief one to two sentence takeaway in text, don't repeat the whole data table.

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
      'Renders an interactive chart directly in the chat, with optional dropdown filters the user can operate themselves (no follow-up message needed to see a different breakdown). Use this for any dashboard/chart/graph/visual-breakdown request — never just describe the numbers in text. Call it AFTER gathering the real data with other tools; pass the raw records straight through (don\'t pre-aggregate), and let the chart do the grouping.',
    input_schema: {
      type: 'object',
      properties: {
        chartType: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'bar for comparing categories, line for a trend over time/ordered buckets, pie for a part-of-whole breakdown' },
        title: { type: 'string', description: 'Short chart title, in the language the user asked in' },
        records: {
          type: 'array',
          description: 'One object per real underlying record (e.g. one per agreement) — every value must come from a tool result, never invented. Include the category field, an optional numeric value field, and any other fields useful as filters.',
          items: { type: 'object' },
        },
        categoryField: { type: 'string', description: 'Name of the field in each record to group by for the chart\'s category/x-axis (e.g. "status", "account", "agreementType").' },
        valueField: { type: 'string', description: 'Optional: name of a numeric field in each record to sum per category (e.g. "durationDays"). Omit to just count records per category.' },
        filterFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field names to expose as dropdown filters above the chart (e.g. ["account", "agreementType", "status"]) — pick fields with a small number of distinct values. Omit or leave empty if nothing sensible to filter by.',
        },
      },
      required: ['chartType', 'title', 'records', 'categoryField'],
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
