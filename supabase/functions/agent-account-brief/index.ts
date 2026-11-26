import mammoth from 'npm:mammoth@1.8.0';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';
import { MAX_PDF_BYTES_FOR_TEXT, isPdfAttachment, pdfToText } from '../_shared/pdf.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';

// Account brief agent. Read-only: it looks up the account's real data with
// tools, then writes a briefing for a quarterly review, a renewal or a
// negotiation. It never changes, sends or signs anything.

const MAX_STEPS = 8;
const MAX_TOKENS_PER_CALL = 4096;
const MAX_RUNS_PER_TENANT_PER_MONTH = 300;
const MAX_DOC_CHARS = 8000;

const SYSTEM_PROMPT = `You are the account-brief agent embedded in "EsoVia", a contract lifecycle management platform. A contract manager asks you to prepare a briefing on ONE account (a customer or supplier) before a quarterly business review, a renewal or a negotiation.

You have read-only tools. ALWAYS use them - never guess or invent anything. Typical flow:
1. Call list_account_agreements to see every agreement with this account.
2. Call get_agreement_details for the agreements that matter most (active ones, the ones expiring soon, the ones flagged high risk) - up to about 6 - to read their actual document text and terms. The document text is what makes the briefing valuable: key terms (duration, notice and renewal, liability, exclusivity, payment, confidentiality scope) must come from it, not from metadata alone. The list tool never includes document text, so do not conclude a document is empty before calling get_agreement_details.
3. Call list_account_playbooks to know which compliance rules apply to this account.
4. Write the briefing.

You are NOT providing legal advice. Keep everything at the level of "an experienced contract manager would flag this". Base every point only on data the tools returned - if something is not in the data, leave it out. Dates are YYYY-MM-DD; today's date is given in the user message.

QUALITY RULES:
- Only report real issues in the contracts or the relationship as risks or open items: an expired or unsigned agreement, a duplicate, a one-sided or missing term you actually read, a playbook violation, a pending signature.
- NEVER report missing data as a risk or an open item ("no AI review on file", "no playbook assigned", "no document text available"). If a document's text genuinely could not be read, mention it at most once, in "summary".
- Say each fact in exactly ONE section - the most relevant one. Do not repeat the same agreement, date or issue across "risks", "upcoming", "talkingPoints" and "openItems". Talking points must add something new (a question to ask, a position to take), not restate a risk.
- Be concise: fewer, stronger points beat a full list. Arrays may be empty.

LANGUAGE RULE: write the whole briefing in English.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{
  "headline": "<one sentence: the single most important thing to know about this relationship right now>",
  "summary": "<3-4 sentence overview of the relationship: how many agreements, what types, overall state>",
  "keyTerms": [{"agreement": "<agreement title>", "agreementId": "<id>", "point": "<specific term or commitment worth remembering - value, duration, notice period, exclusivity, liability cap...>"}],
  "risks": [{"issue": "<short label>", "severity": "low"|"medium"|"high", "detail": "<1-2 sentences, specific>", "agreementId": "<id or null>"}],
  "upcoming": [{"what": "<expiry, renewal or deadline>", "date": "<YYYY-MM-DD or null>", "agreementId": "<id or null>"}],
  "talkingPoints": ["<concrete point to raise in the meeting or negotiation>"],
  "openItems": ["<anything unresolved: drafts not finished, signatures pending, playbook violations outstanding>"]
}

Keep "keyTerms" to at most 8 items, "risks" to at most 6, "upcoming" to at most 6, "talkingPoints" to at most 6 and "openItems" to at most 6, most important first. Arrays may be empty. If the account has no agreements, say so plainly in "summary" and return empty arrays.`;

