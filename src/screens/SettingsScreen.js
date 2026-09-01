import { useEffect, useState } from 'react';
import { getSignatureUsageThisMonth, SIGNATURES_INCLUDED_PER_USER, SIGNATURE_OVERAGE_PRICE } from '../supabase';
import './SettingsScreen.css';

function SettingsScreen() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  const pct = usage && usage.included > 0 ? Math.min(100, Math.round((usage.used / usage.included) * 100)) : 0;

  return (
    <div className="settings">
      <h2 className="settings__title">Settings</h2>

      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Signature usage — this month</h3>
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
                {usage.over} signature{usage.over === 1 ? '' : 's'} over quota this month, at €{SIGNATURE_OVERAGE_PRICE} each —
                estimated extra charge: <strong>€{usage.overageCost}</strong>.
              </p>
            )}
          </>
        ) : (
          <p className="settings__loading">Could not load usage data.</p>
        )}
      </div>
    </div>
  );
}

export default SettingsScreen;
