import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { monthStartIso } from '../_shared/agent-docs.ts';
import { screenAccountData } from '../_shared/screening.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';
import { accountPlaybooks, actionAllowed, actionNotAllowedResponse } from '../_shared/playbooks.ts';

// Account screening agent. Reads what the platform knows about ONE account -
// its record, agreements, obligations and tasks - checks it against the
// screening criteria of the account's playbooks (or sensible defaults), and
// flags what needs attention. Internal sources only. It changes nothing except
// storing its own result on the account, so the next visit shows it.

const MAX_RUNS_PER_TENANT_PER_MONTH = 300;

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
    const { accountId } = await req.json();
    if (!accountId || typeof accountId !== 'string') {
      return jsonResponse({ error: 'accountId is required.' }, 400);
    }

    // Reads go through callerClient, so RLS decides what the agent can see.
    const { data: account, error: accountError } = await callerClient
      .from('accounts')
      .select('id, name, country, city, address, tax_registration_number, abbreviation, registered_office, status, custom_fields, created_at')
      .eq('id', accountId)
      .single();
    if (accountError || !account) {
      return jsonResponse({ error: "This account doesn't exist or you can't access it." }, 404);
    }

    const playbooks = await accountPlaybooks(callerClient, accountId);
    if (!actionAllowed(playbooks, 'screening')) return actionNotAllowedResponse('screening');

    const { count: runsThisMonth } = await admin
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStartIso());
    if ((runsThisMonth ?? 0) >= MAX_RUNS_PER_TENANT_PER_MONTH) {
      return jsonResponse({ error: 'Your organization reached its monthly limit of agent runs.' }, 429);
    }

    const limited = await enforceAiLimit(auth, 'agent-account-screening');
    if (limited) return limited;

    const { data: run } = await admin
      .from('agent_runs')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        actor_email: user.email ?? '',
        agent: 'account_screening',
        subject_type: 'account',
        subject_id: accountId,
      })
      .select('id')
      .single();
    runId = run?.id ?? null;

    const screened = await screenAccountData(callerClient, tenantId, account, playbooks);
    inputTokens = screened.inputTokens;
    outputTokens = screened.outputTokens;
    const result = { ...screened.result, runId };

    await admin.from('accounts').update({ last_screening: result }).eq('id', accountId).eq('tenant_id', tenantId);

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
      object_type: 'account',
      object_id: accountId,
      object_label: account.name ?? '',
      details: { agent: 'account_screening', runId, overall: result.overall, flags: result.flags.length },
    });

    return jsonResponse(result);
  } catch (err) {
    console.error('Account screening agent error:', err);
    if (runId) {
      await admin
        .from('agent_runs')
        .update({
          status: 'failed',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          error: (err instanceof Error ? err.message : 'failed').slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    return jsonResponse({ error: 'Account screening failed.' }, 500);
  }
});
