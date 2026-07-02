import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { listAgreements, listAllApprovalRequests, getBuiltInFieldConfigs } from '../firebase';
import './DashboardsScreen.css';

const DEFAULT_STATUS_ORDER = [
  'Draft', 'Generated', 'Import offline', 'In review', 'Reviewed',
  'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated',
];

const COLORS = ['#001272', '#3b5bfe', '#00b8a9', '#f6a723', '#ef5b5b', '#8e5cf7', '#2fb67c', '#ff8fa3', '#5c6bc0', '#9a9dae'];
const FUNNEL_COLORS = { Pending: '#f6a723', Approved: '#2fb67c', Rejected: '#ef5b5b' };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="dbd__kpi-icon">
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="dbd__kpi-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="dbd__kpi-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="dbd__kpi-icon">
      <path d="M12 3.5l9.5 16.5H2.5L12 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Firestore Timestamp ({seconds, nanoseconds}) or ISO string -> JS Date.
function toDate(value) {
  if (!value) return null;
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWithinPreset(date, preset, customFrom, customTo) {
  if (preset === 'all') return true;
  if (!date) return false;
  const now = new Date();
  if (preset === '30') {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    return date >= cutoff;
  }
  if (preset === '90') {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 90);
    return date >= cutoff;
  }
  if (preset === 'ytd') {
    return date >= new Date(now.getFullYear(), 0, 1);
  }
  if (preset === 'custom') {
    if (customFrom && date < new Date(customFrom)) return false;
    if (customTo && date > new Date(`${customTo}T23:59:59`)) return false;
    return true;
  }
  return true;
}

