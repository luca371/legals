import { createClient } from 'npm:@supabase/supabase-js@2';
import mammoth from 'npm:mammoth@1.8.0';
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

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// deno-lint-ignore no-explicit-any
async function attachmentToText(attachment: any) {
  if (!attachment) return '';
  if (attachment.sourceHtml) return stripHtml(attachment.sourceHtml);
  if (attachment.dataBase64) {
    try {
      const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
      const result = await mammoth.extractRawText({ arrayBuffer });
      return (result.value || '').trim();
    } catch (err) {
      console.warn('Could not extract attachment text:', err);
      return '';
    }
  }
  return '';
}

// deno-lint-ignore no-explicit-any
function customFieldsToText(customFields: any) {
  if (!customFields || typeof customFields !== 'object') return '';
  return Object.entries(customFields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

async function buildAgreementText(supabase: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await supabase
    .from('agreements')
    .select('tenant_id, title, agreement_type, agreement_subtype, content_html, custom_fields, attachments')
    .eq('id', id)
    .single();
  if (error || !data) return null;

  const attachmentTexts = await Promise.all((data.attachments || []).map(attachmentToText));

  const combined = [
    data.title,
    data.agreement_type,
    data.agreement_subtype,
    customFieldsToText(data.custom_fields),
    stripHtml(data.content_html || ''),
    ...attachmentTexts,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000);

  return { tenantId: data.tenant_id, text: combined };
}

async function buildAccountText(supabase: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await supabase
    .from('accounts')
    .select('tenant_id, name, country, city, address, tax_registration_number, abbreviation, registered_office, status, custom_fields')
    .eq('id', id)
    .single();
  if (error || !data) return null;

  const combined = [
    data.name,
    data.country,
    data.city,
    data.address,
    data.abbreviation,
    data.registered_office,
    data.status,
    customFieldsToText(data.custom_fields),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return { tenantId: data.tenant_id, text: combined };
}

async function buildTemplateText(supabase: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await supabase
    .from('templates')
    .select('tenant_id, title, agreement_type, agreement_subtype, language, content_html')
    .eq('id', id)
    .single();
  if (error || !data) return null;

  const combined = [data.title, data.agreement_type, data.agreement_subtype, data.language, stripHtml(data.content_html || '')]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000);

  return { tenantId: data.tenant_id, text: combined };
}

async function buildClauseText(supabase: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await supabase
    .from('clause_library')
    .select('tenant_id, title, category, body, language')
    .eq('id', id)
    .single();
  if (error || !data) return null;

  const combined = [data.title, data.category, data.language, data.body].filter(Boolean).join('\n').slice(0, 4000);

  return { tenantId: data.tenant_id, text: combined };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { objectType, objectId } = await req.json();
    if (!objectType || !objectId) {
      return jsonResponse({ error: 'objectType and objectId are required.' }, 400);
    }
    if (!['agreement', 'account', 'template', 'clause'].includes(objectType)) {
      return jsonResponse({ error: 'objectType must be agreement, account, template, or clause.' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const builders: Record<string, typeof buildAgreementText> = {
      agreement: buildAgreementText,
      account: buildAccountText,
      template: buildTemplateText,
      clause: buildClauseText,
    };
    const built = await builders[objectType](supabase, objectId);

    if (!built) {
      return jsonResponse({ error: `${objectType} not found or not accessible.` }, 404);
    }
    if (!built.text.trim()) {
      return jsonResponse({ error: 'Nothing to index — this record has no content yet.' }, 400);
    }

    const [embedding] = await embedTexts(Deno.env.get('VOYAGE_API_KEY') ?? '', [built.text], 'document');

    const { error: upsertError } = await supabase.from('object_embeddings').upsert({
      object_type: objectType,
      object_id: objectId,
      tenant_id: built.tenantId,
      embedding,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      return jsonResponse({ error: upsertError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Index object error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Index object failed.' }, 500);
  }
});
