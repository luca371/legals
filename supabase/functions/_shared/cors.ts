export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Browsers may only call the functions from the app itself (and a local dev
// server). Calls with no Origin header, such as pg_cron, are not affected.
function allowedOrigins() {
  const list = [Deno.env.get('APP_BASE_URL'), Deno.env.get('APP_URL'), 'http://localhost:3000'];
  for (const o of (Deno.env.get('ALLOWED_ORIGINS') || '').split(',')) list.push(o);
  return new Set(list.map((o) => (o || '').trim().replace(/\/$/, '')).filter(Boolean));
}

// Drop-in for Deno.serve: sets Access-Control-Allow-Origin to the caller's
// origin when it is allowed, and leaves it out otherwise.
export function serveWithCors(handler: (req: Request) => Response | Promise<Response>) {
  const allowed = allowedOrigins();
  return Deno.serve(async (req) => {
    const res = await handler(req);
    const origin = req.headers.get('Origin');
    const headers = new Headers(res.headers);
    if (origin && allowed.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    } else {
      headers.delete('Access-Control-Allow-Origin');
    }
    headers.append('Vary', 'Origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
}
