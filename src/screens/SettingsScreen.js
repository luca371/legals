import { useEffect, useState } from 'react';
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
  SIGNATURES_INCLUDED_PER_USER,
  SIGNATURE_OVERAGE_PRICE,
} from '../supabase';
import { indexObject } from '../embeddingsApi';
import './SettingsScreen.css';

// Sequential, not parallel — Voyage throttles accounts with no payment
// method on file to 3 requests/minute, and firing several at once just
// burns through that budget instantly. The edge function itself retries
// on 429 too, but avoiding the burst in the first place is better.
const REINDEX_CONCURRENCY = 1;

function SettingsScreen() {
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
  const [playbookForm, setPlaybookForm] = useState({ title: '', body: '' });
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
  }, []);

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
    setPlaybookForm({ title: '', body: '' });
    setPlaybookError('');
  };

  const handleStartEditPlaybook = (pb) => {
    setEditingPlaybookId(pb.id);
    setPlaybookForm({ title: pb.title, body: pb.body });
    setPlaybookError('');
  };

  const handleCancelPlaybookEdit = () => {
    setEditingPlaybookId(null);
    setPlaybookForm({ title: '', body: '' });
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
      setPlaybookForm({ title: '', body: '' });
      await loadPlaybooks();
    } catch (err) {
      console.error('Failed to save playbook:', err);
      setPlaybookError('Could not save the playbook. Please try again.');
    } finally {
      setSavingPlaybook(false);
    }
  };

  const handleDeletePlaybook = async (id) => {
    if (!window.confirm('Delete this playbook? Accounts it\'s assigned to will lose it too. This can\'t be undone.')) return;
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

      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Ask AI - search index</h3>
          <span className="settings__card-hint">
            Powers "search by meaning" in Ask AI, across agreements, accounts, and templates. New and edited records
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsScreen;
