import { useEffect, useState } from 'react';
import {
  getSignatureUsageThisMonth,
  listAgreements,
  listAccounts,
  listTemplates,
  SIGNATURES_INCLUDED_PER_USER,
  SIGNATURE_OVERAGE_PRICE,
} from '../supabase';
import { indexObject } from '../embeddingsApi';
import './SettingsScreen.css';

const REINDEX_CONCURRENCY = 3;

function SettingsScreen() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  const [reindexing, setReindexing] = useState(false);
  const [reindexDone, setReindexDone] = useState(0);
  const [reindexTotal, setReindexTotal] = useState(0);
  const [reindexFailed, setReindexFailed] = useState(0);
  const [reindexFinished, setReindexFinished] = useState(false);

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

  const handleReindexAll = async () => {
    setReindexing(true);
    setReindexFinished(false);
    setReindexDone(0);
    setReindexFailed(0);
    try {
      const [agreements, accounts, templates] = await Promise.all([listAgreements(), listAccounts(), listTemplates()]);
      const items = [
        ...agreements.map((a) => ({ objectType: 'agreement', id: a.id, label: a.title })),
        ...accounts.map((a) => ({ objectType: 'account', id: a.id, label: a.name })),
        ...templates.map((t) => ({ objectType: 'template', id: t.id, label: t.name })),
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

      <div className="settings__card">
        <div className="settings__card-header">
          <h3 className="settings__card-title">Ask AI — search index</h3>
          <span className="settings__card-hint">
            Powers "search by meaning" in Ask AI, across agreements, accounts, and templates. New and edited records
            index automatically — use this to (re)index everything at once, e.g. before a demo.
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
            Done — indexed {reindexDone - reindexFailed} of {reindexTotal} record{reindexTotal === 1 ? '' : 's'}
            {reindexFailed > 0 ? `, ${reindexFailed} failed (check the console for details).` : '.'}
          </p>
        )}

        <button type="button" className="settings__reindex-btn" onClick={handleReindexAll} disabled={reindexing}>
          {reindexing ? 'Indexing…' : 'Reindex everything'}
        </button>
      </div>
    </div>
  );
}

export default SettingsScreen;
