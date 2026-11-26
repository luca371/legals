import { jsonResponse } from './cors.ts';

// The gate every AI Edge Function passes before doing paid work. In one
// database call (ai_consume) it checks that the feature is switched on for the
// organization, that the user is under the hourly limit, and, when the
// organization pays with credits, that there are enough; then it records the
// call and charges it.

// Per-user cap on AI calls, across every AI function together. Ask E makes
// several calls per question (one per tool step), hence the room.
const AI_CALLS_PER_HOUR = Number(Deno.env.get('AI_CALLS_PER_HOUR') || 300);

// Which feature each function belongs to and what one call costs in credits.
// 'core' features cannot be switched off (they back ordinary screens).
// Keep FEATURES in src/aiFeatures.js in step with the feature names here.
export const AI_FUNCTIONS: Record<string, { feature: string; cost: number }> = {
  'agent-draft': { feature: 'drafting', cost: 5 },
  'ai-builder': { feature: 'drafting', cost: 1 },
  'suggest-clauses': { feature: 'drafting', cost: 1 },
  'review-agreement': { feature: 'review', cost: 3 },
  'analyze-clause': { feature: 'review', cost: 1 },
  'agent-approval-route': { feature: 'review', cost: 2 },
  'agent-renewal-brief': { feature: 'renewals', cost: 3 },
  'agent-account-brief': { feature: 'portfolio', cost: 3 },
  'agent-obligations': { feature: 'obligations', cost: 2 },
  'agent-account-screening': { feature: 'screening', cost: 3 },
  'ask-ai': { feature: 'ask_ai', cost: 1 },
  'extract-agreement-fields': { feature: 'core', cost: 1 },
  'semantic-search': { feature: 'core', cost: 0 },
};

type Auth = { admin: any; user: { id: string }; tenantId: string };

// Returns an error response when the call may not go ahead, otherwise null.
export async function enforceAiLimit(auth: Auth, fn: string) {
  const { feature, cost } = AI_FUNCTIONS[fn] ?? { feature: 'core', cost: 1 };
  const { data, error } = await auth.admin.rpc('ai_consume', {
    p_user: auth.user.id,
    p_tenant: auth.tenantId,
    p_fn: fn,
    p_feature: feature,
    p_cost: cost,
    p_limit: AI_CALLS_PER_HOUR,
  });
  if (error) {
    // A broken counter must not take the AI features down with it.
    console.error('AI usage check failed:', error);
    return null;
  }
  if (data === 'feature_disabled') {
    return jsonResponse(
      { error: 'This AI feature is turned off for your organization. An admin can turn it on in Admin > AI features.' },
      403
    );
  }
  if (data === 'no_credits') {
    return jsonResponse({ error: 'Your organization has run out of AI credits. Ask your admin to add more.' }, 402);
  }
  if (data === 'rate_limited') {
    return jsonResponse({ error: 'You have reached the hourly AI limit. Please try again later.' }, 429);
  }
  return null;
}
