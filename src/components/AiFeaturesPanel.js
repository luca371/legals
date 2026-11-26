import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { AI_FEATURES, featureOn } from '../aiFeatures';
import { getAiFeatures, updateAiFeatures, getCreditStatus, getAiUsage } from '../supabase';
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAiFeatures(), getCreditStatus().catch(() => null), getAiUsage(30).catch(() => [])])
      .then(([f, c, u]) => {
        if (cancelled) return;
        setFeatures(f);
        setCredits(c);
        setUsage(u);
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
