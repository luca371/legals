import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import {
  db,
  createUserAsAdmin,
  updateUserProfile,
  sendInviteEmail,
  setUserActive,
  softDeleteUser,
  OBJECT_TYPES,
  getObjectSchema,
  addCustomField,
  removeCustomField,
  getBuiltInFieldConfigs,
  updateBuiltInFieldConfig,
  getTypeSubtypeMap,
  updateTypeSubtypeMap,
} from '../firebase';
import './AdminScreen.css';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  role: '',
  department: '',
  employeeId: '',
  password: '',
};

const BUILT_IN_FIELDS = {
  account: [
    { label: 'Account name', type: 'Text' },
    { label: 'Industry', type: 'Text' },
    { label: 'Owner', type: 'Text' },
  ],
  agreement: [
    { key: 'status', label: 'Status', type: 'Dropdown', configurable: true, defaultOptions: ['Draft', 'Generated', 'Import offline', 'In review', 'Reviewed', 'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated'] },
    { key: 'agreementType', label: 'Agreement type', type: 'Dropdown', configurable: true, defaultOptions: [] },
    { key: 'agreementSubtype', label: 'Agreement subtype', type: 'Dropdown', configurable: true, defaultOptions: [] },
    { key: 'agreementTypeSubtypeMap', label: 'Type → Subtype mapping', type: 'Mapping', configurable: true, isMap: true },
    { label: 'Account', type: 'Lookup to Account' },
    { label: 'Effective date', type: 'Date' },
    { label: 'End date', type: 'Date' },
  ],
  template: [
    { label: 'Template name', type: 'Text' },
    { label: 'Agreement type', type: 'Text' },
    { label: 'Agreement subtype', type: 'Text' },
    { label: 'Language', type: 'Dropdown (English, Romanian, French, German, Spanish)' },
    { label: 'Document content', type: 'Rich text (uploaded from Word)' },
  ],
};

const OBJECT_LABELS = { account: 'Account', agreement: 'Agreement', template: 'Template' };

const OBJECT_ICONS = {
  account: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c0-3.6 3.13-6 7-6s7 2.4 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  agreement: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  template: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9h17" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 9v11" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
};

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'lookup', label: 'Lookup' },
];

function generateTempPassword() {
  return Math.random().toString(36).slice(-8) + 'A1!';
}

function fieldTypeDisplay(f) {
  if (f.type === 'dropdown') return `Dropdown (${(f.options || []).join(', ')})`;
  if (f.type === 'lookup') return `Lookup to ${OBJECT_LABELS[f.lookupTarget] || '—'}`;
  return FIELD_TYPES.find((t) => t.value === f.type)?.label || f.type;
}

