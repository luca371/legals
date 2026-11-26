import { ANTHROPIC_MODEL, callAnthropic } from './anthropic.ts';
import { parseAnswerJson, type Row } from './agent-docs.ts';
import { playbookForAgent } from './playbooks.ts';

// Account screening, shared by the on-demand agent (agent-account-screening,
// reading as the signed-in user) and the weekly portfolio monitor (reading
// with the service role). Every query is scoped to the tenant explicitly, so
// it is safe with either client.

export const DEFAULT_CRITERIA = `- The account record is complete enough to contract with: legal name, country, address, tax / registration number.
- No active agreement has passed its end date, and no notice deadline has passed or falls within the next 30 days without a decision.
- No agreement that should be signed is stuck unsigned (status in review / in approval / sent for signature for a long time).
- No open obligation or task is overdue.
- The last AI review of each active agreement is not high risk and has no outstanding playbook violations.
- There are no duplicate or conflicting agreements of the same type running at the same time.`;

const SYSTEM_PROMPT = `You are the account screening agent embedded in "EsoVia", a contract lifecycle management platform. You assess ONE account (a customer or supplier) against defined screening criteria, using ONLY the data you are given about it, and flag what needs attention.

You are NOT providing legal advice and you do NOT have outside information (no internet, no registries, no news). Never claim anything about the account that is not in the data. Dates are YYYY-MM-DD; today's date is in the message.

FOR EACH CRITERION:
- If the data shows a problem, add a flag: which criterion, how serious, what you found, the evidence (agreement title, date, field), and one concrete action.
- If the data shows the criterion is met, list it under "passed".
- If the data cannot tell either way, list it under "notAssessed" with one short reason. Missing data is NOT a flag on its own, except where a criterion is about completeness of the record.

Severity: "high" = a deadline missed or within 14 days, an expired active agreement, a high-risk term; "medium" = needs action within the month; "low" = housekeeping.
"overall": "critical" if any high flag, "attention" if any flag, otherwise "clear".

Write in English. Be concise: at most 8 flags, most serious first. Think it through, then give your final answer as a JSON object wrapped exactly like this, on its own at the end: <answer>{...}</answer>

{
  "overall": "clear"|"attention"|"critical",
  "summary": "<2-3 sentences>",
  "flags": [{"criterion": "<criterion, short>", "severity": "low"|"medium"|"high", "finding": "<what is wrong>", "evidence": "<where it shows>", "action": "<what to do>"}],
  "passed": ["<criterion, short>"],
  "notAssessed": [{"criterion": "<criterion, short>", "reason": "<why>"}]
}`;

export const OVERALL = ['clear', 'attention', 'critical'];
export const SEVERITIES = ['low', 'medium', 'high'];


const MAX_TOKENS = 6000;

// deno-lint-ignore no-explicit-any
export async function screenAccountData(db: any, tenantId: string, account: Row, playbooks: Row[]) {
  const accountId = account.id;
  const { data: agreements } = await db
    .from('agreements')
    .select(
      'id, title, agreement_type, agreement_subtype, status, effective_date, end_date, notice_period_days, notice_deadline, auto_renewal, last_ai_review, docusign_envelopes, updated_at'
    )
    .eq('tenant_id', tenantId)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(100);
  const agreementIds = (agreements || []).map((a: Row) => a.id);
  const titleOf = new Map((agreements || []).map((a: Row) => [a.id, a.title]));

  const [obligations, tasks] = await Promise.all([
    agreementIds.length
      ? db.from('obligations').select('agreement_id, description, due_date, status').eq('tenant_id', tenantId).in('agreement_id', agreementIds).eq('status', 'open').limit(100)
      : Promise.resolve({ data: [] }),
    db.from('tasks').select('agreement_id, account_id, title, task_type, due_date, status').eq('tenant_id', tenantId).eq('status', 'open')
      .or(`account_id.eq.${accountId}${agreementIds.length ? `,agreement_id.in.(${agreementIds.join(',')})` : ''}`)
      .limit(100),
  ]);

  const criteria = playbooks
    .map(playbookForAgent)
    .filter((p) => p?.screeningCriteria)
    .map((p) => `From playbook "${p!.title}":\n${p!.screeningCriteria}`);

  const today = new Date().toISOString().slice(0, 10);
  const data = {
    account: {
      name: account.name,
      country: account.country,
      city: account.city,
      address: account.address,
      taxRegistrationNumber: account.tax_registration_number,
      abbreviation: account.abbreviation,
      registeredOffice: account.registered_office,
      status: account.status,
      customFields: account.custom_fields || {},
      createdAt: account.created_at,
    },
    agreements: (agreements || []).map((a: Row) => ({
      title: a.title,
      type: a.agreement_type,
      subtype: a.agreement_subtype,
      status: a.status,
      effectiveDate: a.effective_date,
      endDate: a.end_date,
      noticePeriodDays: a.notice_period_days,
      noticeDeadline: a.notice_deadline,
      autoRenewal: a.auto_renewal,
      lastUpdated: a.updated_at?.slice(0, 10),
      lastAiReview: a.last_ai_review
        ? {
            riskLevel: a.last_ai_review.riskLevel,
            overallScore: a.last_ai_review.overallScore,
            playbookViolationCount: a.last_ai_review.playbookViolationCount,
          }
        : null,
      signatureStatuses: (a.docusign_envelopes || []).map((e: Row) => e.status).filter(Boolean),
    })),
    openObligations: (obligations.data || []).map((o: Row) => ({
      agreement: titleOf.get(o.agreement_id) || null,
      description: o.description,
      dueDate: o.due_date,
    })),
    openTasks: (tasks.data || []).map((t: Row) => ({
      agreement: t.agreement_id ? titleOf.get(t.agreement_id) || null : null,
      title: t.title,
      type: t.task_type,
      dueDate: t.due_date,
    })),
  };

  const response = await callAnthropic(Deno.env.get('ANTHROPIC_API_KEY') ?? '', {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Today's date: ${today}

SCREENING CRITERIA:
${criteria.length ? criteria.join('\n\n') : `(No playbook of this account defines screening criteria - use these defaults.)\n${DEFAULT_CRITERIA}`}

ACCOUNT DATA (JSON):
${JSON.stringify(data)}`,
      },
    ],
  });
  if (response.stop_reason === 'max_tokens') throw new Error('The screening was too long and got cut off.');

  const text = (response.content || []).find((c: Row) => c.type === 'text')?.text || '';
  const raw = parseAnswerJson(text, 'Account screening');
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    result: {
      overall: OVERALL.includes(raw.overall) ? raw.overall : 'attention',
      summary: String(raw.summary || ''),
      flags: list(raw.flags).slice(0, 8).map((f: Row) => ({
        criterion: String(f.criterion || ''),
        severity: SEVERITIES.includes(f.severity) ? f.severity : 'medium',
        finding: String(f.finding || ''),
        evidence: String(f.evidence || ''),
        action: String(f.action || ''),
      })),
      passed: list(raw.passed).map(String).slice(0, 12),
      notAssessed: list(raw.notAssessed).slice(0, 8).map((n: Row) => ({
        criterion: String(n?.criterion || n || ''),
        reason: String(n?.reason || ''),
      })),
      usedDefaultCriteria: criteria.length === 0,
      generatedAt: new Date().toISOString(),
    },
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
