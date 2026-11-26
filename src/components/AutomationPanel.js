import { useEffect, useState } from 'react';
import { useConfirm } from './ConfirmProvider';
import { TASK_TYPES } from '../aiFeatures';
import { listAutomationRules, saveAutomationRule, deleteAutomationRule, getBuiltInFieldConfigs } from '../supabase';
import './AutomationPanel.css';

const DEFAULT_STATUSES = ['Draft', 'Generated', 'Import offline', 'In review', 'Reviewed', 'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated'];
const TYPE_LABELS = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t.label]));
const EMPTY = { name: '', triggerStatus: 'Activated', taskTitle: '', taskType: 'other', dueInDays: '', assignee: 'creator', enabled: true };

// Built-in automations (always on) plus the organization's own rules:
// "when an agreement's status becomes X, create task Y".
function AutomationPanel() {
  const confirm = useConfirm();
  const [rules, setRules] = useState([]);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setRules(await listAutomationRules());
    } catch (err) {
      console.error('Failed to load rules:', err);
      setError('Could not load the automation rules.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getBuiltInFieldConfigs('agreement')
      .then((c) => { if (c?.status?.length) setStatuses(c.status); })
      .catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.taskTitle.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (form.assignee !== 'creator' && !/^\S+@\S+\.\S+$/.test(form.assignee.trim())) {
      setError('The assignee must be "creator" or an email address.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveAutomationRule(form);
      setForm(null);
      await load();
    } catch (err) {
      console.error('Failed to save rule:', err);
      setError('Could not save the rule. Admin changes need a session verified with two-factor.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await saveAutomationRule({ ...rule, enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    } catch (err) {
      console.error('Failed to update rule:', err);
      setError('Could not update the rule.');
    }
  };

  const handleDelete = async (rule) => {
    if (!(await confirm({ title: 'Delete rule', message: `Delete "${rule.name || rule.taskTitle}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteAutomationRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (err) {
      console.error('Failed to delete rule:', err);
      setError('Could not delete the rule.');
    }
  };

  return (
    <div className="admin__panel aut">
      <div className="admin__panel-header">
        <h2 className="admin__panel-title">Automation</h2>
        {!form && <button className="admin__add-btn" onClick={() => setForm({ ...EMPTY })}>+ Add rule</button>}
      </div>

      <div className="aut__builtin">
        <h3 className="aut__subtitle">Always on</h3>
        <ul className="aut__list-plain">
          <li>When an agreement is <strong>activated</strong>, each open obligation with a due date becomes a task.</li>
          <li>When a <strong>recurring obligation</strong> is done (weekly, monthly, quarterly, yearly...), the next one is created with its task.</li>
          <li>Sending for <strong>review</strong>, <strong>approval</strong> or <strong>signature</strong> creates a follow-up task for the agreement's creator; it closes on its own when the step is complete.</li>
          <li>Answers to reviews and approvals, signed agreements, and tasks assigned to someone appear in their <strong>notifications</strong>.</li>
        </ul>
      </div>

      {error && <p className="aut__error">{error}</p>}

      {form && (
        <form className="aut__form" onSubmit={handleSave}>
          <div className="aut__sentence">
            When an agreement's status becomes
            <select className="aut__input" value={form.triggerStatus} onChange={(e) => setForm({ ...form, triggerStatus: e.target.value })}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            create a
            <select className="aut__input" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
              {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label.toLowerCase()}</option>)}
            </select>
            task
          </div>
          <label className="aut__label">
            Task title <span className="aut__hint">{'{title}'} is replaced with the agreement's title</span>
            <input className="aut__input" value={form.taskTitle} onChange={(e) => setForm({ ...form, taskTitle: e.target.value })} placeholder="e.g. Archive the signed copy of {title}" />
          </label>
          <div className="aut__grid">
            <label className="aut__label">
              Due after (days)
              <input type="number" min="0" className="aut__input" value={form.dueInDays ?? ''} onChange={(e) => setForm({ ...form, dueInDays: e.target.value })} placeholder="No due date" />
            </label>
            <label className="aut__label">
              Assign to
              <input className="aut__input" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="creator, or an email" />
            </label>
            <label className="aut__label">
              Name (optional)
              <input className="aut__input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <div className="aut__actions">
            <button type="button" className="aut__btn-secondary" onClick={() => { setForm(null); setError(''); }}>Cancel</button>
            <button type="submit" className="admin__add-btn" disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
          </div>
        </form>
      )}

      <h3 className="aut__subtitle">Your rules</h3>
      {loading ? (
        <p className="admin__empty">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="admin__empty">No rules yet.</p>
      ) : (
        <ul className="aut__rules">
          {rules.map((r) => (
            <li key={r.id} className={`aut__rule ${r.enabled ? '' : 'aut__rule--off'}`}>
              <div>
                <span className="aut__rule-text">
                  When status becomes <strong>{r.triggerStatus}</strong>: {TYPE_LABELS[r.taskType]?.toLowerCase() || r.taskType} task "{r.taskTitle}"
                  {r.dueInDays !== null && r.dueInDays !== undefined ? `, due after ${r.dueInDays} day${r.dueInDays === 1 ? '' : 's'}` : ''}
                  , for {r.assignee === 'creator' ? "the agreement's creator" : r.assignee}
                </span>
                {r.name && <span className="aut__hint">{r.name}</span>}
              </div>
              <div className="aut__rule-actions">
                <button type="button" className="aut__link" onClick={() => handleToggle(r)}>{r.enabled ? 'Pause' : 'Resume'}</button>
                <button type="button" className="aut__link" onClick={() => setForm({ ...r, dueInDays: r.dueInDays ?? '' })}>Edit</button>
                <button type="button" className="aut__link aut__link--danger" onClick={() => handleDelete(r)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AutomationPanel;
