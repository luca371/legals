const EXPIRING_SOON_DAYS = 30;

// Aggregates one account's health from its agreements — active count,
// how many expire soon, how many were last flagged "high" risk by Review
// AI, and how many playbook violations are outstanding across them.
// lastAiReview is a snapshot from the agreement's last AI review, not a
// live re-check, so this reflects whenever each agreement was last
// reviewed, not necessarily its current state.
export function computeAccountHealth(agreements) {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86400000);

  const activeAgreements = agreements.filter((a) => a.status === 'Activated');
  const expiringSoonCount = activeAgreements.filter((a) => {
    if (!a.endDate) return false;
    const end = new Date(a.endDate);
    return end >= now && end <= soonCutoff;
  }).length;

  const highRiskCount = agreements.filter((a) => a.lastAiReview?.riskLevel === 'high').length;
  const playbookViolationCount = agreements.reduce(
    (sum, a) => sum + (a.lastAiReview?.playbookViolationCount || 0),
    0
  );

  let score = 100;
  score -= Math.min(40, expiringSoonCount * 10);
  score -= Math.min(40, highRiskCount * 15);
  score -= Math.min(30, playbookViolationCount * 8);
  score = Math.max(0, Math.min(100, score));

  let label = 'Good';
  if (score < 50) label = 'At risk';
  else if (score < 80) label = 'Needs attention';

  return {
    score,
    label,
    activeCount: activeAgreements.length,
    expiringSoonCount,
    highRiskCount,
    playbookViolationCount,
  };
}

// Groups a flat agreements list by accountId and computes health for each
// — the shape AccountsScreen needs to show a health pill per row.
export function computeHealthByAccount(agreements) {
  const byAccount = new Map();
  agreements.forEach((a) => {
    if (!a.accountId) return;
    if (!byAccount.has(a.accountId)) byAccount.set(a.accountId, []);
    byAccount.get(a.accountId).push(a);
  });
  const result = new Map();
  byAccount.forEach((accountAgreements, accountId) => {
    result.set(accountId, computeAccountHealth(accountAgreements));
  });
  return result;
}
