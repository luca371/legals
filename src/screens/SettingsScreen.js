import { useEffect, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import {
  getSignatureUsageThisMonth,
  listAgreements,
  listAccounts,
  listTemplates,
  listClauseLibrary,
  listPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  getReminderSettings,
  updateReminderSettings,
  listAuditLog,
  SIGNATURES_INCLUDED_PER_USER,
  SIGNATURE_OVERAGE_PRICE,
} from '../supabase';
import { indexObject } from '../embeddingsApi';
import AskELabel from '../components/AskELabel';
import { useAuth } from '../AuthContext';
import './SettingsScreen.css';
import { AGENT_ACTIONS } from '../aiFeatures';

const EMPTY_PLAYBOOK = { title: '', body: '', obligations: '', reviewCriteria: '', screeningCriteria: '', permittedActions: null };

// Sequential, not parallel — Voyage throttles accounts with no payment
// method on file to 3 requests/minute, and firing several at once just
// burns through that budget instantly. The edge function itself retries
// on 429 too, but avoiding the burst in the first place is better.
const REINDEX_CONCURRENCY = 1;

const AUDIT_ACTION_LABELS = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  viewed: 'Viewed',
  status_changed: 'Status changed',
  sent_for_signature: 'Sent for signature',
  marked_signed_manually: 'Marked as signed manually',
  signed: 'Signed',
  sent_for_approval: 'Sent for approval',
  sent_for_review: 'Sent for review',
  document_added: 'Document added',
  document_removed: 'Document removed',
  sent_to_salesforce: 'Sent to Salesforce',
  synced_to_salesforce: 'Synced to Salesforce',
  salesforce_account_sync: 'Salesforce account sync',
  profile_changed: 'Profile changed',
  user_created: 'User created',
};

const AUDIT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'changes', label: 'Changes' },
  { id: 'views', label: 'Views' },
];

// One readable line describing what an entry did, built from its stored details.
function formatAuditDetails(entry) {
  const d = entry.details || {};
  const show = (v) => (v === undefined || v === null || v === '' ? '(empty)' : String(v));
  const changes = Array.isArray(d.changes)
    ? d.changes.map((c) => (c.edited ? `${c.field} edited` : `${c.field}: ${show(c.from)} \u2192 ${show(c.to)}`))
    : [];
  let lead = '';
  switch (entry.action) {
    case 'status_changed':
      lead = d.status ? `Status: ${show(d.from)} \u2192 ${d.status}` : '';
      break;
    case 'profile_changed':
      lead = `Profile: ${show(d.from)} \u2192 ${show(d.to)}`;
      break;
    case 'user_created':
      lead = d.profile ? `Profile: ${d.profile}` : '';
      break;
    case 'sent_for_review':
      lead = d.reviewerEmail ? `To: ${d.reviewerEmail}` : '';
      break;
    case 'sent_for_approval':
      lead = d.approverEmail ? `To: ${d.approverEmail}` : '';
      break;
    case 'document_added':
    case 'document_removed':
      lead = d.name || '';
      break;
    case 'sent_to_salesforce':
      lead = [d.document, d.outcome && `(${d.outcome})`].filter(Boolean).join(' ');
      break;
    case 'synced_to_salesforce':
      lead = `Contract ${d.action || 'synced'}, status ${d.sfStatus || '-'}, ${d.documents || 0} document(s) sent`;
      break;
    case 'salesforce_account_sync':
      lead = `${d.created || 0} new, ${d.updated || 0} updated`;
      break;
    default:
      break;
  }
  return [lead, ...changes].filter(Boolean).join('; ');
}

function formatAuditAction(action) {
  return AUDIT_ACTION_LABELS[action] || action;
}

