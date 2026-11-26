// The AI features an organization can switch on and off (Admin > AI features),
// and what one use costs in credits. Keep the keys and costs in step with
// AI_FUNCTIONS in supabase/functions/_shared/ratelimit.ts, which is what
// actually enforces and charges them.
export const AI_FEATURES = [
  {
    key: 'drafting',
    label: 'Agreement creation',
    description: 'Draft agreements with AI, AI template builder and clause suggestions.',
    costs: 'Draft: 5 credits per message. Template builder and clause suggestions: 1.',
  },
  {
    key: 'review',
    label: 'Review',
    description: 'AI review of agreements against playbooks, and clause analysis.',
    costs: 'Review: 3 credits. Clause analysis: 1.',
  },
  {
    key: 'renewals',
    label: 'Renewal management',
    description: 'Renewal briefs: term, notice deadline, recommendation and follow-up tasks.',
    costs: '3 credits per brief.',
  },
  {
    key: 'portfolio',
    label: 'Portfolio summaries',
    description: "Account briefs covering agreements, obligations, deadlines and open actions.",
    costs: '3 credits per brief.',
  },
  {
    key: 'obligations',
    label: 'Obligations',
    description: 'Find the obligations an agreement creates and add them to the register.',
    costs: '2 credits per run.',
  },
  {
    key: 'screening',
    label: 'Account screening',
    description: "Check an account against its playbook's screening criteria and flag what needs attention.",
    costs: '3 credits per screening.',
  },
  {
    key: 'ask_ai',
    label: 'Ask E',
    description: 'Chat with your agreements and accounts.',
    costs: '1 credit per step (a question can take a few).',
  },
];

// A missing key means the feature is on.
export const featureOn = (features, key) => !features || features[key] !== false;

// Agent actions a playbook can allow on the accounts it is assigned to. Keep in
// step with AGENT_ACTIONS in supabase/functions/_shared/playbooks.ts.
export const AGENT_ACTIONS = [
  { key: 'draft', label: 'Draft agreements' },
  { key: 'review', label: 'AI review' },
  { key: 'renewal_brief', label: 'Renewal briefs' },
  { key: 'account_brief', label: 'Account briefs' },
  { key: 'obligations', label: 'Find obligations' },
  { key: 'screening', label: 'Account screening' },
];

export const TASK_TYPES = [
  { key: 'review', label: 'Review' },
  { key: 'approval', label: 'Approval' },
  { key: 'signature', label: 'Signature' },
  { key: 'renewal', label: 'Renewal' },
  { key: 'obligation', label: 'Obligation' },
  { key: 'other', label: 'Other' },
];
