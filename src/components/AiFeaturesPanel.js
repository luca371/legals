import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { AI_FEATURES, featureOn } from '../aiFeatures';
import { getAiFeatures, updateAiFeatures, getCreditStatus, getAiUsage, getMonitoringSettings, saveMonitoringSettings } from '../supabase';
import './AiFeaturesPanel.css';

// Credits are built (supabase/sql/012_automation.sql) but not offered yet: no
// organization is charged until set_credits_enforced() is run for it. Turn this
// on to show the balance and the per-feature costs here.
const SHOW_CREDITS = false;

const FEATURE_LABELS = { ...Object.fromEntries(AI_FEATURES.map((f) => [f.key, f.label])), core: 'Core (field extraction, search)' };

// Admin > AI features: switch each AI feature on or off for the organization,
// and see the credit balance and the last 30 days of usage. Credits are added
// by the platform owner, not from here.
function AiFeaturesPanel() {
  const { setAiFeatures } = useAuth();
  const [features, setFeatures] = useState({});
  const [credits, setCredits] = useState(null);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [monitoring, setMonitoring] = useState({ enabled: false, recipients: '' });
  const [savingMonitoring, setSavingMonitoring] = useState(false);
  const [monitoringSaved, setMonitoringSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAiFeatures(),
      getCreditStatus().catch(() => null),
      getAiUsage(30).catch(() => []),
      getMonitoringSettings().catch(() => ({ enabled: false, recipients: '' })),
    ])
      .then(([f, c, u, m]) => {
        if (cancelled) return;
        setFeatures(f);
        setCredits(c);
        setUsage(u);
        setMonitoring(m);
      })
      .catch((err) => {
        console.error('Failed to load AI settings:', err);
        if (!cancelled) setError('Could not load the AI settings.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async (key) => {
    const next = { ...features, [key]: !featureOn(features, key) };
    // Store only the switched-off ones; on is the default.
    Object.keys(next).forEach((k) => { if (next[k] !== false) delete next[k]; });
    setSavingKey(key);
    setError('');
    try {
      await updateAiFeatures(next);
      setFeatures(next);
      setAiFeatures?.(next);
    } catch (err) {
      console.error('Failed to save AI features:', err);
      setError('Could not save. Admin changes need a session verified with two-factor - sign out and in again if this keeps failing.');
    } finally {
      setSavingKey('');
    }
  };

  const handleSaveMonitoring = async (next) => {
    const emails = String(next.recipients || '').split(/[,;\s]+/).filter(Boolean);
    if (emails.some((e) => !/^\S+@\S+\.\S+$/.test(e))) {
      setError('Enter the digest recipients as email addresses separated by commas.');
      return;
    }
    setSavingMonitoring(true);
    setMonitoringSaved(false);
    setError('');
    try {
      await saveMonitoringSettings({ enabled: next.enabled, recipients: emails.join(', ') });
      setMonitoring({ enabled: next.enabled, recipients: emails.join(', ') });
      setMonitoringSaved(true);
    } catch (err) {
      console.error('Failed to save monitoring settings:', err);
      setError('Could not save. Admin changes need a session verified with two-factor - sign out and in again if this keeps failing.');
    } finally {
      setSavingMonitoring(false);
    }
  };

  if (loading) return <div className="admin__panel"><p className="admin__empty">Loading…</p></div>;

  const totalCredits = usage.reduce((sum, u) => sum + u.credits, 0);
  const totalCalls = usage.reduce((sum, u) => sum + u.calls, 0);

  return (
    <div className="admin__panel aif">
      <div className="admin__panel-header">
        <h2 className="admin__panel-title">AI features</h2>
      </div>

      {error && <p className="aif__error">{error}</p>}

      {SHOW_CREDITS && (
      <div className="aif__credits">
        <div>
          <span className="aif__credits-label">Credit balance</span>
          <strong className="aif__credits-value">
            {credits?.enforced ? credits.balance.toLocaleString() : 'Not metered'}
          </strong>
        </div>
        <div>
          <span className="aif__credits-label">Used in the last 30 days</span>
          <strong className="aif__credits-value">{totalCredits.toLocaleString()} credits · {totalCalls.toLocaleString()} calls</strong>
        </div>
        <p className="aif__note">
          {credits?.enforced
            ? 'Each AI use spends credits from this balance. When it runs out, AI features stop until more credits are added. Contact EsoVia to buy credits.'
            : 'Your organization is not charged per use yet. Usage is still counted below, so you can see what it would cost.'}
        </p>
      </div>
      )}

      <ul className="aif__list">
        {AI_FEATURES.map((f) => {
          const on = featureOn(features, f.key);
          return (
            <li key={f.key} className="aif__item">
              <div className="aif__text">
                <span className="aif__name">{f.label}</span>
                <span className="aif__desc">{f.description}</span>
                {SHOW_CREDITS && <span className="aif__cost">{f.costs}</span>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                className={`aif__switch ${on ? 'aif__switch--on' : ''}`}
                onClick={() => handleToggle(f.key)}
                disabled={savingKey === f.key}
                aria-label={`${f.label} ${on ? 'on' : 'off'}`}
              >
                <span className="aif__knob" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="aif__monitor">
        <div className="aif__item aif__item--plain">
          <div className="aif__text">
            <span className="aif__name">Weekly portfolio monitoring</span>
            <span className="aif__desc">
              Every Monday morning, screens the accounts with live agreements and emails a digest: notice deadlines and
              end dates in the next 30 days, overdue tasks and obligations, and accounts that need attention. Uses
              account screening for each account.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={monitoring.enabled}
            className={`aif__switch ${monitoring.enabled ? 'aif__switch--on' : ''}`}
            onClick={() => handleSaveMonitoring({ ...monitoring, enabled: !monitoring.enabled })}
            disabled={savingMonitoring || !featureOn(features, 'screening')}
            aria-label={`Weekly portfolio monitoring ${monitoring.enabled ? 'on' : 'off'}`}
          >
            <span className="aif__knob" />
          </button>
        </div>
        {!featureOn(features, 'screening') && <p className="aif__note">Turn on Account screening to use weekly monitoring.</p>}
        {monitoring.enabled && (
          <div className="aif__recipients">
            <label className="aif__desc" htmlFor="aif-recipients">Send the digest to (leave empty for all admins)</label>
            <div className="aif__recipients-row">
              <input
                id="aif-recipients"
                className="aif__input"
                value={monitoring.recipients}
                onChange={(e) => { setMonitoring({ ...monitoring, recipients: e.target.value }); setMonitoringSaved(false); }}
                placeholder="legal@company.com, cfo@company.com"
              />
              <button type="button" className="aif__save" onClick={() => handleSaveMonitoring(monitoring)} disabled={savingMonitoring}>
                {savingMonitoring ? 'Saving…' : monitoringSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {usage.length > 0 && (
        <>
          <h3 className="aif__subtitle">Usage by feature, last 30 days</h3>
          <table className="admin__table">
            <thead>
              <tr><th>Feature</th><th>Calls</th>{SHOW_CREDITS && <th>Credits</th>}</tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.feature}>
                  <td>{FEATURE_LABELS[u.feature] || u.feature}</td>
                  <td>{u.calls.toLocaleString()}</td>
                  {SHOW_CREDITS && <td>{u.credits.toLocaleString()}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="aif__note">
        AI agents only read and propose: people approve every change, message and signature. Which actions are allowed
        on each account is set in its playbooks (Settings &gt; Playbooks).
      </p>
    </div>
  );
}

export default AiFeaturesPanel;
