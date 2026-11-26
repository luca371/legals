import { importPKCS8, SignJWT } from 'npm:jose@5';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret } from './crypto.ts';

// Salesforce access, one connection per tenant. Credentials live in the
// `integrations` table (private key encrypted) and are set up from the Admin
// screen. OAuth 2.0 JWT Bearer flow, server-side only.

const API_VERSION = Deno.env.get('SF_API_VERSION') ?? 'v62.0';
const SF_ID_RE = /^[a-zA-Z0-9]{15,18}$/;

type Access = { token: string; instanceUrl: string; expiresAt: number };
const accessCache = new Map<string, Access>();

export function clearSalesforceCache(tenantId: string) {
  accessCache.delete(tenantId);
}

// The instance URL is typed by customers and then fetched server-side, so it is
// restricted to Salesforce My Domain hosts (no SSRF to arbitrary hosts). A
// pasted Lightning or Setup URL is converted to the API host.
export function normalizeInstanceUrl(input: string) {
  let value = (input || '').trim();
  if (!value) throw new Error('Salesforce URL is required.');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  host = host
    .replace(/\.lightning\.force\.com$/, '.my.salesforce.com')
    .replace(/\.my\.salesforce-setup\.com$/, '.my.salesforce.com');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)?\.my\.salesforce\.com$/.test(host)) {
    throw new Error('Use your Salesforce My Domain URL, for example https://yourcompany.my.salesforce.com');
  }
  return `https://${host}`;
}

export async function loadIntegration(tenantId: string) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin
    .from('integrations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('provider', 'salesforce')
    .maybeSingle();
  if (error) throw error;
  return { admin, row: data };
}

export async function getSalesforceAccess(tenantId: string, forceRefresh = false): Promise<Access> {
  const cached = accessCache.get(tenantId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const { row } = await loadIntegration(tenantId);
  if (!row || !row.instance_url || !row.client_id || !row.username || !row.private_key_enc) {
    throw new Error('Salesforce is not connected for this organization. An admin can connect it under Admin, then Integrations.');
  }

  const loginUrl = row.environment === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
  const key = await importPKCS8(await decryptSecret(row.private_key_enc), 'RS256');

  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(row.client_id)
    .setSubject(row.username)
    .setAudience(loginUrl)
    .setExpirationTime('3m')
    .sign(key);

  const response = await fetch(`${row.instance_url}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Salesforce auth failed (${response.status}): ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  }

  // Salesforce does not return expires_in for this flow; re-auth after 30 min
  // to stay well inside the org's session length.
  const access = { token: body.access_token as string, instanceUrl: body.instance_url as string, expiresAt: Date.now() + 30 * 60_000 };
  accessCache.set(tenantId, access);
  return access;
}

export async function sfRequest(tenantId: string, path: string, init: RequestInit = {}) {
  const send = async (forceRefresh: boolean) => {
    const { token, instanceUrl } = await getSalesforceAccess(tenantId, forceRefresh);
    return fetch(`${instanceUrl}/services/data/${API_VERSION}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  };

  let response = await send(false);
  if (response.status === 401) {
    // Cached session was rejected (expired/revoked): re-auth and retry once.
    accessCache.delete(tenantId);
    response = await send(true);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Salesforce API error (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

export function sfQuery(tenantId: string, soql: string) {
  return sfRequest(tenantId, `/query?q=${encodeURIComponent(soql)}`);
}

// Makes an existing Salesforce File visible on another record (e.g. a Contract),
// without copying it. No-op if the link already exists.
export async function linkFileToRecord(tenantId: string, contentDocumentId: string, recordId: string) {
  if (!SF_ID_RE.test(contentDocumentId) || !SF_ID_RE.test(recordId)) {
    throw new Error('Invalid Salesforce id for file link.');
  }
  const existing = await sfQuery(
    tenantId,
    `SELECT Id FROM ContentDocumentLink WHERE ContentDocumentId = '${contentDocumentId}' AND LinkedEntityId = '${recordId}'`,
  );
  if (existing.records?.length) return false;
  await sfRequest(tenantId, '/sobjects/ContentDocumentLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ContentDocumentId: contentDocumentId, LinkedEntityId: recordId, ShareType: 'V', Visibility: 'AllUsers' }),
  });
  return true;
}
