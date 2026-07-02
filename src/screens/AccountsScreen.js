import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getObjectSchema, createAccount, listAccounts, deleteAccount } from '../firebase';
import './AccountsScreen.css';

const STATUS_OPTIONS = ['Active', 'Inactive'];

const EMPTY_FORM = {
  name: '',
  country: '',
  city: '',
  address: '',
  taxRegistrationNumber: '',
  abbreviation: '',
  registeredOffice: '',
  status: 'Active',
};

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="acc__chevron">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="acc__search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.5 16.5l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AccountsScreen() {
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCountry, setFilterCountry] = useState('');

  // Form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [customValues, setCustomValues] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSchema = async () => {
    try {
      setCustomFieldDefs(await getObjectSchema('account'));
    } catch (err) {
      console.error('Failed to load account schema:', err);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadSchema();
  }, []);

  // Unique countries from loaded accounts, for the country filter dropdown
  const countryOptions = useMemo(() => {
    const set = new Set(accounts.map((a) => a.country).filter(Boolean));
    return [...set].sort();
  }, [accounts]);

  // Filtered list — recalculated whenever search/filters or accounts change
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return accounts.filter((acc) => {
      if (filterStatus && acc.status !== filterStatus) return false;
      if (filterCountry && acc.country !== filterCountry) return false;
      if (q) {
        const haystack = [
          acc.name,
          acc.country,
          acc.city,
          acc.taxRegistrationNumber,
          acc.abbreviation,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, search, filterStatus, filterCountry]);

  const activeFilterCount = [filterStatus, filterCountry].filter(Boolean).length;

  const handleClearFilters = () => {
    setSearch('');
    setFilterStatus('');
    setFilterCountry('');
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCustomChange = (fieldId, value) => {
    setCustomValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleOpenCreate = () => {
    setForm(EMPTY_FORM);
    setCustomValues({});
    setError('');
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setCustomValues({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim() || !form.country.trim() || !form.city.trim() || !form.address.trim() || !form.taxRegistrationNumber.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    setSaving(true);
    try {
      await createAccount({ ...form, customFields: customValues });
      handleCloseForm();
      await loadAccounts();
    } catch (err) {
      console.error('Failed to save account:', err);
      setError('Something went wrong while saving the account.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete account "${account.name}"? This can't be undone.`)) return;
    try {
      await deleteAccount(account.id);
      await loadAccounts();
    } catch (err) {
      console.error('Failed to delete account:', err);
      alert('Could not delete the account. Please try again.');
    }
  };

  const renderCustomFieldInput = (field) => {
    const value = customValues[field.id] ?? '';
    if (field.type === 'dropdown') {
      return (
        <select className="acc__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)}>
          <option value="">— Select —</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (field.type === 'number') return <input type="number" className="acc__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    if (field.type === 'date') return <input type="date" className="acc__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    return <input type="text" className="acc__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
  };

  return (
    <div className="acc">
      <div className="acc__header">
        <h2 className="acc__title">Accounts</h2>
        <button className="acc__add-btn" onClick={handleOpenCreate}>+ Create account</button>
      </div>

      {/* Search + Filters */}
      <div className="acc__toolbar">
        <div className="acc__search-wrap">
          <SearchIcon />
          <input
            type="text"
            className="acc__search"
            placeholder="Search by name, country, city, tax ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="acc__search-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
          )}
        </div>

        <div className="acc__filters">
          <select
            className="acc__filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            className="acc__filter-select"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
          >
            <option value="">All countries</option>
            {countryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {(activeFilterCount > 0 || search) && (
            <button className="acc__filter-clear" onClick={handleClearFilters}>
              Clear all {activeFilterCount > 0 && `(${activeFilterCount})`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="acc__empty">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="acc__empty">No accounts yet. Create the first one.</p>
      ) : filtered.length === 0 ? (
        <p className="acc__empty">No accounts match your search or filters.</p>
      ) : (
        <div className="acc__table-wrap">
          <table className="acc__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>ID</th>
                <th>Tax ID</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => (
                <tr key={acc.id}>
                  <td className="acc__td-name">{acc.name}</td>
                  <td>{acc.country}</td>
                  <td className="acc__td-muted">{acc.abbreviation || '—'}</td>
                  <td className="acc__td-muted">{acc.taxRegistrationNumber || '—'}</td>
                  <td>
                    <span className={`acc__status ${acc.status === 'Inactive' ? 'acc__status--inactive' : 'acc__status--active'}`}>
                      {acc.status || 'Active'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="acc__detail-btn"
                      onClick={() => navigate(`/dashboard/accounts/${acc.id}`)}
                      aria-label="View details"
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

      {showForm && (
        <div className="acc__modal-backdrop" onClick={handleCloseForm}>
          <form className="acc__modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <div className="acc__modal-scroll">
              <h3 className="acc__modal-title">Create account</h3>

              {error && <p className="acc__error">{error}</p>}

              <div className="acc__form-grid">
                <div className="acc__field acc__field--full">
                  <label className="acc__label" htmlFor="name">Account name</label>
                  <input id="name" name="name" className="acc__input" value={form.name} onChange={handleChange} required />
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="country">Country</label>
                  <input id="country" name="country" className="acc__input" value={form.country} onChange={handleChange} required />
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="city">City</label>
                  <input id="city" name="city" className="acc__input" value={form.city} onChange={handleChange} required />
                </div>

                <div className="acc__field acc__field--full">
                  <label className="acc__label" htmlFor="address">Address</label>
                  <input id="address" name="address" className="acc__input" value={form.address} onChange={handleChange} required />
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="taxRegistrationNumber">Tax registration number</label>
                  <input id="taxRegistrationNumber" name="taxRegistrationNumber" className="acc__input" value={form.taxRegistrationNumber} onChange={handleChange} required />
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="status">Status</label>
                  <select id="status" name="status" className="acc__input" value={form.status} onChange={handleChange}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="abbreviation">
                    Abbreviation <span className="acc__label-hint">(optional)</span>
                  </label>
                  <input id="abbreviation" name="abbreviation" className="acc__input" value={form.abbreviation} onChange={handleChange} />
                </div>

                <div className="acc__field">
                  <label className="acc__label" htmlFor="registeredOffice">
                    Registered office <span className="acc__label-hint">(optional)</span>
                  </label>
                  <input id="registeredOffice" name="registeredOffice" className="acc__input" value={form.registeredOffice} onChange={handleChange} />
                </div>

                {customFieldDefs.map((field) => (
                  <div key={field.id} className="acc__field">
                    <label className="acc__label">{field.label}</label>
                    {renderCustomFieldInput(field)}
                  </div>
                ))}
              </div>
            </div>

            <div className="acc__modal-actions">
              <button type="button" className="acc__btn-secondary" onClick={handleCloseForm}>Cancel</button>
              <button type="submit" className="acc__btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Create account'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default AccountsScreen;