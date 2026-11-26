import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAgentRuns } from '../supabase';
import './AgentActivityPanel.css';

const AGENT_LABELS = {
  draft: 'Draft',
  account_brief: 'Account brief',
  renewal_brief: 'Renewal brief',
  obligations: 'Find obligations',
  account_screening: 'Account screening',
  approval_route: 'Approval routing',
};

function subjectLink(run) {
  if (run.subjectType === 'agreement' && run.subjectId) return `/dashboard/agreements/${run.subjectId}`;
  if (run.subjectType === 'account' && run.subjectId) return `/dashboard/accounts/${run.subjectId}`;
  return null;
}

function duration(run) {
  if (!run.finishedAt) return '-';
  const s = Math.round((new Date(run.finishedAt) - new Date(run.createdAt)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Everything the AI agents did: who ran which agent on what, when, whether it
// finished, and how much it read and wrote. Agents only read and propose -
// any change they suggest is saved by a person, which the audit log records.
function AgentActivityPanel() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agent, setAgent] = useState('all');

  useEffect(() => {
    listAgentRuns(300)
      .then(setRuns)
      .catch((err) => {
        console.error('Failed to load agent runs:', err);
        setError('Could not load the agent activity.');
      })
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => (agent === 'all' ? runs : runs.filter((r) => r.agent === agent)), [runs, agent]);
  const totals = useMemo(
    () => ({
      runs: visible.length,
      failed: visible.filter((r) => r.status === 'failed').length,
      tokens: visible.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0),
    }),
    [visible]
  );

  return (
    <div className="admin__panel agx">
      <div className="admin__panel-header">
        <h2 className="admin__panel-title">AI activity</h2>
        <select className="agx__filter" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="all">All agents</option>
          {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <p className="agx__note">
        Agents only read and propose. Nothing they suggest is saved, sent or signed until a person does it, and those
        actions are in the audit log (Settings).
      </p>

      <div className="agx__totals">
        <span><strong>{totals.runs}</strong> runs</span>
        <span><strong>{totals.failed}</strong> failed</span>
        <span><strong>{totals.tokens.toLocaleString()}</strong> tokens</span>
      </div>

      {error && <p className="agx__error">{error}</p>}
      {loading ? (
        <p className="admin__empty">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="admin__empty">No agent runs yet.</p>
      ) : (
        <div className="admin__table-wrap">
          <table className="admin__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>On</th>
                <th>Run by</th>
                <th>Status</th>
                <th>Time</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const link = subjectLink(r);
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>{AGENT_LABELS[r.agent] || r.agent}</td>
                    <td>{link ? <Link to={link} className="agx__link">Open {r.subjectType}</Link> : r.subjectType}</td>
                    <td>{r.actorEmail}</td>
                    <td>
                      <span className={`agx__status agx__status--${r.status}`} title={r.error || ''}>{r.status}</span>
                    </td>
                    <td>{duration(r)}</td>
                    <td>{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AgentActivityPanel;