function groupCount(items, keyFn, fallbackLabel = 'Unspecified') {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || fallbackLabel;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function formatPeriodLabel(period, granularity) {
  if (granularity === 'year') return period;
  if (granularity === 'month') {
    const [y, m] = period.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return new Date(period).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

function buildTimeSeries(items, granularity) {
  const map = new Map();
  items.forEach((item) => {
    const d = toDate(item.createdAt);
    if (!d) return;
    let key;
    if (granularity === 'day') key = d.toISOString().slice(0, 10);
    else if (granularity === 'year') key = String(d.getFullYear());
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map, ([period, count]) => ({ period, label: formatPeriodLabel(period, granularity), count }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// Days between the first "Draft" entry and the last "Activated" entry in an
// agreement's statusHistory. Older agreements created before statusHistory
// existed fall back to createdAt -> updatedAt (only when already Activated),
// which is an approximation — flagged in the UI.
function computeTimeToContract(agreement) {
  const history = agreement.statusHistory || [];
  let draftDate = null;
  let activatedDate = null;

  const draftEntry = history.find((h) => h.status === 'Draft');
  const activatedEntry = [...history].reverse().find((h) => h.status === 'Activated');
  if (draftEntry) draftDate = toDate(draftEntry.changedAt);
  if (activatedEntry) activatedDate = toDate(activatedEntry.changedAt);

  let approximate = false;
  if (!draftDate && agreement.createdAt) {
    draftDate = toDate(agreement.createdAt);
    approximate = true;
  }
  if (!activatedDate && agreement.status === 'Activated' && agreement.updatedAt) {
    activatedDate = toDate(agreement.updatedAt);
    approximate = true;
  }

  if (!draftDate || !activatedDate || activatedDate < draftDate) return null;
  return { days: (activatedDate - draftDate) / MS_PER_DAY, approximate };
}

function DashboardsScreen() {
  const [loading, setLoading] = useState(true);
  const [agreements, setAgreements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [statusOrder, setStatusOrder] = useState(DEFAULT_STATUS_ORDER);

  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [granularity, setGranularity] = useState('month');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [agrs, apprs, configs] = await Promise.all([
          listAgreements(),
          listAllApprovalRequests(),
          getBuiltInFieldConfigs('agreement'),
        ]);
        setAgreements(agrs);
        setApprovals(apprs);
        if (configs.status?.length) setStatusOrder(configs.status);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const typeOptions = useMemo(
    () => Array.from(new Set(agreements.map((a) => a.agreementType).filter(Boolean))).sort(),
    [agreements]
  );
  const accountOptions = useMemo(
    () => Array.from(new Set(agreements.map((a) => a.accountName).filter(Boolean))).sort(),
    [agreements]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set([...statusOrder, ...agreements.map((a) => a.status).filter(Boolean)])),
    [statusOrder, agreements]
  );

  const filteredAgreements = useMemo(() => {
    return agreements.filter((a) => {
      const created = toDate(a.createdAt);
      if (!isWithinPreset(created, datePreset, customFrom, customTo)) return false;
      if (filterType && a.agreementType !== filterType) return false;
      if (filterAccount && a.accountName !== filterAccount) return false;
      if (filterStatus && a.status !== filterStatus) return false;
      return true;
    });
  }, [agreements, datePreset, customFrom, customTo, filterType, filterAccount, filterStatus]);

  const hasActiveFilters = datePreset !== 'all' || filterType || filterAccount || filterStatus;
  const resetFilters = () => {
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
    setFilterType('');
    setFilterAccount('');
    setFilterStatus('');
  };

  // ---- KPIs ----
  const totalCount = filteredAgreements.length;
  const activeCount = filteredAgreements.filter((a) => a.status === 'Activated').length;

  const expiringSoon = useMemo(() => {
    const now = new Date();
    return filteredAgreements
      .map((a) => {
        const end = a.endDate ? new Date(a.endDate) : null;
        if (!end) return null;
        const daysLeft = Math.round((end - now) / MS_PER_DAY);
        return { ...a, endDateObj: end, daysLeft };
      })
      .filter((a) => a && a.daysLeft >= 0 && a.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [filteredAgreements]);

  const timeToContractValues = useMemo(
    () => filteredAgreements.map((a) => ({ agreement: a, ttc: computeTimeToContract(a) })).filter((x) => x.ttc),
    [filteredAgreements]
  );
  const avgTimeToContract = timeToContractValues.length
    ? Math.round(timeToContractValues.reduce((sum, x) => sum + x.ttc.days, 0) / timeToContractValues.length)
    : null;
  const hasApproximateTtc = timeToContractValues.some((x) => x.ttc.approximate);

  // ---- Chart data ----
  const byType = useMemo(() => groupCount(filteredAgreements, (a) => a.agreementType), [filteredAgreements]);
  const bySubtype = useMemo(() => groupCount(filteredAgreements, (a) => a.agreementSubtype), [filteredAgreements]);

  const byAccountFull = useMemo(() => groupCount(filteredAgreements, (a) => a.accountName, 'No account'), [filteredAgreements]);
  const byAccount = useMemo(() => {
    const top = byAccountFull.slice(0, 8);
    const restTotal = byAccountFull.slice(8).reduce((sum, x) => sum + x.value, 0);
    return restTotal > 0 ? [...top, { name: 'Others', value: restTotal }] : top;
  }, [byAccountFull]);

  const byStatus = useMemo(() => {
    const counts = new Map();
    filteredAgreements.forEach((a) => counts.set(a.status || 'Unspecified', (counts.get(a.status || 'Unspecified') || 0) + 1));
    return statusOrder
      .filter((s) => counts.has(s))
      .map((s) => ({ name: s, value: counts.get(s) }))
      .concat(
        Array.from(counts.entries())
          .filter(([s]) => !statusOrder.includes(s))
          .map(([name, value]) => ({ name, value }))
      );
  }, [filteredAgreements, statusOrder]);

  const timeSeries = useMemo(() => buildTimeSeries(filteredAgreements, granularity), [filteredAgreements, granularity]);

  const byEndDate = useMemo(() => {
    const map = new Map();
    filteredAgreements.forEach((a) => {
      if (!a.endDate) return;
      const d = new Date(a.endDate);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map, ([period, count]) => ({ period, label: formatPeriodLabel(period, 'month'), count }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [filteredAgreements]);

  const ttcByType = useMemo(() => {
    const map = new Map();
    timeToContractValues.forEach(({ agreement, ttc }) => {
      const key = agreement.agreementType || 'Unspecified';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ttc.days);
    });
    return Array.from(map, ([name, values]) => ({
      name,
      value: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
    })).sort((a, b) => b.value - a.value);
  }, [timeToContractValues]);

  const approvalFunnel = useMemo(() => {
    const filteredIds = new Set(filteredAgreements.map((a) => a.id));
    const relevant = approvals.filter((r) => filteredIds.has(r.agreementId));
    const counts = { Pending: 0, Approved: 0, Rejected: 0 };
    relevant.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
    });
    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [approvals, filteredAgreements]);
  const totalApprovalsSent = approvalFunnel.reduce((s, x) => s + x.value, 0);

  if (loading) {
    return <div className="dbd__loading">Loading dashboards…</div>;
  }

  return (
    <div className="dbd">
      {/* Filters */}
      <div className="dbd__filters">
        <div className="dbd__filter-group">
          <span className="dbd__filter-label">Period</span>
          <div className="dbd__pill-group">
            {[
              { key: 'all', label: 'All time' },
              { key: '30', label: 'Last 30 days' },
              { key: '90', label: 'Last 90 days' },
              { key: 'ytd', label: 'This year' },
              { key: 'custom', label: 'Custom' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`dbd__pill ${datePreset === opt.key ? 'dbd__pill--active' : ''}`}
                onClick={() => setDatePreset(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {datePreset === 'custom' && (
          <div className="dbd__filter-group">
            <input type="date" className="dbd__date-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="dbd__date-sep">–</span>
            <input type="date" className="dbd__date-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}

        <div className="dbd__filter-group">
          <select className="dbd__select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="dbd__select" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accountOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="dbd__select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasActiveFilters && (
            <button type="button" className="dbd__reset-btn" onClick={resetFilters}>Reset filters</button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="dbd__kpi-row">
        <div className="dbd__kpi-card">
          <DocumentIcon />
          <div>
            <span className="dbd__kpi-value">{totalCount}</span>
            <span className="dbd__kpi-label">Agreements</span>
          </div>
        </div>
        <div className="dbd__kpi-card">
          <CheckIcon />
          <div>
            <span className="dbd__kpi-value">{activeCount}</span>
            <span className="dbd__kpi-label">Activated</span>
          </div>
        </div>
        <div className="dbd__kpi-card">
          <AlertIcon />
          <div>
            <span className="dbd__kpi-value">{expiringSoon.length}</span>
            <span className="dbd__kpi-label">Expiring in 90 days</span>
          </div>
        </div>
        <div className="dbd__kpi-card">
          <ClockIcon />
          <div>
            <span className="dbd__kpi-value">{avgTimeToContract !== null ? `${avgTimeToContract}d` : '—'}</span>
            <span className="dbd__kpi-label">Avg. time to contract{hasApproximateTtc ? '*' : ''}</span>
          </div>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="dbd__empty-state">No agreements match the current filters.</div>
      ) : (
        <div className="dbd__grid">
          {/* Agreements over time */}
          <div className="dbd__card dbd__card--full">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">Agreements created over time</h3>
              <div className="dbd__pill-group dbd__pill-group--sm">
                {['day', 'month', 'year'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`dbd__pill dbd__pill--sm ${granularity === g ? 'dbd__pill--active' : ''}`}
                    onClick={() => setGranularity(g)}
                  >
                    {g === 'day' ? 'Day' : g === 'month' ? 'Month' : 'Year'}
                  </button>
                ))}
              </div>
            </div>
            {timeSeries.length === 0 ? (
              <p className="dbd__chart-empty">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={timeSeries} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" name="Agreements" stroke="#001272" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* By type */}
          <div className="dbd__card">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">By agreement type</h3>
            </div>
            {byType.length === 0 ? <p className="dbd__chart-empty">No data.</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byType} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b6f86' }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Bar dataKey="value" name="Agreements" radius={[6, 6, 0, 0]}>
                    {byType.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* By subtype */}
          <div className="dbd__card">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">By agreement subtype</h3>
            </div>
            {bySubtype.length === 0 ? <p className="dbd__chart-empty">No data.</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={bySubtype} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b6f86' }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Bar dataKey="value" name="Agreements" radius={[6, 6, 0, 0]}>
                    {bySubtype.map((entry, index) => <Cell key={entry.name} fill={COLORS[(index + 3) % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* By account */}
          <div className="dbd__card dbd__card--full">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">By account {byAccountFull.length > 8 ? '(top 8)' : ''}</h3>
            </div>
            {byAccount.length === 0 ? <p className="dbd__chart-empty">No data.</p> : (
              <ResponsiveContainer width="100%" height={Math.max(220, byAccount.length * 34)}>
                <BarChart data={byAccount} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Bar dataKey="value" name="Agreements" fill="#001272" radius={[0, 6, 6, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* By status */}
          <div className="dbd__card dbd__card--full">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">By status</h3>
            </div>
            {byStatus.length === 0 ? <p className="dbd__chart-empty">No data.</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byStatus} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b6f86' }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Bar dataKey="value" name="Agreements" radius={[6, 6, 0, 0]}>
                    {byStatus.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Upcoming expirations */}
          <div className="dbd__card dbd__card--full">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">Upcoming expirations (by end date)</h3>
            </div>
            <div className="dbd__split">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byEndDate} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                  <Bar dataKey="count" name="Ending" fill="#ef5b5b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="dbd__expiring-list">
                <span className="dbd__expiring-title">Next 90 days</span>
                {expiringSoon.length === 0 ? (
                  <p className="dbd__chart-empty">Nothing expiring soon.</p>
                ) : (
                  expiringSoon.slice(0, 6).map((a) => (
                    <div key={a.id} className="dbd__expiring-row">
                      <span className="dbd__expiring-name">{a.title}</span>
                      <span className={`dbd__expiring-days ${a.daysLeft <= 30 ? 'dbd__expiring-days--urgent' : ''}`}>
                        {a.daysLeft === 0 ? 'Today' : `${a.daysLeft}d`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Time to contract */}
          <div className="dbd__card">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">Time to contract by type</h3>
            </div>
            {ttcByType.length === 0 ? (
              <p className="dbd__chart-empty">Not enough data yet — needs agreements that reached "Activated".</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ttcByType} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b6f86' }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6f86' }} unit="d" />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} formatter={(v) => [`${v} days`, 'Avg. time']} />
                  <Bar dataKey="value" name="Avg. days" fill="#00b8a9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            {hasApproximateTtc && (
              <p className="dbd__footnote">*Some values are approximate — older agreements created before status history tracking use createdAt/updatedAt as a stand-in.</p>
            )}
          </div>

          {/* Approval funnel */}
          <div className="dbd__card">
            <div className="dbd__card-header">
              <h3 className="dbd__card-title">Approval funnel</h3>
            </div>
            {totalApprovalsSent === 0 ? (
              <p className="dbd__chart-empty">No approval requests sent yet.</p>
            ) : (
              <div className="dbd__donut-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={approvalFunnel} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                      {approvalFunnel.map((entry) => (
                        <Cell key={entry.name} fill={FUNNEL_COLORS[entry.name] || '#9a9dae'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7f0', fontSize: 12 }} />
                    <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dbd__donut-center">
                  <span className="dbd__donut-value">{totalApprovalsSent}</span>
                  <span className="dbd__donut-label">sent</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardsScreen;