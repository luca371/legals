import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getAccount,
  updateAccount,
  deleteAccount,
  listAgreementsByAccount,
  getObjectSchema,
  listPlaybooks,
  listAssignedPlaybookIds,
  setAccountPlaybooks,
} from '../supabase';
import { indexObject } from '../embeddingsApi';
import './AccountDetailScreen.css';

const STATUS_OPTIONS = ['Active', 'Inactive'];

function BackIcon() {
  return (
    <svg className="accd__back-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="accd__chevron">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccountDetailScreen() {
  const { accountId } = useParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('info');

  const [account, setAccount] = useState(null);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [agreements, setAgreements] = useState([]);
  const [loadingAgreements, setLoadingAgreements] = useState(true);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [customValues, setCustomValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [allPlaybooks, setAllPlaybooks] = useState([]);
  const [assignedPlaybookIds, setAssignedPlaybookIds] = useState([]);
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(true);
  const [savingPlaybooks, setSavingPlaybooks] = useState(false);
  const [playbookError, setPlaybookError] = useState('');
  const [playbooksSaved, setPlaybooksSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const acc = await getAccount(accountId);
      setAccount(acc);
    } catch (err) {
      console.error('Failed to load account:', err);
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const schema = await getObjectSchema('account');
      setCustomFieldDefs(schema);
    } catch (err) {
      console.error('Failed to load account custom fields (non-blocking):', err);
      setCustomFieldDefs([]);
    }
    setLoading(false);
  };

  const loadAgreements = async () => {
    setLoadingAgreements(true);
    try {
      setAgreements(await listAgreementsByAccount(accountId));
    } catch (err) {
      console.error('Failed to load agreements:', err);
    } finally {
      setLoadingAgreements(false);
    }
  };

  const loadPlaybooks = async () => {
    setLoadingPlaybooks(true);
    try {
      const [all, assigned] = await Promise.all([listPlaybooks(), listAssignedPlaybookIds(accountId)]);
      setAllPlaybooks(all);
      setAssignedPlaybookIds(assigned);
    } catch (err) {
      console.error('Failed to load playbooks:', err);
    } finally {
      setLoadingPlaybooks(false);
    }
  };

  useEffect(() => {
    if (!accountId) return;
    load();
    loadAgreements();
    loadPlaybooks();
  }, [accountId]);

  const handleStartEdit = () => {
    setForm({
      name: account.name || '',
      country: account.country || '',
      city: account.city || '',
      address: account.address || '',
      taxRegistrationNumber: account.taxRegistrationNumber || '',
      abbreviation: account.abbreviation || '',
      registeredOffice: account.registeredOffice || '',
      status: account.status || 'Active',
    });
    setCustomValues(account.customFields || {});
    setError('');
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setForm(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCustomChange = (fieldId, value) => {
    setCustomValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.country.trim() || !form.city.trim() || !form.address.trim() || !form.taxRegistrationNumber.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    try {
      await updateAccount(accountId, { ...form, customFields: customValues });
      indexObject('account', accountId).catch((err) => console.warn('Background indexing failed:', err));
      setEditing(false);
      await load();
    } catch (err) {
      console.error('Failed to save account:', err);
      setError('Something went wrong while saving the account.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete account "${account.name}"? This can't be undone.`)) return;
    try {
      await deleteAccount(accountId);
      navigate('/dashboard/accounts');
    } catch (err) {
      console.error('Failed to delete account:', err);
      alert('Could not delete the account. Please try again.');
    }
  };

  const togglePlaybookAssigned = (id) => {
    setAssignedPlaybookIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setPlaybooksSaved(false);
  };

  const handleSavePlaybookAssignments = async () => {
    setSavingPlaybooks(true);
    setPlaybookError('');
    try {
      await setAccountPlaybooks(accountId, assignedPlaybookIds);
      setPlaybooksSaved(true);
    } catch (err) {
      console.error('Failed to save playbook assignments:', err);
      setPlaybookError('Could not save. Please try again.');
    } finally {
      setSavingPlaybooks(false);
    }
  };

  const renderCustomFieldInput = (field) => {
    const value = customValues[field.id] ?? '';
    if (field.type === 'dropdown') {
      return (
        <select className="accd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)}>
          <option value="">— Select —</option>
          {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (field.type === 'number') return <input type="number" className="accd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    if (field.type === 'date') return <input type="date" className="accd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    return <input type="text" className="accd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
  };

  if (loading) return <p className="accd__empty">Loading…</p>;

  if (notFound) {
    return (
      <div className="accd">
        <button className="accd__back" onClick={() => navigate('/dashboard/accounts')}>
          <BackIcon /> Back to accounts
        </button>
        <p className="accd__empty">This account doesn't exist or was deleted.</p>
      </div>
    );
  }

  return (
    <div className="accd">
      <button className="accd__back" onClick={() => navigate('/dashboard/accounts')}>
        <BackIcon /> Back to accounts
      </button>

      <div className="accd__card">
        <div className="accd__tab-bar">
          <div className="accd__tabs">
            <button
              className={`accd__tab ${activeTab === 'info' ? 'accd__tab--active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              Account information
            </button>
            <button
              className={`accd__tab ${activeTab === 'agreements' ? 'accd__tab--active' : ''}`}
              onClick={() => setActiveTab('agreements')}
            >
              Account's agreements
              {agreements.length > 0 && (
                <span className="accd__tab-badge">{agreements.length}</span>
              )}
            </button>
            <button
              className={`accd__tab ${activeTab === 'playbook' ? 'accd__tab--active' : ''}`}
              onClick={() => setActiveTab('playbook')}
            >
              Playbook
            </button>
          </div>

          <div className="accd__top-actions">
            <button className="accd__btn-create-agreement" onClick={() => {}}>
              + Create an agreement
            </button>
            {!editing && activeTab === 'info' && (
              <>
                <button className="accd__btn-secondary" onClick={handleStartEdit}>Edit</button>
                <button className="accd__btn-danger" onClick={handleDelete}>Delete</button>
              </>
            )}
          </div>
        </div>

        <div className="accd__tab-content">

          {activeTab === 'info' && (
            <>
              {!editing ? (
                <div className="accd__view-grid">
                  <div className="accd__view-field">
                    <span className="accd__view-label">Account name</span>
                    <span className="accd__view-value">{account.name}</span>
                  </div>
                  <div className="accd__view-field">
                    <span className="accd__view-label">Status</span>
                    <span className={`accd__status ${account.status === 'Inactive' ? 'accd__status--inactive' : 'accd__status--active'}`}>
                      {account.status || 'Active'}
                    </span>
                  </div>
                  <div className="accd__view-field">
                    <span className="accd__view-label">Country</span>
                    <span className="accd__view-value">{account.country}</span>
                  </div>
                  <div className="accd__view-field">
                    <span className="accd__view-label">City</span>
                    <span className="accd__view-value">{account.city}</span>
                  </div>
                  <div className="accd__view-field accd__view-field--full">
                    <span className="accd__view-label">Address</span>
                    <span className="accd__view-value">{account.address}</span>
                  </div>
                  <div className="accd__view-field">
                    <span className="accd__view-label">Tax registration number</span>
                    <span className="accd__view-value">{account.taxRegistrationNumber}</span>
                  </div>
                  <div className="accd__view-field">
                    <span className="accd__view-label">Abbreviation</span>
                    <span className="accd__view-value">{account.abbreviation || '—'}</span>
                  </div>
                  <div className="accd__view-field accd__view-field--full">
                    <span className="accd__view-label">Registered office</span>
                    <span className="accd__view-value">{account.registeredOffice || '—'}</span>
                  </div>
                  {customFieldDefs.map((field) => (
                    <div key={field.id} className="accd__view-field">
                      <span className="accd__view-label">{field.label}</span>
                      <span className="accd__view-value">{(account.customFields || {})[field.id] || '—'}</span>
                    </div>
                  ))}
                  <div className="accd__view-field accd__view-field--full">
                    <span className="accd__view-label">Created by</span>
                    <span className="accd__view-value">{account.createdBy || 'Unknown'}</span>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSave}>
                  {error && <p className="accd__error">{error}</p>}
                  <div className="accd__form-grid">
                    <div className="accd__field accd__field--full">
                      <label className="accd__label" htmlFor="name">Account name</label>
                      <input id="name" name="name" className="accd__input" value={form.name} onChange={handleChange} required />
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="country">Country</label>
                      <input id="country" name="country" className="accd__input" value={form.country} onChange={handleChange} required />
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="city">City</label>
                      <input id="city" name="city" className="accd__input" value={form.city} onChange={handleChange} required />
                    </div>
                    <div className="accd__field accd__field--full">
                      <label className="accd__label" htmlFor="address">Address</label>
                      <input id="address" name="address" className="accd__input" value={form.address} onChange={handleChange} required />
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="taxRegistrationNumber">Tax registration number</label>
                      <input id="taxRegistrationNumber" name="taxRegistrationNumber" className="accd__input" value={form.taxRegistrationNumber} onChange={handleChange} required />
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="status">Status</label>
                      <select id="status" name="status" className="accd__input" value={form.status} onChange={handleChange}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="abbreviation">
                        Abbreviation <span className="accd__label-hint">(optional)</span>
                      </label>
                      <input id="abbreviation" name="abbreviation" className="accd__input" value={form.abbreviation} onChange={handleChange} />
                    </div>
                    <div className="accd__field">
                      <label className="accd__label" htmlFor="registeredOffice">
                        Registered office <span className="accd__label-hint">(optional)</span>
                      </label>
                      <input id="registeredOffice" name="registeredOffice" className="accd__input" value={form.registeredOffice} onChange={handleChange} />
                    </div>
                    {customFieldDefs.map((field) => (
                      <div key={field.id} className="accd__field">
                        <label className="accd__label">{field.label}</label>
                        {renderCustomFieldInput(field)}
                      </div>
                    ))}
                  </div>
                  <div className="accd__form-actions">
                    <button type="button" className="accd__btn-secondary" onClick={handleCancelEdit}>Cancel</button>
                    <button type="submit" className="accd__btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {activeTab === 'agreements' && (
            <>
              {loadingAgreements ? (
                <p className="accd__empty">Loading…</p>
              ) : agreements.length === 0 ? (
                <div className="accd__agreements-empty">
                  <p>No agreements linked to this account yet.</p>
                  <button className="accd__btn-create-agreement" onClick={() => {}}>
                    + Create an agreement
                  </button>
                </div>
              ) : (
                <div className="accd__agreements-table-wrap">
                  <table className="accd__agreements-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Effective date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {agreements.map((agr) => (
                        <tr key={agr.id}>
                          <td className="accd__agr-title">{agr.title || '—'}</td>
                          <td>{agr.agreementType || '—'}</td>
                          <td>
                            <span className={`accd__agr-status accd__agr-status--${(agr.status || 'draft').toLowerCase().replace(' ', '-')}`}>
                              {agr.status || 'Draft'}
                            </span>
                          </td>
                          <td className="accd__agr-date">{agr.effectiveDate || '—'}</td>
                          <td>
                            <button
                              className="accd__agr-link"
                              onClick={() => navigate(`/dashboard/agreements/${agr.id}`)}
                              aria-label="View agreement"
                            >
                              <ChevronIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'playbook' && (
            <div className="accd__playbook">
              <div className="accd__playbook-header">
                <p className="accd__playbook-hint">
                  Playbooks are created once for the whole organization — pick below which ones apply to this
                  client. When reviewing one of its agreements with AI, the reviewer can narrow it down further to
                  just the playbooks relevant for that specific contract.
                </p>
                <button type="button" className="accd__btn-secondary" onClick={() => navigate('/dashboard/settings')}>
                  Manage playbooks
                </button>
              </div>

              {playbookError && <p className="accd__error">{playbookError}</p>}

              {loadingPlaybooks ? (
                <p className="accd__empty">Loading…</p>
              ) : allPlaybooks.length === 0 ? (
                <p className="accd__empty">
                  No playbooks exist yet for your organization — create one from Settings first.
                </p>
              ) : (
                <>
                  <div className="accd__playbook-assign-list">
                    {allPlaybooks.map((pb) => (
                      <label key={pb.id} className="accd__playbook-assign-row">
                        <input
                          type="checkbox"
                          checked={assignedPlaybookIds.includes(pb.id)}
                          onChange={() => togglePlaybookAssigned(pb.id)}
                        />
                        <div>
                          <span className="accd__playbook-card-title">{pb.title}</span>
                          <p className="accd__playbook-card-body">{pb.body}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="accd__playbook-actions">
                    {playbooksSaved && <span className="accd__playbook-saved">✓ Saved</span>}
                    <button
                      type="button"
                      className="accd__btn-primary"
                      onClick={handleSavePlaybookAssignments}
                      disabled={savingPlaybooks}
                    >
                      {savingPlaybooks ? 'Saving…' : 'Save assignments'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default AccountDetailScreen;