function SettingsScreen() {
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  const [reindexing, setReindexing] = useState(false);
  const [reindexDone, setReindexDone] = useState(0);
  const [reindexTotal, setReindexTotal] = useState(0);
  const [reindexFailed, setReindexFailed] = useState(0);
  const [reindexFinished, setReindexFinished] = useState(false);

  const [playbooks, setPlaybooks] = useState([]);
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(true);
  const [editingPlaybookId, setEditingPlaybookId] = useState(null); // null | 'new' | an id
  const [playbookForm, setPlaybookForm] = useState(EMPTY_PLAYBOOK);
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [playbookError, setPlaybookError] = useState('');

  const loadPlaybooks = async () => {
    setLoadingPlaybooks(true);
    try {
      setPlaybooks(await listPlaybooks());
    } catch (err) {
      console.error('Failed to load playbooks:', err);
    } finally {
      setLoadingPlaybooks(false);
    }
  };

  const [reminderDays, setReminderDays] = useState([]);
  const [loadingReminderDays, setLoadingReminderDays] = useState(true);
  const [newReminderDay, setNewReminderDay] = useState('');
  const [savingReminderDays, setSavingReminderDays] = useState(false);
  const [reminderDaysSaved, setReminderDaysSaved] = useState(false);

  const loadReminderDays = async () => {
    setLoadingReminderDays(true);
    try {
      setReminderDays(await getReminderSettings());
    } catch (err) {
      console.error('Failed to load reminder settings:', err);
    } finally {
      setLoadingReminderDays(false);
    }
  };

  const [auditLog, setAuditLog] = useState([]);
  const [loadingAuditLog, setLoadingAuditLog] = useState(true);
  const [auditLogError, setAuditLogError] = useState('');
  const [auditFilter, setAuditFilter] = useState('all');

  const loadAuditLog = async () => {
    setLoadingAuditLog(true);
    setAuditLogError('');
    try {
      setAuditLog(await listAuditLog());
    } catch (err) {
      console.error('Failed to load audit log:', err);
      setAuditLogError(`Could not load the audit log.${err?.message ? ` (${err.message})` : ''}`);
    } finally {
      setLoadingAuditLog(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setUsage(await getSignatureUsageThisMonth());
      } catch (err) {
        console.error('Failed to load signature usage:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
    loadPlaybooks();
    loadReminderDays();
    loadAuditLog();
  }, []);

  const visibleAuditLog = auditLog.filter((e) =>
    auditFilter === 'changes' ? e.action !== 'viewed' : auditFilter === 'views' ? e.action === 'viewed' : true,
  );

  const handleExportAuditLog = () => {
    const header = ['Date', 'Actor', 'Action', 'Object type', 'Object', 'Details', 'Raw details'];
    const rows = auditLog.map((e) => [
      e.createdAt ? new Date(e.createdAt).toISOString() : '',
      e.actorEmail || '',
      e.action,
      e.objectType,
      e.objectLabel || '',
      formatAuditDetails(e),
      JSON.stringify(e.details || {}),
    ]);
    const escapeCell = (cell) => `"${String(cell).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddReminderDay = () => {
    const value = parseInt(newReminderDay, 10);
    if (!Number.isFinite(value) || value <= 0 || reminderDays.includes(value)) return;
    setReminderDays((prev) => [...prev, value].sort((a, b) => b - a));
    setNewReminderDay('');
    setReminderDaysSaved(false);
  };

  const handleRemoveReminderDay = (value) => {
    setReminderDays((prev) => prev.filter((d) => d !== value));
    setReminderDaysSaved(false);
  };

  const handleSaveReminderDays = async () => {
    setSavingReminderDays(true);
    setReminderDaysSaved(false);
    try {
      await updateReminderSettings(reminderDays);
      setReminderDaysSaved(true);
    } catch (err) {
      console.error('Failed to save reminder settings:', err);
      alert('Could not save reminder settings. Please try again.');
    } finally {
      setSavingReminderDays(false);
    }
  };

  const handleStartNewPlaybook = () => {
    setEditingPlaybookId('new');
    setPlaybookForm(EMPTY_PLAYBOOK);
    setPlaybookError('');
  };

  const handleStartEditPlaybook = (pb) => {
    setEditingPlaybookId(pb.id);
    setPlaybookForm({
      title: pb.title,
      body: pb.body,
      obligations: pb.obligations,
      reviewCriteria: pb.reviewCriteria,
      screeningCriteria: pb.screeningCriteria,
      permittedActions: pb.permittedActions,
    });
    setPlaybookError('');
  };

  const handleCancelPlaybookEdit = () => {
    setEditingPlaybookId(null);
    setPlaybookForm(EMPTY_PLAYBOOK);
    setPlaybookError('');
  };

  const handleSavePlaybook = async (e) => {
    e.preventDefault();
    if (!playbookForm.title.trim() || !playbookForm.body.trim()) return;
    setSavingPlaybook(true);
    setPlaybookError('');
    try {
      if (editingPlaybookId === 'new') {
        await createPlaybook(playbookForm);
      } else {
        await updatePlaybook(editingPlaybookId, playbookForm);
      }
      setEditingPlaybookId(null);
      setPlaybookForm(EMPTY_PLAYBOOK);
      await loadPlaybooks();
    } catch (err) {
      console.error('Failed to save playbook:', err);
      setPlaybookError('Could not save the playbook. Please try again.');
    } finally {
      setSavingPlaybook(false);
    }
  };

  const handleDeletePlaybook = async (id) => {
    if (!(await confirm({ title: 'Delete playbook', message: "Accounts this playbook is assigned to will lose it too. This can't be undone.", confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deletePlaybook(id);
      setPlaybooks((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete playbook:', err);
      alert('Could not delete the playbook. Please try again.');
    }
  };

  const pct = usage && usage.included > 0 ? Math.min(100, Math.round((usage.used / usage.included) * 100)) : 0;

  const handleReindexAll = async () => {
    setReindexing(true);
    setReindexFinished(false);
    setReindexDone(0);
    setReindexFailed(0);
    try {
      const [agreements, accounts, templates, clauses] = await Promise.all([
        listAgreements(),
        listAccounts(),
        listTemplates(),
        listClauseLibrary(),
      ]);
      const items = [
        ...agreements.map((a) => ({ objectType: 'agreement', id: a.id, label: a.title })),
        ...accounts.map((a) => ({ objectType: 'account', id: a.id, label: a.name })),
        ...templates.map((t) => ({ objectType: 'template', id: t.id, label: t.name })),
        ...clauses.map((c) => ({ objectType: 'clause', id: c.id, label: c.title })),
      ];
      setReindexTotal(items.length);

      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const item = items[cursor];
          cursor += 1;
          try {
            await indexObject(item.objectType, item.id);
          } catch (err) {
            console.warn(`Failed to index "${item.label}":`, err);
            setReindexFailed((prev) => prev + 1);
          } finally {
            setReindexDone((prev) => prev + 1);
          }
        }
      };

      await Promise.all(Array.from({ length: REINDEX_CONCURRENCY }, worker));
      setReindexFinished(true);
    } catch (err) {
      console.error('Reindex failed:', err);
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="settings">
      <h2 className="settings__title">Settings</h2>

      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Signature usage - this month</h3>
          <span className="settings__card-hint">
            {SIGNATURES_INCLUDED_PER_USER} signatures included per active user / month
          </span>
        </div>

        {loading ? (
          <p className="settings__loading">Loading…</p>
        ) : usage ? (
          <>
            <div className="settings__usage-bar-track">
              <div
                className={`settings__usage-bar-fill ${usage.over > 0 ? 'settings__usage-bar-fill--over' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="settings__usage-stats">
              <div className="settings__usage-stat">
                <span className="settings__usage-stat-value">{usage.used}</span>
                <span className="settings__usage-stat-label">Signatures used</span>
              </div>
              <div className="settings__usage-stat">
                <span className="settings__usage-stat-value">{usage.included}</span>
                <span className="settings__usage-stat-label">Included ({usage.activeUsers} active user{usage.activeUsers === 1 ? '' : 's'})</span>
              </div>
              <div className="settings__usage-stat">
                <span className={`settings__usage-stat-value ${usage.over > 0 ? 'settings__usage-stat-value--over' : ''}`}>
                  {usage.over}
                </span>
                <span className="settings__usage-stat-label">Over quota</span>
              </div>
            </div>
            {usage.over > 0 && (
              <p className="settings__overage-note">
                {usage.over} signature{usage.over === 1 ? '' : 's'} over quota this month, at €{SIGNATURE_OVERAGE_PRICE} each -
                estimated extra charge: <strong>€{usage.overageCost}</strong>.
              </p>
            )}
          </>
        ) : (
          <p className="settings__loading">Could not load usage data.</p>
        )}
      </div>

      {isAdmin && (
      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Expiration reminders</h3>
          <span className="settings__card-hint">
            How many days before an "Activated" agreement's end date its creator gets an email reminder - runs
            automatically once a day. Each threshold only ever emails once per agreement.
          </span>
        </div>

        {loadingReminderDays ? (
          <p className="settings__loading">Loading…</p>
        ) : (
          <>
            <div className="settings__reminder-days">
              {reminderDays.length === 0 ? (
                <span className="settings__card-hint">No reminders configured - agreements won't get expiry emails.</span>
              ) : (
                reminderDays.map((d) => (
                  <span key={d} className="settings__reminder-chip">
                    {d} day{d === 1 ? '' : 's'} before
                    <button
                      type="button"
                      className="settings__reminder-chip-remove"
                      onClick={() => handleRemoveReminderDay(d)}
                      aria-label={`Remove ${d}-day reminder`}
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="settings__reminder-add-row">
              <input
                type="number"
                min="1"
                className="settings__playbook-input settings__reminder-add-input"
                placeholder="e.g. 60"
                value={newReminderDay}
                onChange={(e) => setNewReminderDay(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddReminderDay(); } }}
              />
              <button type="button" className="settings__reindex-btn settings__reindex-btn--secondary" onClick={handleAddReminderDay}>
                + Add threshold
              </button>
            </div>
            <div className="settings__playbook-form-actions">
              {reminderDaysSaved && <span className="settings__reminder-saved">✓ Saved</span>}
              <button type="button" className="settings__reindex-btn" onClick={handleSaveReminderDays} disabled={savingReminderDays}>
                {savingReminderDays ? 'Saving…' : 'Save reminders'}
              </button>
            </div>
          </>
        )}
      </div>
      )}

      {isAdmin && (
      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title"><AskELabel /> - search index</h3>
          <span className="settings__card-hint">
            Powers "search by meaning" in <AskELabel />, across agreements, accounts, and templates. New and edited records
            index automatically - use this to (re)index everything at once, e.g. before a demo.
          </span>
        </div>

        {reindexing && (
          <>
            <div className="settings__usage-bar-track">
              <div
                className="settings__usage-bar-fill"
                style={{ width: `${reindexTotal > 0 ? Math.round((reindexDone / reindexTotal) * 100) : 0}%` }}
              />
            </div>
            <p className="settings__card-hint">
              Indexed {reindexDone} of {reindexTotal}
              {reindexFailed > 0 ? ` (${reindexFailed} failed)` : ''}…
            </p>
          </>
        )}

        {!reindexing && reindexFinished && (
          <p className={reindexFailed > 0 ? 'settings__overage-note' : 'settings__card-hint'}>
            Done - indexed {reindexDone - reindexFailed} of {reindexTotal} record{reindexTotal === 1 ? '' : 's'}
            {reindexFailed > 0 ? `, ${reindexFailed} failed (check the console for details).` : '.'}
          </p>
        )}

        <button type="button" className="settings__reindex-btn" onClick={handleReindexAll} disabled={reindexing}>
          {reindexing ? 'Indexing…' : 'Reindex everything'}
        </button>
      </div>
      )}

      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Playbooks</h3>
          <span className="settings__card-hint">
            Organization-wide compliance rulesets - assign them to accounts from that account's Playbook tab, then
            pick a subset when reviewing a specific agreement with AI.
          </span>
        </div>

        {editingPlaybookId === null ? (
          <button type="button" className="settings__reindex-btn" onClick={handleStartNewPlaybook}>
            + Add playbook
          </button>
        ) : (
          <form className="settings__playbook-form" onSubmit={handleSavePlaybook}>
            {playbookError && <p className="settings__overage-note">{playbookError}</p>}
            <input
              type="text"
              className="settings__playbook-input"
              placeholder="Playbook name, e.g. “Procurement rules”"
              value={playbookForm.title}
              onChange={(e) => setPlaybookForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
            <textarea
              className="settings__playbook-input settings__playbook-textarea"
              value={playbookForm.body}
              onChange={(e) => setPlaybookForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="e.g.&#10;- Payment terms must not exceed Net 60&#10;- Liability cap must be at least 1x annual fees&#10;- Governing law must be Romanian law"
              rows={8}
              required
            />
            <label className="settings__playbook-label">
              Obligations to track
              <span className="settings__playbook-sub">What agreements with these accounts must contain and what to follow up. Used by drafting, review and the obligations finder.</span>
              <textarea
                className="settings__playbook-input"
                value={playbookForm.obligations}
                onChange={(e) => setPlaybookForm((f) => ({ ...f, obligations: e.target.value }))}
                placeholder="e.g.&#10;- Quarterly service report from the supplier&#10;- Annual insurance certificate"
                rows={4}
              />
            </label>
            <label className="settings__playbook-label">
              Review criteria
              <span className="settings__playbook-sub">What AI review should check, on top of the rules above.</span>
              <textarea
                className="settings__playbook-input"
                value={playbookForm.reviewCriteria}
                onChange={(e) => setPlaybookForm((f) => ({ ...f, reviewCriteria: e.target.value }))}
                placeholder="e.g.&#10;- Flag any unlimited liability&#10;- Flag auto-renewal longer than 12 months"
                rows={4}
              />
            </label>
            <label className="settings__playbook-label">
              Screening criteria
              <span className="settings__playbook-sub">What account screening checks. Leave empty to use the default criteria.</span>
              <textarea
                className="settings__playbook-input"
                value={playbookForm.screeningCriteria}
                onChange={(e) => setPlaybookForm((f) => ({ ...f, screeningCriteria: e.target.value }))}
                placeholder="e.g.&#10;- Tax registration number on file&#10;- No agreement past its notice deadline"
                rows={4}
              />
            </label>
            <div className="settings__playbook-label">
              Allowed AI actions on the accounts this playbook is assigned to
              <span className="settings__playbook-sub">Untick an action to block it for those accounts. When several playbooks apply, the strictest wins.</span>
              <div className="settings__playbook-actions">
                {AGENT_ACTIONS.map((a) => {
                  const allowed = !playbookForm.permittedActions || playbookForm.permittedActions.includes(a.key);
                  return (
                    <label key={a.key} className="settings__playbook-action">
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={(e) =>
                          setPlaybookForm((f) => {
                            const current = f.permittedActions || AGENT_ACTIONS.map((x) => x.key);
                            const next = e.target.checked ? [...new Set([...current, a.key])] : current.filter((k) => k !== a.key);
                            // Everything allowed is stored as null, so new actions are allowed by default.
                            return { ...f, permittedActions: next.length === AGENT_ACTIONS.length ? null : next };
                          })
                        }
                      />
                      {a.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="settings__playbook-form-actions">
              <button type="button" className="settings__reindex-btn settings__reindex-btn--secondary" onClick={handleCancelPlaybookEdit}>
                Cancel
              </button>
              <button type="submit" className="settings__reindex-btn" disabled={savingPlaybook}>
                {savingPlaybook ? 'Saving…' : 'Save playbook'}
              </button>
            </div>
          </form>
        )}

        {loadingPlaybooks ? (
          <p className="settings__loading">Loading…</p>
        ) : playbooks.length === 0 && editingPlaybookId === null ? (
          <p className="settings__card-hint">No playbooks yet - add one above.</p>
        ) : (
          <div className="settings__playbook-list">
            {playbooks.map((pb) => (
              <div key={pb.id} className="settings__playbook-card">
                <div className="settings__playbook-card-header">
                  <span className="settings__playbook-card-title">{pb.title}</span>
                  <div className="settings__playbook-card-actions">
                    <button type="button" className="settings__reindex-btn--link" onClick={() => handleStartEditPlaybook(pb)}>
                      Edit
                    </button>
                    <button type="button" className="settings__reindex-btn--link settings__reindex-btn--danger" onClick={() => handleDeletePlaybook(pb.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                <p className="settings__playbook-card-body">{pb.body}</p>
                {(pb.obligations || pb.reviewCriteria || pb.screeningCriteria || pb.permittedActions) && (
                  <p className="settings__playbook-sub">
                    {[
                      pb.obligations && 'obligations',
                      pb.reviewCriteria && 'review criteria',
                      pb.screeningCriteria && 'screening criteria',
                      pb.permittedActions && `AI limited to: ${pb.permittedActions.map((k) => AGENT_ACTIONS.find((a) => a.key === k)?.label || k).join(', ') || 'nothing'}`,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Audit log</h3>
          <span className="settings__card-hint">
            Who viewed, created, edited, sent, or signed a record - covers actions by logged-in users; anonymous
            actions on public approval/review links aren't attributed to anyone and so aren't logged here.
          </span>
        </div>

        {auditLogError && <p className="settings__overage-note">{auditLogError}</p>}

        {loadingAuditLog ? (
          <p className="settings__loading">Loading…</p>
        ) : auditLog.length === 0 ? (
          <p className="settings__card-hint">No activity logged yet.</p>
        ) : (
          <>
            <div className="settings__audit-toolbar">
              <div className="settings__audit-filters" role="group" aria-label="Filter the audit log">
                {AUDIT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`settings__audit-filter ${auditFilter === f.id ? 'settings__audit-filter--active' : ''}`}
                    onClick={() => setAuditFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button type="button" className="settings__reindex-btn" onClick={handleExportAuditLog}>
                Export CSV
              </button>
            </div>
            <div className="settings__audit-table-wrap">
              <table className="settings__audit-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Object</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAuditLog.slice(0, 100).map((e) => (
                    <tr key={e.id}>
                      <td className="settings__audit-date">{e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}</td>
                      <td>{e.actorEmail || '-'}</td>
                      <td>
                        <span className="settings__audit-action">{formatAuditAction(e.action)}</span>
                      </td>
                      <td>{e.objectLabel || e.objectType}</td>
                      <td className="settings__audit-details" title={formatAuditDetails(e)}>{formatAuditDetails(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleAuditLog.length === 0 && (
              <p className="settings__card-hint">Nothing matches this filter.</p>
            )}
            {visibleAuditLog.length > 100 && (
              <p className="settings__card-hint">Showing the 100 most recent - use Export CSV for the full list.</p>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

export default SettingsScreen;
