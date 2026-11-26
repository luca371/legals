import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';
import { monthStartIso, parseAnswerJson, readAgreementDocuments, type Row } from '../_shared/agent-docs.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';
import { accountPlaybooks, actionAllowed, actionNotAllowedResponse, playbookForAgent } from '../_shared/playbooks.ts';

// Renewal agent. Read-only: it reads ONE agreement and its account, works out
// the term, notice and renewal mechanics, and recommends what to do before it
// ends. It never changes, sends or signs anything.

const MAX_STEPS = 8;
const MAX_TOKENS_PER_CALL = 4096;
const MAX_RUNS_PER_TENANT_PER_MONTH = 300;
const MAX_DOC_CHARS = 12000;

const SYSTEM_PROMPT = `You are the renewal agent embedded in "EsoVia", a contract lifecycle management platform. A contract manager asks you to prepare a renewal briefing for ONE agreement: what happens when it ends, what deadlines matter, and what to do about it.

You have read-only tools. ALWAYS use them - never guess or invent anything. Typical flow:
1. Call get_agreement for the agreement you were asked about to read its metadata and the actual document text. The text is what matters: term, renewal and termination mechanics, notice periods, pricing and indexation, liability, exclusivity, confidentiality survival must come from it.
2. Call list_account_agreements to see what else exists with this account (a renewal or amendment may already exist; other agreements may affect your advice).
3. Call list_account_playbooks to know which compliance rules apply, and check the agreement against them.
4. Write the briefing.

You are NOT providing legal advice. Keep everything at the level of "an experienced contract manager would flag this". Base every point only on data the tools returned. Dates are YYYY-MM-DD; today's date is given in the user message.

HOW TO REASON ABOUT THE TERM:
- "endDate" in the metadata is the end of the current term. Compute "daysUntilEnd" from today.
- Read the text for: automatic renewal / evergreen clauses, the notice period required to terminate or not renew, and any renewal price change. The playbooks may list obligations to track and review criteria: apply them. If notice is required, "noticeDeadline" = endDate minus the notice period; say plainly if that date has already passed.
- If the text does not say whether it renews or how much notice is needed, set those fields to null - never assume.
- If another agreement on the account is already linked as a renewal or amendment of this one, say so in the headline.

RECOMMENDATION: pick exactly one action - "renew" (as is), "renew_with_changes", "renegotiate", "let_lapse", or "unclear" (not enough information) - and justify it in 2-3 sentences grounded in what you read.

QUALITY RULES:
- Only report real issues in the contract or its status as risks: a notice deadline that is close or missed, an auto-renewal that will trigger, a one-sided or missing term you actually read, a playbook violation, an unsigned agreement.
- NEVER report missing data as a risk. If a document's text genuinely could not be read, say so once in "summary".
- Say each fact in exactly ONE section. "nextSteps" are actions for people with a date when there is one; do not restate risks.
- Be concise: fewer, stronger points beat a full list. Arrays may be empty.

LANGUAGE RULE: write the whole briefing in English.

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{
  "headline": "<one sentence: the single most important thing to know about this renewal right now>",
  "summary": "<2-4 sentences: what the agreement is, where it stands, what is at stake>",
  "recommendation": {"action": "renew"|"renew_with_changes"|"renegotiate"|"let_lapse"|"unclear", "reasoning": "<2-3 sentences>"},
  "term": {
    "startDate": "<YYYY-MM-DD or null>",
    "endDate": "<YYYY-MM-DD or null>",
    "daysUntilEnd": <integer, negative if already ended, or null>,
    "autoRenewal": true|false|null,
    "noticePeriod": "<e.g. '30 days written notice', or null>",
    "noticePeriodDays": <the notice period as a whole number of days (a month = 30, a year = 365), or null>,
    "noticeDeadline": "<YYYY-MM-DD or null>",
    "source": "<where in the document this comes from, e.g. 'clause 8', or null>"
  },
  "keyTerms": [{"point": "<specific term worth remembering - value, indexation, liability cap, exclusivity, survival...>"}],
  "changesToSeek": [{"change": "<what to ask for at renewal>", "why": "<1 sentence>"}],
  "risks": [{"issue": "<short label>", "severity": "low"|"medium"|"high", "detail": "<1-2 sentences, specific>"}],
  "nextSteps": [{"step": "<concrete action>", "by": "<YYYY-MM-DD or null>"}]
}

Keep "keyTerms" to at most 6 items, "changesToSeek" to 5, "risks" to 5 and "nextSteps" to 6, most important first.`;