const TOOLS = [
  {
    name: 'list_account_agreements',
    description:
      "Lists every agreement of this account with compact info: id, title, type, subtype, status, effective and end date, last AI review (score, risk level, playbook violation count), DocuSign envelope statuses and any related (amended) agreement. No document text - use get_agreement_details for that.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_agreement_details',
    description:
      "Gets ONE agreement of this account by id: its metadata, custom fields, the last AI review summary and risks, and the text of its document(s) - the generated contract and any uploaded Word or PDF files, scans included (truncated if long). Reading a PDF takes a few seconds.",
    input_schema: {
      type: 'object',
      properties: { agreementId: { type: 'string' } },
      required: ['agreementId'],
    },
  },
  {
    name: 'list_account_playbooks',
    description: 'Lists the playbooks (compliance rules) assigned to this account.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

function stripHtml(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Generated contracts keep their text in attachment.sourceHtml; uploaded
// Word files are base64 in attachment.dataBase64 (same layout index-object
// reads). PDFs (text or scanned) are transcribed by Claude - that costs
// tokens, so only the first few small ones per agreement are read.
const MAX_PDFS_PER_AGREEMENT = 3;

async function attachmentText(attachment: Row, allowPdf: boolean): Promise<string> {
  if (!attachment) return '';
  if (attachment.sourceHtml) return stripHtml(String(attachment.sourceHtml));
  if (attachment.dataBase64 && isPdfAttachment(attachment)) {
    if (!allowPdf || (attachment.size ?? 0) > MAX_PDF_BYTES_FOR_TEXT) return '';
    try {
      return await pdfToText(Deno.env.get('ANTHROPIC_API_KEY') ?? '', attachment.dataBase64);
    } catch (err) {
      console.error('PDF transcription failed:', err);
      return '';
    }
  }
  if (attachment.dataBase64) {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: base64ToArrayBuffer(attachment.dataBase64) });
      return (result.value || '').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
  return '';
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const limited = await enforceAiLimit(auth, 'agent-account-brief');
  if (limited) return limited;
  const { admin, callerClient, user, tenantId } = auth;

  let runId: string | null = null;
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const { accountId } = await req.json();
    if (!accountId || typeof accountId !== 'string') {
      return jsonResponse({ error: 'accountId is required.' }, 400);
    }

    // All reads go through callerClient, so RLS decides what the agent can
    // see - exactly what the signed-in user could open themselves.
    const { data: account, error: accountError } = await callerClient
      .from('accounts')
      .select('id, name, country, city, status, custom_fields, created_at')
      .eq('id', accountId)
      .single();
    if (accountError || !account) {
      return jsonResponse({ error: "This account doesn't exist or you can't access it." }, 404);
    }

    const { count: runsThisMonth } = await admin
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStartIso());
    if ((runsThisMonth ?? 0) >= MAX_RUNS_PER_TENANT_PER_MONTH) {
      return jsonResponse({ error: 'Your organization reached its monthly limit of agent runs.' }, 429);
    }

    const { data: run } = await admin
      .from('agent_runs')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        actor_email: user.email ?? '',
        agent: 'account_brief',
        subject_type: 'account',
        subject_id: accountId,
      })
      .select('id')
      .single();
    runId = run?.id ?? null;

    // -- tools ---------------------------------------------------------------

    const runTool = async (name: string, input: Row) => {
      if (name === 'list_account_agreements') {
        const { data, error } = await callerClient
          .from('agreements')
          .select(
            'id, title, agreement_type, agreement_subtype, status, effective_date, end_date, related_agreement_id, relation_type, last_ai_review, docusign_envelopes'
          )
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data || []).map((a: Row) => ({
          id: a.id,
          title: a.title,
          type: a.agreement_type,
          subtype: a.agreement_subtype,
          status: a.status,
          effectiveDate: a.effective_date,
          endDate: a.end_date,
          relatedAgreementId: a.related_agreement_id,
          relationType: a.relation_type,
          lastAiReview: a.last_ai_review
            ? {
                overallScore: a.last_ai_review.overallScore,
                riskLevel: a.last_ai_review.riskLevel,
                playbookViolationCount: a.last_ai_review.playbookViolationCount,
              }
            : null,
          signatureStatuses: (a.docusign_envelopes || []).map((e: Row) => e.status).filter(Boolean),
        }));
      }

      if (name === 'get_agreement_details') {
        const { data, error } = await callerClient
          .from('agreements')
          .select('id, title, agreement_type, agreement_subtype, status, effective_date, end_date, custom_fields, content_html, attachments, last_ai_review')
          .eq('id', String(input.agreementId ?? ''))
          .eq('account_id', accountId)
          .single();
        if (error || !data) return { error: 'No agreement with that id on this account.' };
        const review = data.last_ai_review;

        const documents: { name: string; text: string }[] = [];
        const bodyText = stripHtml(data.content_html || '');
        if (bodyText) documents.push({ name: 'Agreement body', text: bodyText });
        let pdfsRead = 0;
        for (const att of data.attachments || []) {
          const isPdf = isPdfAttachment(att);
          const text = await attachmentText(att, !isPdf || pdfsRead < MAX_PDFS_PER_AGREEMENT);
          if (isPdf && text) pdfsRead++;
          if (text) documents.push({ name: String(att.name || 'Attachment'), text });
        }
        // Share the character budget across documents so one long file
        // can't crowd the others out.
        const perDoc = Math.floor(MAX_DOC_CHARS / Math.max(1, documents.length));
        const readable = documents.map((d) => ({
          name: d.name,
          text: d.text.slice(0, perDoc),
          truncated: d.text.length > perDoc,
        }));
        const unreadable = (data.attachments || []).length - (documents.length - (bodyText ? 1 : 0));
        return {
          id: data.id,
          title: data.title,
          type: data.agreement_type,
          subtype: data.agreement_subtype,
          status: data.status,
          effectiveDate: data.effective_date,
          endDate: data.end_date,
          customFields: data.custom_fields || {},
          lastAiReview: review
            ? {
                summary: review.summary,
                riskLevel: review.riskLevel,
                overallScore: review.overallScore,
                risks: (review.risks || []).map((r: Row) => ({ issue: r.issue, severity: r.severity })),
                playbookViolations: (review.playbookViolations || []).map((v: Row) => ({
                  rule: v.rule,
                  severity: v.severity,
                })),
              }
            : null,
          documents: readable,
          unreadableAttachments: Math.max(0, unreadable),
        };
      }

      if (name === 'list_account_playbooks') {
        const { data, error } = await callerClient
          .from('account_playbooks')
          .select('playbooks(title, body)')
          .eq('account_id', accountId);
        if (error) throw error;
        return (data || []).map((r: Row) => ({ title: r.playbooks?.title, body: r.playbooks?.body }));
      }

      return { error: `Unknown tool: ${name}` };
    };

    // -- loop ----------------------------------------------------------------

    const today = new Date().toISOString().slice(0, 10);
    // deno-lint-ignore no-explicit-any
    const messages: any[] = [
      {
        role: 'user',
        content: `Today's date: ${today}\n\nPrepare the account brief for this account (JSON):\n${JSON.stringify({
          id: account.id,
          name: account.name,
          country: account.country,
          city: account.city,
          status: account.status,
          customFields: account.custom_fields || {},
        })}`,
      },
    ];

    let finalText = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      steps = step + 1;
      const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
      inputTokens += data.usage?.input_tokens ?? 0;
      outputTokens += data.usage?.output_tokens ?? 0;

      if (data.stop_reason === 'max_tokens') {
        throw new Error('The brief was too long and got cut off - try again.');
      }

      const content = data.content || [];
      const toolUses = content.filter((c: Row) => c.type === 'tool_use');

      if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
        finalText = (content.find((c: Row) => c.type === 'text') || {}).text || '';
        break;
      }

      messages.push({ role: 'assistant', content });
      const results = [];
      for (const tu of toolUses) {
        let result;
        try {
          result = await runTool(tu.name, tu.input || {});
        } catch (err) {
          console.error(`Agent tool ${tu.name} failed:`, err);
          result = { error: 'This lookup failed.' };
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: results });
    }

    if (!finalText) {
      throw new Error('The agent did not finish in time - try again.');
    }

    const brief = parseBrief(finalText);

    if (runId) {
      await admin
        .from('agent_runs')
        .update({
          status: 'done',
          steps,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    await admin.from('audit_log').insert({
      tenant_id: tenantId,
      actor_email: user.email ?? '',
      action: 'agent_run',
      object_type: 'account',
      object_id: accountId,
      object_label: account.name ?? '',
      details: { agent: 'account_brief', runId, steps },
    });

    return jsonResponse({ ...brief, runId, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Account brief agent error:', err);
    const message = err instanceof Error ? err.message : 'Account brief failed.';
    if (runId) {
      await admin
        .from('agent_runs')
        .update({
          status: 'failed',
          steps,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          error: message.slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    return jsonResponse({ error: 'Account brief failed.' }, 500);
  }
});

function parseBrief(rawText: string) {
  const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
  const cleaned = (answerMatch ? answerMatch[1] : rawText).replace(/```json|```/g, '').trim();

  let brief: Row | undefined;
  try {
    brief = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        brief = JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  if (!brief || typeof brief !== 'object') {
    console.error('Account brief: could not parse Claude response. Raw text was:\n', rawText);
    throw new Error('Could not parse the AI response as JSON.');
  }

  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    headline: brief.headline || '',
    summary: brief.summary || '',
    keyTerms: list(brief.keyTerms),
    risks: list(brief.risks),
    upcoming: list(brief.upcoming),
    talkingPoints: list(brief.talkingPoints),
    openItems: list(brief.openItems),
  };
}
