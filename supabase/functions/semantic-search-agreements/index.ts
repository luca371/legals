import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { embedTexts } from '../_shared/voyage.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { query, matchCount } = await req.json();
    if (!query || !String(query).trim()) {
      return jsonResponse({ error: 'query is required.' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const [queryEmbedding] = await embedTexts(Deno.env.get('VOYAGE_API_KEY') ?? '', [query], 'query');

    const { data: matches, error: rpcError } = await supabase.rpc('match_agreements', {
      query_embedding: queryEmbedding,
      match_count: matchCount || 8,
    });

    if (rpcError) {
      return jsonResponse({ error: rpcError.message }, 400);
    }
    if (!matches || matches.length === 0) {
      return jsonResponse({ results: [] });
    }

    const ids = matches.map((m: { agreement_id: string }) => m.agreement_id);
    const { data: agreements, error: fetchError } = await supabase
      .from('agreements')
      .select('id, title, account_name, agreement_type, agreement_subtype, status')
      .in('id', ids);

    if (fetchError) {
      return jsonResponse({ error: fetchError.message }, 400);
    }

    const byId = new Map((agreements || []).map((a) => [a.id, a]));
    const results = matches
      .map((m: { agreement_id: string; similarity: number }) => {
        const a = byId.get(m.agreement_id);
        if (!a) return null;
        return {
          id: a.id,
          title: a.title,
          accountName: a.account_name,
          agreementType: a.agreement_type,
          agreementSubtype: a.agreement_subtype,
          status: a.status,
          relevance: Math.round(m.similarity * 100) / 100,
        };
      })
      .filter(Boolean);

    return jsonResponse({ results });
  } catch (err) {
    console.error('Semantic search error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Semantic search failed.' }, 500);
  }
});
