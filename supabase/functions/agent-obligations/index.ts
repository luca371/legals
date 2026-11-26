import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';
import { monthStartIso, parseAnswerJson, readAgreementDocuments, type Row } from '../_shared/agent-docs.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';
import { accountPlaybooks, actionAllowed, actionNotAllowedResponse, playbookForAgent } from '../_shared/playbooks.ts';

// Obligation agent. Read-only: it reads ONE agreement and PROPOSES the
// obligations it contains. It saves nothing - the user reviews the proposals
// and accepts the ones that are right, and only then does the app store them.

const MAX_TOKENS = 8000;
const MAX_RUNS_PER_TENANT_PER_MONTH = 300;
const MAX_DOC_CHARS = 20000;

const SYSTEM_PROMPT = `You are the obligation agent embedded in "EsoVia", a contract lifecycle management platform. You read ONE agreement and list the obligations it creates: things a party must do, must not do, or must deliver - the items a contract manager would put in an obligations register and follow up on.

You are NOT providing legal advice. Base every obligation only on the document text you are given - never invent or assume one. Dates are YYYY-MM-DD; today's date, the agreement's effective date and end date, and the parties are given in the user message.

WHAT TO LIST:
- Obligations with a deliverable, action, deadline or recurrence: payments, reports and notices to send, deliveries, return or destruction of materials, audits, renewal or termination notices, insurance to maintain, confidentiality that survives a period, and similar.
- Skip pure definitions, boilerplate (governing law, entire agreement, severability) and general statements with no action attached.
- One entry per distinct obligation. Do not repeat the same obligation. You are given obligations that are already in the register - do not propose those again.

FOR EACH OBLIGATION:
- "description": one clear sentence in English saying what must be done.
- "responsibleParty": the party who must do it, as named in the document or the parties list (e.g. "Receiving Party", "Supplier"). Empty string if the text does not say.
- "dueDate": a YYYY-MM-DD date ONLY if it is stated or can be computed with certainty from a known date (e.g. "30 days before the end date" when the end date is known; "within 30 days of signature" is NOT computable unless the signing date is known). Otherwise null.
- "recurrence": e.g. "monthly", "quarterly", "annually", or null.
- "trigger": what sets it off when there is no fixed date (e.g. "on written request by the Disclosing Party", "after termination"), or null.
- "clause": the clause or section, e.g. "Clause 8", or null.
- "quote": a SHORT verbatim excerpt (under 250 characters) copied exactly from the document, so a person can check it. Never paraphrase it.
- "confidence": "high" when the text is explicit, "medium" or "low" when you had to interpret.

LANGUAGE RULE: "description" and "trigger" are written in English whatever the document's language; "quote" stays in the document's original language.

If the document text is missing, empty or not a real contract, say so in "summary" and return an empty array. If a document could not be read, mention it once in "summary".

Think it through first, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

The JSON object must have exactly these fields:
{
  "summary": "<1-2 sentences: how many obligations you found and anything the reader should know>",
  "obligations": [{"description": "...", "responsibleParty": "...", "dueDate": "<YYYY-MM-DD or null>", "recurrence": "<or null>", "trigger": "<or null>", "clause": "<or null>", "quote": "<verbatim excerpt>", "confidence": "high"|"medium"|"low"}]
}

Keep "obligations" to at most 20 items, most important first.`;

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, callerClient, user, tenantId } = auth;

  let runId: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const { agreementId } = await req.json();
    if (!agreementId || typeof agreementId !== 'string') {
      return jsonResponse({ error: 'agreementId is required.' }, 400);
    }

    // Reads go through callerClient, so RLS decides what the agent can see.
    const { data: agreement, error: agreementError } = await callerClient
      .from('agreements')
      .select(
        'id, title, account_id, account_name, account2_name, agreement_type, agreement_subtype, status, effective_date, end_date, content_html, attachments'
      )
      .eq('id', agreementId)
      .single();
    if (agreementError || !agreement) {
      return jsonResponse({ error: "This agreement doesn't exist or you can't access it." }, 404);
    }

    const playbooks = await accountPlaybooks(callerClient, agreement.account_id);
    if (!actionAllowed(playbooks, 'obligations')) return actionNotAllowedResponse('obligations');
    const limited = await enforceAiLimit(auth, 'agent-obligations');
    if (limited) return limited;
    const trackedByPlaybook = playbooks.map(playbookForAgent).filter((p) => p?.obligationsToTrack);

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
        agent: 'obligations',
        subject_type: 'agreement',
        subject_id: agreementId,
      })
      .select('id')
      .single();
    runId = run?.id ?? null;

    const { documents, unreadable } = await readAgreementDocuments(agreement, MAX_DOC_CHARS);

    let proposals: Row[] = [];
    let summary = '';

    if (documents.length === 0) {
      summary = 'No readable document text was found on this agreement, so no obligations could be proposed.';
    } else {
      // Already-saved obligations, so the agent does not propose them twice.
      // The table might not exist yet (SQL not run) - that is not a failure here.
      const { data: existing } = await callerClient
        .from('obligations')
        .select('description')
        .eq('agreement_id', agreementId)
        .limit(100);

      const today = new Date().toISOString().slice(0, 10);
      const userMessage = `Today's date: ${today}

Agreement (JSON):
${JSON.stringify({
  title: agreement.title,
  type: agreement.agreement_type,
  subtype: agreement.agreement_subtype,
  status: agreement.status,
  parties: [agreement.account_name, agreement.account2_name].filter(Boolean),
  effectiveDate: agreement.effective_date,
  endDate: agreement.end_date,
  unreadableAttachments: unreadable,
})}
${trackedByPlaybook.length > 0 ? `
Obligations this organization's playbooks say to track for this account (make sure every one that the document actually contains is listed; never invent one the document does not contain):
${JSON.stringify(trackedByPlaybook.map((p) => ({ playbook: p.title, obligationsToTrack: p.obligationsToTrack })))}
` : ''}
Obligations already in the register (do not propose these again):
${JSON.stringify((existing || []).map((o: Row) => o.description))}

Document text:
${documents.map((d) => `--- ${d.name}${d.truncated ? ' (truncated)' : ''} ---\n${d.text}`).join('\n\n')}`;

      const data = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      inputTokens += data.usage?.input_tokens ?? 0;
      outputTokens += data.usage?.output_tokens ?? 0;

      if (data.stop_reason === 'max_tokens') {
        throw new Error('The list was too long and got cut off - try again.');
      }
      const textBlock = (data.content || []).find((c: Row) => c.type === 'text');
      if (!textBlock) throw new Error('No text response from Claude.');

      const parsed = parseAnswerJson(textBlock.text, 'Obligation agent');
      summary = typeof parsed.summary === 'string' ? parsed.summary : '';
      proposals = (Array.isArray(parsed.obligations) ? parsed.obligations : [])
        .filter((o: Row) => o && typeof o.description === 'string' && o.description.trim())
        .slice(0, 20)
        .map((o: Row) => ({
          description: String(o.description).trim(),
          responsibleParty: typeof o.responsibleParty === 'string' ? o.responsibleParty : '',
          dueDate: typeof o.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate) ? o.dueDate : null,
          recurrence: typeof o.recurrence === 'string' && o.recurrence ? o.recurrence : null,
          trigger: typeof o.trigger === 'string' && o.trigger ? o.trigger : null,
          clause: typeof o.clause === 'string' && o.clause ? o.clause : null,
          quote: typeof o.quote === 'string' && o.quote ? o.quote : null,
          confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'medium',
        }));
    }

    if (runId) {
      await admin
        .from('agent_runs')
        .update({
          status: 'done',
          steps: 1,
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
      details: { agent: 'obligations', runId, proposed: proposals.length },
    });

    return jsonResponse({ summary, obligations: proposals, runId, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Obligation agent error:', err);
    const message = err instanceof Error ? err.message : 'Finding obligations failed.';
    if (runId) {
      await admin
        .from('agent_runs')
        .update({
          status: 'failed',
          steps: 1,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          error: message.slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    return jsonResponse({ error: 'Finding obligations failed.' }, 500);
  }
});