function AdminScreen() {
  const [tab, setTab] = useState('users');

  // ---- Users state ----
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  // ---- Objects state ----
  const [objectType, setObjectType] = useState('account');
  const [customFields, setCustomFields] = useState([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [builtInConfigs, setBuiltInConfigs] = useState({});
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [fieldForm, setFieldForm] = useState({ label: '', type: 'text', lookupTarget: 'account' });
  const [dropdownOptions, setDropdownOptions] = useState(['']);
  const [fieldError, setFieldError] = useState('');
  const [savingField, setSavingField] = useState(false);

  // ---- Built-in edit state ----
  const [editingBuiltIn, setEditingBuiltIn] = useState(null);
  const [builtInOptions, setBuiltInOptions] = useState(['']);
  const [savingBuiltIn, setSavingBuiltIn] = useState(false);

  // ---- Type→Subtype map state ----
  const [showMapModal, setShowMapModal] = useState(false);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});
  const [savingMap, setSavingMap] = useState(false);

  const isEditMode = editingUser !== null;

  // ---------- Users ----------
  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.isDeleted));
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (tab === 'users') loadUsers();
  }, [tab]);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null);
    };
    const handleClose = () => setOpenMenu(null);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [openMenu]);

  const handleToggleMenu = (e, targetUser) => {
    e.stopPropagation();
    if (openMenu?.user.id === targetUser.id) { setOpenMenu(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenMenu({ user: targetUser, top: rect.bottom + 6, left: rect.right - 200 });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleOpenAddForm = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  };

  const handleOpenEditForm = (targetUser) => {
    setOpenMenu(null);
    setEditingUser(targetUser);
    setForm({
      firstName: targetUser.firstName || '',
      lastName: targetUser.lastName || '',
      email: targetUser.email || '',
      role: targetUser.role || '',
      department: targetUser.department || '',
      employeeId: targetUser.employeeId || '',
      password: '',
    });
    setError('');
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (isEditMode) {
        await updateUserProfile(editingUser.id, form);
        setSuccessMsg(`${form.firstName} ${form.lastName} was updated.`);
      } else {
        const password = form.password || generateTempPassword();
        await createUserAsAdmin({ ...form, password });
        await sendInviteEmail(form.email);
        setSuccessMsg(`${form.firstName} ${form.lastName} was added and received an invite email.`);
      }
      handleCloseForm();
      await loadUsers();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error('Save user failed:', err);
      setError(mapCreateUserError(err.code) || 'Something went wrong while saving the user.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (targetUser) => {
    setOpenMenu(null);
    try {
      await sendInviteEmail(targetUser.email);
      setSuccessMsg(`Password reset email sent to ${targetUser.email}.`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      alert('Could not send the reset email. Please try again.');
    }
  };

  const handleToggleActive = async (targetUser) => {
    setOpenMenu(null);
    const nextActive = targetUser.isActive === false;
    const confirmMsg = nextActive
      ? `Reactivate ${targetUser.firstName} ${targetUser.lastName}?`
      : `Deactivate ${targetUser.firstName} ${targetUser.lastName}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await setUserActive(targetUser.id, nextActive);
      await loadUsers();
    } catch (err) {
      alert('Could not update the user. Please try again.');
    }
  };

  const handleDeleteUser = async (targetUser) => {
    setOpenMenu(null);
    if (!window.confirm(`Delete ${targetUser.firstName} ${targetUser.lastName}?`)) return;
    try {
      await softDeleteUser(targetUser.id);
      await loadUsers();
    } catch (err) {
      alert('Could not delete the user. Please try again.');
    }
  };

  // ---------- Objects ----------
  const loadFields = async (type) => {
    setLoadingFields(true);
    try {
      const [fields, configs, map] = await Promise.all([
        getObjectSchema(type),
        getBuiltInFieldConfigs(type),
        type === 'agreement' ? getTypeSubtypeMap() : Promise.resolve({}),
      ]);
      setCustomFields(fields);
      setBuiltInConfigs(configs);
      setTypeSubtypeMap(map);
    } catch (err) {
      console.error('Failed to load object schema:', err);
    } finally {
      setLoadingFields(false);
    }
  };

  useEffect(() => {
    if (tab === 'objects') loadFields(objectType);
  }, [tab, objectType]);

  const handleOpenFieldForm = () => {
    setFieldForm({ label: '', type: 'text', lookupTarget: OBJECT_TYPES.find((t) => t !== objectType) || 'account' });
    setDropdownOptions(['']);
    setFieldError('');
    setShowFieldForm(true);
  };

  const handleFieldFormChange = (e) => {
    const { name, value } = e.target;
    setFieldForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleOptionChange = (index, value) => setDropdownOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  const handleAddOption = () => setDropdownOptions((prev) => [...prev, '']);
  const handleRemoveOption = (index) => setDropdownOptions((prev) => prev.filter((_, i) => i !== index));

  const handleSaveField = async (e) => {
    e.preventDefault();
    setFieldError('');
    if (!fieldForm.label.trim()) { setFieldError('Field name is required.'); return; }

    let options = null;
    if (fieldForm.type === 'dropdown') {
      options = dropdownOptions.map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) { setFieldError('Add at least 2 options for a dropdown field.'); return; }
    }

    setSavingField(true);
    try {
      await addCustomField(objectType, {
        label: fieldForm.label.trim(),
        type: fieldForm.type,
        options,
        lookupTarget: fieldForm.type === 'lookup' ? fieldForm.lookupTarget : null,
      });
      setShowFieldForm(false);
      await loadFields(objectType);
    } catch (err) {
      setFieldError('Something went wrong while saving the field.');
    } finally {
      setSavingField(false);
    }
  };

  const handleRemoveField = async (field) => {
    if (!window.confirm(`Remove the "${field.label}" field from ${OBJECT_LABELS[objectType]}?`)) return;
    try {
      await removeCustomField(objectType, field.id);
      await loadFields(objectType);
    } catch (err) {
      alert('Could not remove the field. Please try again.');
    }
  };

  // ---------- Built-in field edit ----------
  const handleOpenBuiltInEdit = (field) => {
    if (field.isMap) {
      setShowMapModal(true);
      return;
    }
    const currentOptions = builtInConfigs[field.key] ?? field.defaultOptions ?? [];
    setEditingBuiltIn(field);
    setBuiltInOptions(currentOptions.length > 0 ? currentOptions : ['']);
  };

  const handleBuiltInOptionChange = (index, value) => setBuiltInOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  const handleAddBuiltInOption = () => setBuiltInOptions((prev) => [...prev, '']);
  const handleRemoveBuiltInOption = (index) => setBuiltInOptions((prev) => prev.filter((_, i) => i !== index));

  const handleSaveBuiltIn = async () => {
    const options = builtInOptions.map((o) => o.trim()).filter(Boolean);
    if (options.length < 1) return;
    setSavingBuiltIn(true);
    try {
      await updateBuiltInFieldConfig(objectType, editingBuiltIn.key, options);
      setEditingBuiltIn(null);
      await loadFields(objectType);
    } catch (err) {
      console.error('Save built-in config failed:', err);
    } finally {
      setSavingBuiltIn(false);
    }
  };

  const getBuiltInTypeLabel = (field) => {
    if (!field.configurable) return field.type;
    if (field.isMap) {
      const count = Object.values(typeSubtypeMap).reduce((acc, arr) => acc + arr.length, 0);
      return count > 0 ? `${Object.keys(typeSubtypeMap).length} types configured` : 'Not configured';
    }
    const opts = builtInConfigs[field.key] ?? field.defaultOptions ?? [];
    return opts.length > 0 ? `Dropdown (${opts.join(', ')})` : 'Dropdown (not configured)';
  };

  // ---------- Type→Subtype map ----------
  const handleMapSubtypeChange = (type, index, value) => {
    setTypeSubtypeMap((prev) => {
      const current = [...(prev[type] || [])];
      current[index] = value;
      return { ...prev, [type]: current };
    });
  };

  const handleAddMapSubtype = (type) => {
    setTypeSubtypeMap((prev) => ({
      ...prev,
      [type]: [...(prev[type] || []), ''],
    }));
  };

  const handleRemoveMapSubtype = (type, index) => {
    setTypeSubtypeMap((prev) => {
      const current = (prev[type] || []).filter((_, i) => i !== index);
      return { ...prev, [type]: current };
    });
  };

  const handleSaveMap = async () => {
    setSavingMap(true);
    try {
      const cleaned = {};
      Object.entries(typeSubtypeMap).forEach(([type, subs]) => {
        const filtered = subs.map((s) => s.trim()).filter(Boolean);
        if (filtered.length > 0) cleaned[type] = filtered;
      });
      await updateTypeSubtypeMap(cleaned);
      setShowMapModal(false);
      await loadFields(objectType);
    } catch (err) {
      console.error('Failed to save map:', err);
    } finally {
      setSavingMap(false);
    }
  };

  const configuredTypes = builtInConfigs.agreementType || [];

  return (
    <div className="admin">
      <div className="admin__tabs">
        <button className={`admin__tab ${tab === 'users' ? 'admin__tab--active' : ''}`} onClick={() => setTab('users')}>Users</button>
        <button className={`admin__tab ${tab === 'objects' ? 'admin__tab--active' : ''}`} onClick={() => setTab('objects')}>Objects</button>
      </div>

      {successMsg && <div className="admin__toast">{successMsg}</div>}

      {/* ---- Users tab ---- */}
      {tab === 'users' && (
        <div className="admin__panel">
          <div className="admin__panel-header">
            <h2 className="admin__panel-title">Users</h2>
            <button className="admin__add-btn" onClick={handleOpenAddForm}>+ Add user</button>
          </div>

          {loadingUsers ? (
            <p className="admin__empty">Loading…</p>
          ) : users.length === 0 ? (
            <p className="admin__empty">No users yet. Add the first one.</p>
          ) : (
            <div className="admin__table-wrap">
              <table className="admin__table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>ID</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.firstName} {u.lastName}</td>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td>{u.department || '—'}</td>
                      <td>{u.employeeId || '—'}</td>
                      <td>
                        <span className={`admin__status ${u.isActive === false ? 'admin__status--inactive' : 'admin__status--active'}`}>
                          {u.isActive === false ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td className="admin__actions-cell">
                        <button className="admin__dots-btn" onClick={(e) => handleToggleMenu(e, u)} aria-label="User actions">⋯</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- Objects tab ---- */}
      {tab === 'objects' && (
        <div className="admin__objects">
          <div className="admin__object-cards">
            {OBJECT_TYPES.map((type) => (
              <button
                key={type}
                className={`admin__object-card ${objectType === type ? 'admin__object-card--active' : ''}`}
                onClick={() => setObjectType(type)}
              >
                <span className="admin__object-card-icon">{OBJECT_ICONS[type]}</span>
                <span className="admin__object-card-label">{OBJECT_LABELS[type]}</span>
              </button>
            ))}
          </div>

          <div className="admin__panel admin__panel--objects">
            <div className="admin__fields-section">
              <h3 className="admin__fields-subtitle">Built-in fields</h3>
              <ul className="admin__fields-list admin__fields-list--builtin">
                {BUILT_IN_FIELDS[objectType].map((f) => (
                  <li key={f.label} className="admin__field-row">
                    <span className="admin__field-label">{f.label}</span>
                    <span className="admin__field-type admin__field-type--builtin">{getBuiltInTypeLabel(f)}</span>
                    {f.configurable && (
                      <button className="admin__field-edit" onClick={() => handleOpenBuiltInEdit(f)}>
                        {f.isMap ? 'Configure' : 'Edit options'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="admin__fields-section">
              <div className="admin__fields-header">
                <h3 className="admin__fields-subtitle">Custom fields</h3>
                <button className="admin__add-btn admin__add-btn--small" onClick={handleOpenFieldForm}>+ Add field</button>
              </div>

              {loadingFields ? (
                <p className="admin__empty">Loading…</p>
              ) : customFields.length === 0 ? (
                <p className="admin__empty">No custom fields yet for {OBJECT_LABELS[objectType]}.</p>
              ) : (
                <ul className="admin__fields-list">
                  {customFields.map((f) => (
                    <li key={f.id} className="admin__field-row">
                      <span className="admin__field-label">{f.label}</span>
                      <span className="admin__field-type">{fieldTypeDisplay(f)}</span>
                      <button className="admin__field-remove" onClick={() => handleRemoveField(f)} aria-label="Remove field">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User actions menu portal */}
      {openMenu && createPortal(
        <div className="admin__menu" ref={menuRef} style={{ top: openMenu.top, left: Math.max(openMenu.left, 8) }}>
          <button className="admin__menu-item" onClick={() => handleOpenEditForm(openMenu.user)}>Edit user</button>
          <button className="admin__menu-item" onClick={() => handleResetPassword(openMenu.user)}>Reset password for this user</button>
          <button className="admin__menu-item" onClick={() => handleToggleActive(openMenu.user)}>
            {openMenu.user.isActive === false ? 'Activate user' : 'Deactivate user'}
          </button>
          <button className="admin__menu-item admin__menu-item--danger" onClick={() => handleDeleteUser(openMenu.user)}>Delete user</button>
        </div>,
        document.body
      )}

      {/* Add/Edit user modal */}
      {showForm && (
        <div className="admin__modal-backdrop" onClick={handleCloseForm}>
          <form className="admin__modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <div className="admin__modal-scroll">
              <h3 className="admin__modal-title">{isEditMode ? 'Edit user' : 'Add user'}</h3>
              {error && <p className="admin__error">{error}</p>}

              <label className="admin__label" htmlFor="firstName">First name</label>
              <input id="firstName" name="firstName" className="admin__input" value={form.firstName} onChange={handleChange} required />

              <label className="admin__label" htmlFor="lastName">Last name</label>
              <input id="lastName" name="lastName" className="admin__input" value={form.lastName} onChange={handleChange} required />

              <label className="admin__label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="admin__input" value={form.email} onChange={handleChange} required disabled={isEditMode} />
              {isEditMode && <p className="admin__hint admin__hint--top">Email can't be changed here yet — it's tied to the login account.</p>}

              <label className="admin__label" htmlFor="role">Role</label>
              <input id="role" name="role" className="admin__input" placeholder="e.g. Legal Counsel, Sales Rep" value={form.role} onChange={handleChange} required />

              <label className="admin__label" htmlFor="department">Department</label>
              <input id="department" name="department" className="admin__input" value={form.department} onChange={handleChange} />

              <label className="admin__label" htmlFor="employeeId">ID</label>
              <input id="employeeId" name="employeeId" className="admin__input" value={form.employeeId} onChange={handleChange} />

              {!isEditMode && (
                <>
                  <label className="admin__label" htmlFor="password">
                    Password <span className="admin__label-hint">(leave empty to auto-generate)</span>
                  </label>
                  <input id="password" name="password" type="text" className="admin__input" placeholder="Auto-generated if empty" value={form.password} onChange={handleChange} />
                  <p className="admin__hint">The user can change this password themselves after logging in.</p>
                </>
              )}
            </div>
            <div className="admin__modal-actions">
              <button type="button" className="admin__btn-secondary" onClick={handleCloseForm}>Cancel</button>
              <button type="submit" className="admin__btn-primary" disabled={submitting}>
                {submitting ? (isEditMode ? 'Saving…' : 'Creating…') : (isEditMode ? 'Save changes' : 'Create + Send invite')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add custom field modal */}
      {showFieldForm && (
        <div className="admin__modal-backdrop" onClick={() => setShowFieldForm(false)}>
          <form className="admin__modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSaveField}>
            <div className="admin__modal-scroll">
              <h3 className="admin__modal-title">Add field to {OBJECT_LABELS[objectType]}</h3>
              {fieldError && <p className="admin__error">{fieldError}</p>}

              <label className="admin__label" htmlFor="fieldLabel">Field name</label>
              <input id="fieldLabel" name="label" className="admin__input" placeholder="e.g. Contract Value" value={fieldForm.label} onChange={handleFieldFormChange} required />

              <label className="admin__label" htmlFor="fieldType">Field type</label>
              <select id="fieldType" name="type" className="admin__input" value={fieldForm.type} onChange={handleFieldFormChange}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>

              {fieldForm.type === 'dropdown' && (
                <div className="admin__options-builder">
                  <label className="admin__label">Options</label>
                  {dropdownOptions.map((opt, index) => (
                    <div className="admin__option-row" key={index}>
                      <input className="admin__input admin__input--option" placeholder={`Option ${index + 1}`} value={opt} onChange={(e) => handleOptionChange(index, e.target.value)} />
                      {dropdownOptions.length > 1 && (
                        <button type="button" className="admin__option-remove" onClick={() => handleRemoveOption(index)}>✕</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="admin__add-option-btn" onClick={handleAddOption}>+ Add option</button>
                </div>
              )}

              {fieldForm.type === 'lookup' && (
                <>
                  <label className="admin__label" htmlFor="lookupTarget">Lookup to</label>
                  <select id="lookupTarget" name="lookupTarget" className="admin__input" value={fieldForm.lookupTarget} onChange={handleFieldFormChange}>
                    {OBJECT_TYPES.map((t) => <option key={t} value={t}>{OBJECT_LABELS[t]}</option>)}
                  </select>
                </>
              )}
            </div>
            <div className="admin__modal-actions">
              <button type="button" className="admin__btn-secondary" onClick={() => setShowFieldForm(false)}>Cancel</button>
              <button type="submit" className="admin__btn-primary" disabled={savingField}>{savingField ? 'Saving…' : 'Add field'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit built-in options modal */}
      {editingBuiltIn && (
        <div className="admin__modal-backdrop" onClick={() => setEditingBuiltIn(null)}>
          <div className="admin__modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin__modal-scroll">
              <h3 className="admin__modal-title">Edit options — {editingBuiltIn.label}</h3>
              <p className="admin__hint" style={{ marginBottom: 16 }}>
                These options will appear as dropdown choices when creating or editing an agreement.
              </p>
              <div className="admin__options-builder">
                <label className="admin__label">Options</label>
                {builtInOptions.map((opt, index) => (
                  <div className="admin__option-row" key={index}>
                    <input className="admin__input admin__input--option" placeholder={`Option ${index + 1}`} value={opt} onChange={(e) => handleBuiltInOptionChange(index, e.target.value)} />
                    {builtInOptions.length > 1 && (
                      <button type="button" className="admin__option-remove" onClick={() => handleRemoveBuiltInOption(index)}>✕</button>
                    )}
                  </div>
                ))}
                <button type="button" className="admin__add-option-btn" onClick={handleAddBuiltInOption}>+ Add option</button>
              </div>
            </div>
            <div className="admin__modal-actions">
              <button type="button" className="admin__btn-secondary" onClick={() => setEditingBuiltIn(null)}>Cancel</button>
              <button className="admin__btn-primary" disabled={savingBuiltIn} onClick={handleSaveBuiltIn}>
                {savingBuiltIn ? 'Saving…' : 'Save options'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Type → Subtype mapping modal */}
      {showMapModal && objectType === 'agreement' && (
        <div className="admin__modal-backdrop" onClick={() => setShowMapModal(false)}>
          <div className="admin__modal admin__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="admin__modal-scroll">
              <h3 className="admin__modal-title">Type → Subtype mapping</h3>
              <p className="admin__hint" style={{ marginBottom: 20 }}>
                For each agreement type, define which subtypes are available. Configure agreement types first if the list is empty.
              </p>

              {configuredTypes.length === 0 ? (
                <p className="admin__empty">Configure agreement types first before setting up the mapping.</p>
              ) : (
                configuredTypes.map((type) => (
                  <div key={type} className="admin__map-group">
                    <p className="admin__map-type-label">{type}</p>
                    <div className="admin__options-builder">
                      {(typeSubtypeMap[type] || []).map((sub, index) => (
                        <div className="admin__option-row" key={index}>
                          <input
                            className="admin__input admin__input--option"
                            placeholder={`Subtype ${index + 1}`}
                            value={sub}
                            onChange={(e) => handleMapSubtypeChange(type, index, e.target.value)}
                          />
                          <button type="button" className="admin__option-remove" onClick={() => handleRemoveMapSubtype(type, index)}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="admin__add-option-btn" onClick={() => handleAddMapSubtype(type)}>
                        + Add subtype for {type}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="admin__modal-actions">
              <button className="admin__btn-secondary" onClick={() => setShowMapModal(false)}>Cancel</button>
              <button className="admin__btn-primary" disabled={savingMap} onClick={handleSaveMap}>
                {savingMap ? 'Saving…' : 'Save mapping'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function mapCreateUserError(code) {
  switch (code) {
    case 'auth/email-already-in-use': return 'A user with this email already exists.';
    case 'auth/invalid-email': return 'That email address looks invalid.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    default: return null;
  }
}

export default AdminScreen;