const TOOLS = [
  {
    name: 'get_agreement',
    description:
      "Gets the agreement you are briefing: metadata (type, status, effective and end date, custom fields), the last AI review summary and risks, any linked agreement, and the text of its document(s) - the generated contract and uploaded Word or PDF files (truncated if long). Reading a PDF takes a few seconds.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_account_agreements',
    description:
      "Lists the other agreements with the same account, compact: id, title, type, status, effective and end date, and any link to another agreement (amendment or renewal). No document text.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_account_playbooks',
    description: 'Lists the playbooks (compliance rules) assigned to this agreement\'s account.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, callerClient, user, tenantId } = auth;

  let runId: string | null = null;
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const { agreementId } = await req.json();
    if (!agreementId || typeof agreementId !== 'string') {
      return jsonResponse({ error: 'agreementId is required.' }, 400);
    }

    // Reads go through callerClient, so RLS decides what the agent can see -
    // exactly what the signed-in user could open themselves.
    const { data: agreement, error: agreementError } = await callerClient
      .from('agreements')
      .select(
        'id, title, account_id, account_name, agreement_type, agreement_subtype, status, effective_date, end_date, notice_period_days, auto_renewal, custom_fields, content_html, attachments, last_ai_review, related_agreement_id, relation_type'
      )
      .eq('id', agreementId)
      .single();
    if (agreementError || !agreement) {
      return jsonResponse({ error: "This agreement doesn't exist or you can't access it." }, 404);
    }

    const playbooks = await accountPlaybooks(callerClient, agreement.account_id);
    if (!actionAllowed(playbooks, 'renewal_brief')) return actionNotAllowedResponse('renewal_brief');
    const limited = await enforceAiLimit(auth, 'agent-renewal-brief');
    if (limited) return limited;

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
        agent: 'renewal_brief',
        subject_type: 'agreement',
        subject_id: agreementId,
      })
      .select('id')
      .single();
    runId = run?.id ?? null;

    // -- tools ---------------------------------------------------------------

    const runTool = async (name: string) => {
      if (name === 'get_agreement') {
        const review = agreement.last_ai_review;
        const { documents, unreadable } = await readAgreementDocuments(agreement, MAX_DOC_CHARS);
        return {
          id: agreement.id,
          title: agreement.title,
          account: agreement.account_name,
          type: agreement.agreement_type,
          subtype: agreement.agreement_subtype,
          status: agreement.status,
          effectiveDate: agreement.effective_date,
          endDate: agreement.end_date,
          recordedNoticePeriodDays: agreement.notice_period_days,
          recordedAutoRenewal: agreement.auto_renewal,
          customFields: agreement.custom_fields || {},
          relatedAgreementId: agreement.related_agreement_id,
          relationType: agreement.relation_type,
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
          documents,
          unreadableAttachments: unreadable,
        };
      }

      if (name === 'list_account_agreements') {
        if (!agreement.account_id) return [];
        const { data, error } = await callerClient
          .from('agreements')
          .select('id, title, agreement_type, status, effective_date, end_date, related_agreement_id, relation_type')
          .eq('account_id', agreement.account_id)
          .neq('id', agreementId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return (data || []).map((a: Row) => ({
          id: a.id,
          title: a.title,
          type: a.agreement_type,
          status: a.status,
          effectiveDate: a.effective_date,
          endDate: a.end_date,
          relatedAgreementId: a.related_agreement_id,
          relationType: a.relation_type,
        }));
      }

      if (name === 'list_account_playbooks') {
        return playbooks.map(playbookForAgent);
      }

      return { error: `Unknown tool: ${name}` };
    };

    // -- loop ----------------------------------------------------------------

    const today = new Date().toISOString().slice(0, 10);
    // deno-lint-ignore no-explicit-any
    const messages: any[] = [
      {
        role: 'user',
        content: `Today's date: ${today}\n\nPrepare the renewal briefing for this agreement (JSON):\n${JSON.stringify({
          id: agreement.id,
          title: agreement.title,
          account: agreement.account_name,
          status: agreement.status,
          endDate: agreement.end_date,
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
        throw new Error('The briefing was too long and got cut off - try again.');
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
          result = await runTool(tu.name);
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

    const brief = normalizeBrief(parseAnswerJson(finalText, 'Renewal brief'));

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
      object_type: 'agreement',
      object_id: agreementId,
      object_label: agreement.title ?? '',
      details: { agent: 'renewal_brief', runId, steps },
    });

    return jsonResponse({ ...brief, runId, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Renewal brief agent error:', err);
    const message = err instanceof Error ? err.message : 'Renewal brief failed.';
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
    return jsonResponse({ error: 'Renewal brief failed.' }, 500);
  }
});

const ACTIONS = ['renew', 'renew_with_changes', 'renegotiate', 'let_lapse', 'unclear'];

function normalizeBrief(brief: Row) {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const term = brief.term && typeof brief.term === 'object' ? brief.term : {};
  const rec = brief.recommendation && typeof brief.recommendation === 'object' ? brief.recommendation : {};
  return {
    headline: brief.headline || '',
    summary: brief.summary || '',
    recommendation: {
      action: ACTIONS.includes(rec.action) ? rec.action : 'unclear',
      reasoning: rec.reasoning || '',
    },
    term: {
      startDate: term.startDate ?? null,
      endDate: term.endDate ?? null,
      daysUntilEnd: typeof term.daysUntilEnd === 'number' ? term.daysUntilEnd : null,
      autoRenewal: typeof term.autoRenewal === 'boolean' ? term.autoRenewal : null,
      noticePeriod: term.noticePeriod ?? null,
      noticePeriodDays:
        Number.isInteger(term.noticePeriodDays) && term.noticePeriodDays >= 0 && term.noticePeriodDays <= 3650
          ? term.noticePeriodDays
          : null,
      noticeDeadline: term.noticeDeadline ?? null,
      source: term.source ?? null,
    },
    keyTerms: list(brief.keyTerms),
    changesToSeek: list(brief.changesToSeek),
    risks: list(brief.risks),
    nextSteps: list(brief.nextSteps),
  };
}
