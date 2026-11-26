import { useEffect, useState } from 'react';
import { useConfirm } from './ConfirmProvider';
import {
  getSalesforceConnection,
  generateSalesforceCertificate,
  saveSalesforceConnection,
  testSalesforceConnection,
  disconnectSalesforce,
} from '../salesforceApi';
import NoticeModal from './NoticeModal';
import './SalesforceConnection.css';

const EMPTY_FORM = { environment: 'production', instanceUrl: '', clientId: '', username: '' };

const STATUS_LABELS = {
  not_connected: 'Not connected',
  pending: 'Setup in progress',
  connected: 'Connected',
  error: 'Connection error',
};

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

function downloadCertificate(pem) {
  const blob = new Blob([pem], { type: 'application/x-x509-ca-cert' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'esovia-salesforce.crt';
  a.click();
  URL.revokeObjectURL(url);
}

function SalesforceConnection() {
  const confirm = useConfirm();
  const [conn, setConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [notice, setNotice] = useState(null);

  const applyConnection = (data) => {
    setConn(data);
    if (data.configured) {
      setForm({
        environment: data.environment || 'production',
        instanceUrl: data.instanceUrl || '',
        clientId: data.clientId || '',
        username: data.username || '',
      });
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        applyConnection(await getSalesforceConnection());
      } catch (err) {
        console.error('Failed to load Salesforce connection:', err);
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleGenerate = async () => {
    if (conn?.hasCertificate && !(await confirm({
      title: 'Generate a new certificate',
      message: 'The certificate currently uploaded in Salesforce will stop working until you upload the new one.',
      confirmLabel: 'Generate',
      danger: true,
    }))) return;
    setBusy('generate');
    try {
      applyConnection(await generateSalesforceCertificate());
    } catch (err) {
      setNotice({ type: 'error', title: 'Could not generate the certificate', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const reportTest = (data, verb) => {
    if (data.test?.ok) {
      setNotice({
        type: 'success',
        title: verb === 'save' ? 'Salesforce connected' : 'Connection works',
        message: data.test.accountsVisible
          ? 'EsoVia can read your Salesforce accounts.'
          : 'Connected, but no accounts are visible yet. Check that the integration user can read Accounts (View All Records).',
      });
    } else {
      setNotice({ type: 'error', title: 'Could not connect to Salesforce', message: data.test?.error || 'Unknown error.' });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy('save');
    try {
      const data = await saveSalesforceConnection(form);
      applyConnection(data);
      reportTest(data, 'save');
    } catch (err) {
      setNotice({ type: 'error', title: 'Could not save the connection', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const handleTest = async () => {
    setBusy('test');
    try {
      const data = await testSalesforceConnection();
      applyConnection(data);
      reportTest(data, 'test');
    } catch (err) {
      setNotice({ type: 'error', title: 'Could not test the connection', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const handleDisconnect = async () => {
    if (!(await confirm({ title: 'Disconnect Salesforce', message: 'Syncing will stop until you connect it again.', confirmLabel: 'Disconnect', danger: true }))) return;
    setBusy('disconnect');
    try {
      applyConnection(await disconnectSalesforce());
      setForm(EMPTY_FORM);
    } catch (err) {
      setNotice({ type: 'error', title: 'Could not disconnect', message: err.message });
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="admin__panel"><p className="sfc__muted">Loading…</p></div>;
  if (loadError) return <div className="admin__panel"><p className="sfc__error">{loadError}</p></div>;

  const status = conn?.status || 'not_connected';

  return (
    <div className="admin__panel sfc">
      <div className="admin__panel-header">
        <div>
          <h2 className="admin__panel-title">Salesforce</h2>
          <p className="sfc__muted">Sync accounts from Salesforce and send contracts and documents back to it.</p>
        </div>
        <span className={`sfc__pill sfc__pill--${status}`}>{STATUS_LABELS[status] || status}</span>
      </div>

      {status === 'connected' && (
        <div className="sfc__connected">
          <div>
            <strong>{conn.username}</strong> on {conn.instanceUrl}
            <div className="sfc__muted">Last tested {formatDate(conn.lastTestedAt)}</div>
          </div>
          <div className="sfc__row">
            <button type="button" className="admin__btn-secondary" onClick={handleTest} disabled={!!busy}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            <button type="button" className="sfc__danger" onClick={handleDisconnect} disabled={!!busy}>Disconnect</button>
          </div>
        </div>
      )}

      {status === 'error' && conn?.lastError && (
        <div className="sfc__alert">
          <strong>Last test failed.</strong> {conn.lastError}
        </div>
      )}

      <div className="sfc__step">
        <div className="sfc__step-head"><span className="sfc__num">1</span><h3>Create your security certificate</h3></div>
        <p className="sfc__muted">
          EsoVia generates a key pair for your organization and keeps the private key encrypted. You only upload the
          public certificate to Salesforce, so you never handle a private key.
        </p>
        <div className="sfc__row">
          <button type="button" className="admin__btn-primary" onClick={handleGenerate} disabled={!!busy}>
            {busy === 'generate' ? 'Generating…' : conn?.hasCertificate ? 'Generate a new certificate' : 'Generate certificate'}
          </button>
          {conn?.certificatePem && (
            <button type="button" className="admin__btn-secondary" onClick={() => downloadCertificate(conn.certificatePem)}>
              Download certificate (.crt)
            </button>
          )}
        </div>
        {conn?.hasCertificate && (
          <p className="sfc__muted">Valid until {formatDate(conn.certificateExpiresAt)}.</p>
        )}
      </div>

      <div className="sfc__step">
        <div className="sfc__step-head"><span className="sfc__num">2</span><h3>Set up Salesforce</h3></div>
        <p className="sfc__muted">A Salesforce admin does this once, in Salesforce Setup.</p>
        <details className="sfc__guide">
          <summary>Show the setup steps</summary>
          <ol>
            <li>
              <strong>Create an integration user.</strong> Setup, then Users, then New User. User License <em>Salesforce</em>,
              Profile <em>Minimum Access - Salesforce</em>. Note its username.
            </li>
            <li>
              <strong>Create a permission set</strong> (Setup, then Permission Sets, then New) and assign it to that user:
              <ul>
                <li>System Permissions: enable <em>API Enabled</em>.</li>
                <li>Object Settings, Accounts: Read and View All Records, with Read on the fields.</li>
                <li>
                  Object Settings, Contracts: Read, Create, Edit and View All Records, with Edit on Contract Name, Contract
                  Start Date, Contract Term and Description.
                </li>
                <li>Optional: <em>Activate Contracts</em>, if you want Activated agreements to activate the Salesforce contract.</li>
              </ul>
            </li>
            <li>
              <strong>Create an External Client App.</strong> Setup, then External Client App Manager, then New:
              <ul>
                <li>Enable OAuth, callback URL <code>https://localhost/callback</code>.</li>
                <li>Scopes: <em>Manage user data via APIs (api)</em> and <em>Perform requests at any time (refresh_token, offline_access)</em>.</li>
                <li>Enable <em>JWT Bearer Flow</em> and upload the certificate you downloaded in step 1.</li>
                <li>Clear the "Require secret" options.</li>
                <li>
                  Policies tab, Edit: Permitted Users <em>Admin approved users are pre-authorized</em>, select your permission
                  set, and IP Relaxation <em>Relax IP restrictions</em>.
                </li>
                <li>Settings tab, OAuth Settings: copy the <strong>Consumer Key</strong>.</li>
              </ul>
            </li>
            <li>
              <strong>Find your My Domain URL</strong> in Setup, under My Domain (it ends in <code>.my.salesforce.com</code>).
            </li>
          </ol>
        </details>
      </div>

      <form className="sfc__step" onSubmit={handleSave}>
        <div className="sfc__step-head"><span className="sfc__num">3</span><h3>Connect</h3></div>
        <div className="sfc__grid">
          <label className="sfc__field">
            <span className="admin__label">Environment</span>
            <select name="environment" className="admin__input" value={form.environment} onChange={handleChange}>
              <option value="production">Production or Developer Edition</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </label>
          <label className="sfc__field">
            <span className="admin__label">Salesforce My Domain URL</span>
            <input
              name="instanceUrl"
              className="admin__input"
              placeholder="https://yourcompany.my.salesforce.com"
              value={form.instanceUrl}
              onChange={handleChange}
              required
            />
          </label>
          <label className="sfc__field">
            <span className="admin__label">Consumer Key</span>
            <input name="clientId" className="admin__input" value={form.clientId} onChange={handleChange} required autoComplete="off" />
          </label>
          <label className="sfc__field">
            <span className="admin__label">Integration username</span>
            <input
              name="username"
              className="admin__input"
              placeholder="integration@yourcompany.com"
              value={form.username}
              onChange={handleChange}
              required
            />
          </label>
        </div>
        <div className="sfc__row">
          <button type="submit" className="admin__btn-primary" disabled={!conn?.hasCertificate || !!busy}>
            {busy === 'save' ? 'Connecting…' : 'Save and test connection'}
          </button>
          {!conn?.hasCertificate && <span className="sfc__muted">Generate the certificate first.</span>}
          {status !== 'connected' && conn?.configured && (
            <button type="button" className="sfc__danger" onClick={handleDisconnect} disabled={!!busy}>Remove</button>
          )}
        </div>
      </form>

      <NoticeModal notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

export default SalesforceConnection;
