import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { embedTexts } from '../_shared/voyage.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { agreementId } = await req.json();
    if (!agreementId) {
      return jsonResponse({ error: 'agreementId is required.' }, 400);
    }

    // Runs as the calling user (not service_role) — RLS on both `agreements`
    // and `agreement_embeddings` naturally keeps this scoped to their tenant.
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: agreement, error: fetchError } = await supabase
      .from('agreements')
      .select('tenant_id, title, agreement_type, agreement_subtype, content_html')
      .eq('id', agreementId)
      .single();

    if (fetchError || !agreement) {
      return jsonResponse({ error: 'Agreement not found or not accessible.' }, 404);
    }

    const plainText = stripHtml(agreement.content_html || '');
    const combined = [agreement.title, agreement.agreement_type, agreement.agreement_subtype, plainText]
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000);

    if (!combined.trim()) {
      return jsonResponse({ error: 'Nothing to index — this agreement has no title or document content yet.' }, 400);
    }

    const [embedding] = await embedTexts(Deno.env.get('VOYAGE_API_KEY') ?? '', [combined], 'document');

    const { error: upsertError } = await supabase.from('agreement_embeddings').upsert({
      agreement_id: agreementId,
      tenant_id: agreement.tenant_id,
      embedding,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      return jsonResponse({ error: upsertError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Index agreement error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Index agreement failed.' }, 500);
  }
});
