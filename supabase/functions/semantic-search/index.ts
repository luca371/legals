import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { embedTexts } from '../_shared/voyage.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { query, objectType, matchCount } = await req.json();
    if (!query || !String(query).trim()) {
      return jsonResponse({ error: 'query is required.' }, 400);
    }
    if (objectType && !['agreement', 'account', 'template', 'clause'].includes(objectType)) {
      return jsonResponse({ error: 'objectType must be agreement, account, template, or clause.' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const [queryEmbedding] = await embedTexts(Deno.env.get('VOYAGE_API_KEY') ?? '', [query], 'query');

    const { data: matches, error: rpcError } = await supabase.rpc('match_objects', {
      query_embedding: queryEmbedding,
      filter_type: objectType || null,
      match_count: matchCount || 8,
    });

    if (rpcError) {
      return jsonResponse({ error: rpcError.message }, 400);
    }
    if (!matches || matches.length === 0) {
      return jsonResponse({ results: [] });
    }

    // deno-lint-ignore no-explicit-any
    const byType: Record<string, any[]> = { agreement: [], account: [], template: [], clause: [] };
    // deno-lint-ignore no-explicit-any
    matches.forEach((m: any) => byType[m.object_type]?.push(m));

    const [agreements, accounts, templates, clauses] = await Promise.all([
      byType.agreement.length
        ? supabase.from('agreements').select('id, title, account_name, agreement_type, agreement_subtype, status').in(
            'id',
            byType.agreement.map((m) => m.object_id)
          )
        : { data: [] },
      byType.account.length
        ? supabase.from('accounts').select('id, name, country, city, status').in(
            'id',
            byType.account.map((m) => m.object_id)
          )
        : { data: [] },
      byType.template.length
        ? supabase.from('templates').select('id, title, agreement_type, agreement_subtype').in(
            'id',
            byType.template.map((m) => m.object_id)
          )
        : { data: [] },
      byType.clause.length
        ? supabase.from('clause_library').select('id, title, category, body, language').in(
            'id',
            byType.clause.map((m) => m.object_id)
          )
        : { data: [] },
    ]);

    const agreementsById = new Map((agreements.data || []).map((a) => [a.id, a]));
    const accountsById = new Map((accounts.data || []).map((a) => [a.id, a]));
    const templatesById = new Map((templates.data || []).map((t) => [t.id, t]));
    const clausesById = new Map((clauses.data || []).map((c) => [c.id, c]));

    // deno-lint-ignore no-explicit-any
    const results = matches
      .map((m: any) => {
        const similarity = Math.round(m.similarity * 100) / 100;
        if (m.object_type === 'agreement') {
          const a = agreementsById.get(m.object_id);
          if (!a) return null;
          return {
            objectType: 'agreement',
            id: a.id,
            title: a.title,
            accountName: a.account_name,
            agreementType: a.agreement_type,
            agreementSubtype: a.agreement_subtype,
            status: a.status,
            relevance: similarity,
          };
        }
        if (m.object_type === 'account') {
          const a = accountsById.get(m.object_id);
          if (!a) return null;
          return {
            objectType: 'account',
            id: a.id,
            name: a.name,
            country: a.country,
            city: a.city,
            status: a.status,
            relevance: similarity,
          };
        }
        if (m.object_type === 'template') {
          const t = templatesById.get(m.object_id);
          if (!t) return null;
          return {
            objectType: 'template',
            id: t.id,
            title: t.title,
            agreementType: t.agreement_type,
            agreementSubtype: t.agreement_subtype,
            relevance: similarity,
          };
        }
        const c = clausesById.get(m.object_id);
        if (!c) return null;
        return {
          objectType: 'clause',
          id: c.id,
          title: c.title,
          category: c.category,
          body: c.body,
          language: c.language,
          relevance: similarity,
        };
      })
      .filter(Boolean);

    return jsonResponse({ results });
  } catch (err) {
    console.error('Semantic search error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Semantic search failed.' }, 500);
  }
});
