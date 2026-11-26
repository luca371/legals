// AES-256-GCM encryption for secrets stored in the database (e.g. customers'
// integration private keys). The key lives only in the INTEGRATION_ENC_KEY
// Edge Function secret: a base64-encoded 32-byte value.
//   Generate once:  openssl rand -base64 32
//   Set:            supabase secrets set INTEGRATION_ENC_KEY="<value>"
// Do not rotate it casually: existing ciphertexts can only be read with the key
// they were written with.

function toBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function getKey() {
  const raw = Deno.env.get('INTEGRATION_ENC_KEY');
  if (!raw) throw new Error('Missing INTEGRATION_ENC_KEY secret on the Edge Function.');
  const bytes = toBytes(raw);
  if (bytes.length !== 32) throw new Error('INTEGRATION_ENC_KEY must be 32 bytes, base64 encoded.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(plaintext));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string) {
  const [iv, cipher] = payload.split('.');
  if (!iv || !cipher) throw new Error('Stored secret is malformed.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(iv) }, await getKey(), toBytes(cipher));
  return new TextDecoder().decode(plain);
}
