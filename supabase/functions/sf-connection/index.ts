import * as x509 from 'npm:@peculiar/x509@1';
import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { encryptSecret } from '../_shared/crypto.ts';
import { clearSalesforceCache, getSalesforceAccess, loadIntegration, normalizeInstanceUrl, sfQuery } from '../_shared/salesforce.ts';

// Admin-only management of a tenant's Salesforce connection. The platform
// generates the key pair itself, so customers never handle a private key: they
// download the public certificate and upload it to their Salesforce app.
x509.cryptoProvider.set(crypto);

const CLIENT_ID_RE = /^[A-Za-z0-9._]{20,200}$/;
const USERNAME_RE = /^[^\s@]{1,100}@[^\s@]{1,100}$/;

function toPem(bytes: Uint8Array, label: string) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const lines = btoa(binary).match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

async function generateCertificate(commonName: string) {
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const keys = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;

  const serial = crypto.getRandomValues(new Uint8Array(8));
  serial[0] &= 0x7f; // keep the serial positive
  const notBefore = new Date(Date.now() - 5 * 60_000);
  const notAfter = new Date(Date.now() + 2 * 365 * 86_400_000);

  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: Array.from(serial, (b) => b.toString(16).padStart(2, '0')).join(''),
    name: `CN=${commonName}`,
    notBefore,
    notAfter,
    signingAlgorithm: alg,
    keys,
    extensions: [new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true)],
  });

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return { certificatePem: certificate.toString('pem'), privateKeyPem: toPem(pkcs8, 'PRIVATE KEY'), notAfter };
}

// deno-lint-ignore no-explicit-any
function publicStatus(row: any) {
  if (!row) return { configured: false, hasCertificate: false, status: 'not_connected' };
  return {
    configured: !!(row.instance_url && row.client_id && row.username),
    hasCertificate: !!row.private_key_enc,
    certificatePem: row.certificate_pem || null,
    certificateExpiresAt: row.certificate_expires_at,
    environment: row.environment,
    instanceUrl: row.instance_url,
    clientId: row.client_id,
    username: row.username,
    status: row.status,
    lastError: row.last_error,
    lastTestedAt: row.last_tested_at,
  };
}

async function runTest(tenantId: string) {
  const { admin } = await loadIntegration(tenantId);
  clearSalesforceCache(tenantId);
  const now = new Date().toISOString();
  try {
    await getSalesforceAccess(tenantId, true);
    const accounts = await sfQuery(tenantId, 'SELECT Id FROM Account LIMIT 1');
    await admin
      .from('integrations')
      .update({ status: 'connected', last_error: null, last_tested_at: now, updated_at: now })
      .eq('tenant_id', tenantId)
      .eq('provider', 'salesforce');
    return { ok: true, accountsVisible: (accounts.totalSize ?? 0) > 0 };
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'Connection test failed.').slice(0, 500);
    await admin
      .from('integrations')
      .update({ status: 'error', last_error: message, last_tested_at: now, updated_at: now })
      .eq('tenant_id', tenantId)
      .eq('provider', 'salesforce');
    return { ok: false, error: message };
  }
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const { admin, user, tenantId } = auth;

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === 'status') {
      const { row } = await loadIntegration(tenantId);
      return jsonResponse(publicStatus(row));
    }

    if (action === 'generate-certificate') {
      const generated = await generateCertificate(`legal-space-${tenantId.slice(0, 8)}`);
      const now = new Date().toISOString();
      const { row } = await loadIntegration(tenantId);
      const values = {
        private_key_enc: await encryptSecret(generated.privateKeyPem),
        certificate_pem: generated.certificatePem,
        certificate_expires_at: generated.notAfter.toISOString(),
        // A new key invalidates whatever was uploaded to Salesforce before.
        status: 'pending',
        last_error: null,
        connected_by: user.id,
        updated_at: now,
      };
      const { error } = row
        ? await admin.from('integrations').update(values).eq('tenant_id', tenantId).eq('provider', 'salesforce')
        : await admin.from('integrations').insert({ tenant_id: tenantId, provider: 'salesforce', ...values });
      if (error) throw error;
      clearSalesforceCache(tenantId);
      const { row: saved } = await loadIntegration(tenantId);
      return jsonResponse(publicStatus(saved));
    }

    if (action === 'save') {
      const { row } = await loadIntegration(tenantId);
      if (!row?.private_key_enc) {
        return jsonResponse({ error: 'Generate the certificate first.' }, 400);
      }
      const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';
      const clientId = String(body.clientId || '').trim();
      const username = String(body.username || '').trim();
      if (!CLIENT_ID_RE.test(clientId)) return jsonResponse({ error: 'Consumer Key looks invalid.' }, 400);
      if (!USERNAME_RE.test(username)) return jsonResponse({ error: 'Integration username must look like name@company.com.' }, 400);
      let instanceUrl: string;
      try {
        instanceUrl = normalizeInstanceUrl(String(body.instanceUrl || ''));
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Invalid Salesforce URL.' }, 400);
      }

      const { error } = await admin
        .from('integrations')
        .update({
          environment,
          instance_url: instanceUrl,
          client_id: clientId,
          username,
          status: 'pending',
          last_error: null,
          connected_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('provider', 'salesforce');
      if (error) throw error;

      const test = await runTest(tenantId);
      const { row: saved } = await loadIntegration(tenantId);
      return jsonResponse({ ...publicStatus(saved), test });
    }

    if (action === 'test') {
      const { row } = await loadIntegration(tenantId);
      if (!row?.instance_url) return jsonResponse({ error: 'Salesforce is not configured yet.' }, 400);
      const test = await runTest(tenantId);
      const { row: saved } = await loadIntegration(tenantId);
      return jsonResponse({ ...publicStatus(saved), test });
    }

    if (action === 'disconnect') {
      const { error } = await admin.from('integrations').delete().eq('tenant_id', tenantId).eq('provider', 'salesforce');
      if (error) throw error;
      clearSalesforceCache(tenantId);
      return jsonResponse(publicStatus(null));
    }

    return jsonResponse({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('Salesforce connection error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Salesforce connection failed.' }, 500);
  }
});
