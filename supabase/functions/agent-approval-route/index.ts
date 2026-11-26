import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { ANTHROPIC_MODEL, callAnthropic } from '../_shared/anthropic.ts';
import { parseAnswerJson, type Row } from '../_shared/agent-docs.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';
import { accountPlaybooks, actionAllowed, actionNotAllowedResponse } from '../_shared/playbooks.ts';

// Approval routing agent. Reads ONE agreement's details and the approval rules
// of its account's playbooks, and PROPOSES who should approve it and in what
// order, picking only from the organization's active users. It sends nothing:
// the proposal fills the approval form, and a person reviews and sends it.

const SYSTEM_PROMPT = `You are the approval routing agent embedded in "EsoVia", a contract lifecycle management platform. Given ONE agreement, the approval rules of the organization's playbooks, and the organization's users, you propose the approval chain: who must approve it, in which order.

RULES:
- Apply ONLY the approval rules you are given. Never invent a rule. If no rule applies, return an empty "approvers" list and say so in "explanation".
- Pick approvers ONLY from the users list, by their exact email. Match rules to users by role, department or name. If a rule names a role nobody in the list has, add it to "unmatched" instead of guessing a person.
- Read values (contract value, duration, type, country...) from the agreement's fields and custom fields. If a rule depends on a value the agreement does not have, list it in "unmatched" with the reason.
- Order: follow any order the rules give; otherwise the most junior approver first and the most senior last. No duplicates.
- Do not include the person asking (given as "requester") unless a rule clearly requires them.

Write in English. Think it through, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

{
  "approvers": [{"email": "<email from the users list>", "name": "<their name>", "reason": "<the rule that requires them, short>"}],
  "unmatched": [{"rule": "<rule, short>", "reason": "<why no approver was picked>"}],
  "explanation": "<1-2 sentences>"
}`;

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, callerClient, user, tenantId } = auth;

  let runId: string | null = null;
  try {
    const { agreementId } = await req.json();
    if (!agreementId || typeof agreementId !== 'string') {
      return jsonResponse({ error: 'agreementId is required.' }, 400);
    }

    const { data: agreement, error: agreementError } = await callerClient
      .from('agreements')
      .select('id, title, account_id, account_name, account2_name, agreement_type, agreement_subtype, language, status, effective_date, end_date, custom_fields, last_ai_review')
      .eq('id', agreementId)
      .single();
    if (agreementError || !agreement) {
      return jsonResponse({ error: "This agreement doesn't exist or you can't access it." }, 404);
    }

    const playbooks = await accountPlaybooks(callerClient, agreement.account_id);
    if (!actionAllowed(playbooks, 'review')) return actionNotAllowedResponse('review');

    const rules = playbooks.filter((p) => p.approval_rules?.trim()).map((p) => ({ playbook: p.title, rules: p.approval_rules.trim() }));
    if (!rules.length) {
      return jsonResponse({
        approvers: [],
        unmatched: [],
        explanation: "No playbook of this agreement's account has approval rules. Add them in Settings > Playbooks.",
        noRules: true,
      });
    }

    const limited = await enforceAiLimit(auth, 'agent-approval-route');
    if (limited) return limited;

    const { data: run } = await admin
      .from('agent_runs')
      .insert({ tenant_id: tenantId, user_id: user.id, actor_email: user.email ?? '', agent: 'approval_route', subject_type: 'agreement', subject_id: agreementId })
      .select('id')
      .single();
    runId = run?.id ?? null;

    const { data: users } = await admin
      .from('users')
      .select('first_name, last_name, email, role, department, profile')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .limit(300);
    const people = (users || [])
      .filter((u: Row) => u.email)
      .map((u: Row) => ({
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
        email: String(u.email).toLowerCase(),
        role: u.role || '',
        department: u.department || '',
      }));

    const response = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
      model: ANTHROPIC_MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Requester: ${user.email ?? ''}

AGREEMENT (JSON):
${JSON.stringify({
  title: agreement.title,
  type: agreement.agreement_type,
  subtype: agreement.agreement_subtype,
  language: agreement.language,
  parties: [agreement.account_name, agreement.account2_name].filter(Boolean),
  effectiveDate: agreement.effective_date,
  endDate: agreement.end_date,
  customFields: agreement.custom_fields || {},
  lastAiReviewRisk: agreement.last_ai_review?.riskLevel ?? null,
})}

APPROVAL RULES:
${JSON.stringify(rules)}

USERS:
${JSON.stringify(people)}`,
        },
      ],
    });

    const text = (response.content || []).find((c: Row) => c.type === 'text')?.text || '';
    const raw = parseAnswerJson(text, 'Approval route');
    const byEmail = new Map(people.map((p) => [p.email, p]));
    const seen = new Set<string>();
    // Only real users of this organization, each once.
    const approvers = (Array.isArray(raw.approvers) ? raw.approvers : [])
      .map((a: Row) => ({ ...a, email: String(a?.email || '').toLowerCase() }))
      .filter((a: Row) => byEmail.has(a.email) && !seen.has(a.email) && seen.add(a.email))
      .slice(0, 10)
      .map((a: Row) => ({ email: a.email, name: byEmail.get(a.email)!.name, reason: String(a.reason || '') }));

    if (runId) {
      await admin.from('agent_runs').update({
        status: 'done',
        steps: 1,
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }

    return jsonResponse({
      approvers,
      unmatched: (Array.isArray(raw.unmatched) ? raw.unmatched : []).slice(0, 8).map((u: Row) => ({
        rule: String(u?.rule || ''),
        reason: String(u?.reason || ''),
      })),
      explanation: String(raw.explanation || ''),
      runId,
    });
  } catch (err) {
    console.error('Approval route agent error:', err);
    if (runId) {
      await admin.from('agent_runs').update({
        status: 'failed',
        error: (err instanceof Error ? err.message : 'failed').slice(0, 500),
        finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    return jsonResponse({ error: 'Could not propose approvers.' }, 500);
  }
});
