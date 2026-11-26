import { jsonResponse } from './cors.ts';

// Per-user cap on paid AI calls, counted across every AI function together.
// Ask E makes several calls per question (one per tool step), hence the room.
const AI_CALLS_PER_HOUR = Number(Deno.env.get('AI_CALLS_PER_HOUR') || 300);

type Auth = { admin: any; user: { id: string }; tenantId: string };

// Returns a 429 response when the caller is over the limit, otherwise null.
export async function enforceAiLimit(auth: Auth, fn: string) {
  const { data, error } = await auth.admin.rpc('ai_usage_hit', {
    p_user: auth.user.id,
    p_tenant: auth.tenantId,
    p_fn: fn,
    p_limit: AI_CALLS_PER_HOUR,
  });
  if (error) {
    // A broken counter must not take the AI features down with it.
    console.error('AI usage check failed:', error);
    return null;
  }
  if (data === false) {
    return jsonResponse({ error: 'You have reached the hourly AI limit. Please try again later.' }, 429);
  }
  return null;
}
