import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { approvalId } = await req.json();
    if (!approvalId) {
      return jsonResponse({ error: 'approvalId is required.' }, 400);
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: request, error: requestError } = await supabaseAdmin
      .from('approval_requests')
      .select('*')
      .eq('id', approvalId)
      .maybeSingle();

    if (requestError || !request) {
      return jsonResponse({ error: 'Approval request not found.' }, 404);
    }
    if (request.status !== 'Approved') {
      return jsonResponse({ error: 'This approval has not been approved.' }, 400);
    }

    // Refuse to finalize if there's still a next approver waiting in the
    // same batch — only the last approver in a sequential chain can
    // advance the agreement.
    if (request.batch_id) {
      const { data: nextRequest } = await supabaseAdmin
        .from('approval_requests')
        .select('id')
        .eq('batch_id', request.batch_id)
        .eq('sequence', (request.sequence || 1) + 1)
        .maybeSingle();

      if (nextRequest) {
        return jsonResponse({ error: 'There is still a next approver in this chain.' }, 400);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('agreements')
      .update({ status: 'Approved', updated_at: new Date().toISOString() })
      .eq('id', request.agreement_id);

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Finalize approval error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Finalize approval failed.' }, 500);
  }
});
