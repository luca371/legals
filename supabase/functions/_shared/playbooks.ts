import { jsonResponse } from './cors.ts';

// Playbooks are assigned to accounts. Besides their general rules (body) they
// can list obligations to track, review criteria, screening criteria, and the
// agent actions allowed on the account. Keep AGENT_ACTIONS in step with
// src/aiFeatures.js.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const AGENT_ACTIONS = ['draft', 'review', 'renewal_brief', 'account_brief', 'obligations', 'screening'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const PLAYBOOK_COLUMNS = 'title, body, obligations, review_criteria, screening_criteria, permitted_actions';

// What an agent reads: only the sections that have content.
export function playbookForAgent(p: Row | null | undefined) {
  if (!p) return null;
  const out: Row = { title: p.title || '' };
  if (p.body?.trim()) out.rules = p.body.trim();
  if (p.obligations?.trim()) out.obligationsToTrack = p.obligations.trim();
  if (p.review_criteria?.trim()) out.reviewCriteria = p.review_criteria.trim();
  if (p.screening_criteria?.trim()) out.screeningCriteria = p.screening_criteria.trim();
  return out;
}

// The playbooks assigned to one account, read with the caller's own client so
// RLS applies.
export async function accountPlaybooks(client: Row, accountId: string | null | undefined): Promise<Row[]> {
  if (!accountId) return [];
  const { data, error } = await client
    .from('account_playbooks')
    .select(`playbooks(${PLAYBOOK_COLUMNS})`)
    .eq('account_id', accountId);
  if (error) throw error;
  return (data || []).map((r: Row) => r.playbooks).filter(Boolean);
}

// An action is allowed unless a playbook assigned to the account lists its
// permitted actions and leaves this one out (the strictest playbook wins).
export function actionAllowed(playbooks: Row[], action: AgentAction) {
  return playbooks.every((p) => !Array.isArray(p.permitted_actions) || p.permitted_actions.includes(action));
}

const ACTION_LABELS: Record<AgentAction, string> = {
  draft: 'drafting',
  review: 'AI review',
  renewal_brief: 'renewal briefs',
  account_brief: 'account briefs',
  obligations: 'finding obligations',
  screening: 'account screening',
};

export function actionNotAllowedResponse(action: AgentAction) {
  return jsonResponse(
    { error: `The playbook assigned to this account does not allow ${ACTION_LABELS[action]}.` },
    403
  );
}
