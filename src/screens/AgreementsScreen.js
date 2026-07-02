import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import mammoth from 'mammoth';
import {
  listAgreements,
  createAgreement,
  getObjectSchema,
  getBuiltInFieldConfigs,
  getTypeSubtypeMap,
  listAccounts,
  auth,
} from '../firebase';
import './AgreementsScreen.css';

const LANGUAGES = ['English', 'Romanian', 'French', 'German', 'Spanish'];
const DEFAULT_STATUSES = ['Draft', 'Generated', 'Import offline', 'In review', 'Reviewed', 'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated'];

const EMPTY_FORM = {
  title: '',
  accountId: '',
  accountName: '',
  agreementType: '',
  agreementSubtype: '',
  language: 'English',
  status: 'Draft',
  effectiveDate: '',
  endDate: '',
};

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__chevron">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FormIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__flow-icon">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__flow-icon">
      <path d="M6 10a5 5 0 0 1 10 0 3 3 0 0 1 0 6H6a3.5 3.5 0 0 1 0-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__flow-icon">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AgreementsScreen() {
  const navigate = useNavigate();
  const currentUser = auth.currentUser;

  const [sideFilter, setSideFilter] = useState('mine');
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState('choose');
  const [createFlow, setCreateFlow] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [statusOptions, setStatusOptions] = useState(DEFAULT_STATUSES);
  const [typeOptions, setTypeOptions] = useState([]);
  const [subtypeOptions, setSubtypeOptions] = useState([]);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});

  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // Subtypes filtered by selected type
  const filteredSubtypes = useMemo(() => {
    if (!form.agreementType) return subtypeOptions;
    if (Object.keys(typeSubtypeMap).length > 0) {
      return typeSubtypeMap[form.agreementType] || subtypeOptions;
    }
    return subtypeOptions;
  }, [form.agreementType, typeSubtypeMap, subtypeOptions]);

  const loadAgreements = async () => {
    setLoading(true);
    try {
      setAgreements(await listAgreements());
    } catch (err) {
      console.error('Failed to load agreements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgreements();
    getObjectSchema('agreement').then(setCustomFieldDefs).catch(console.error);
    listAccounts().then(setAccounts).catch(console.error);
    Promise.all([
      getBuiltInFieldConfigs('agreement'),
      getTypeSubtypeMap(),
    ]).then(([configs, map]) => {
      if (configs.status?.length) setStatusOptions(configs.status);
      if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
      if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
      setTypeSubtypeMap(map);
    }).catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    if (sideFilter === 'mine') {
      return agreements.filter((a) => a.createdBy === (currentUser?.displayName || currentUser?.email));
    }
    return agreements;
  }, [agreements, sideFilter, currentUser]);

  const handleOpenCreate = () => {
    setShowCreate(true);
    setCreateStep('choose');
    setCreateFlow(null);
    setForm(EMPTY_FORM);
    setCustomValues({});
    setUploadedFile(null);
    setFormError('');
    setUploadError('');
  };

  const handleCloseCreate = () => {
    setShowCreate(false);
    setCreateStep('choose');
    setCreateFlow(null);
  };

  const handleChooseFlow = (flow) => {
    setCreateFlow(flow);
    setCreateStep(flow === 'form' ? 'form' : 'upload');
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) { setUploadError('Please upload a .docx file.'); return; }
    setUploading(true);
    setUploadError('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setUploadedFile({ name: file.name, contentHtml: result.value });
    } catch (err) {
      setUploadError('Could not read this file. Try saving it again from Word and re-uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'accountId') {
      const acc = accounts.find((a) => a.id === value);
      setForm((prev) => ({ ...prev, accountId: value, accountName: acc?.name || '' }));
    } else if (name === 'agreementType') {
      // Reset subtype when type changes
      setForm((prev) => ({ ...prev, agreementType: value, agreementSubtype: '' }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCustomChange = (fieldId, value) => setCustomValues((prev) => ({ ...prev, [fieldId]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.title.trim()) { setFormError('Agreement title is required.'); return; }
    setSaving(true);
    try {
      const statusOverride = createFlow === 'signed' ? 'Signed' : form.status;
      const docRef = await createAgreement({
        ...form,
        status: statusOverride,
        customFields: customValues,
        contentHtml: uploadedFile?.contentHtml || '',
      });
      handleCloseCreate();
      navigate(`/dashboard/agreements/${docRef.id}`);
    } catch (err) {
      console.error('Failed to create agreement:', err);
      setFormError('Something went wrong while saving the agreement.');
    } finally {
      setSaving(false);
    }
  };

  const renderCustomFieldInput = (field) => {
    const value = customValues[field.id] ?? '';
    if (field.type === 'dropdown') {
      return (
        <select className="agr__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)}>
          <option value="">— Select —</option>
          {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (field.type === 'number') return <input type="number" className="agr__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    if (field.type === 'date') return <input type="date" className="agr__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    return <input type="text" className="agr__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
  };

  const statusClass = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'draft': return 'agr__status--draft';
      case 'in review': return 'agr__status--review';
      case 'approved': return 'agr__status--approved';
      case 'signed': return 'agr__status--signed';
      default: return 'agr__status--draft';
    }
  };

  return (
    <div className="agr">
      <aside className="agr__side">
        <p className="agr__side-label">View</p>
        <button className={`agr__side-item ${sideFilter === 'mine' ? 'agr__side-item--active' : ''}`} onClick={() => setSideFilter('mine')}>My agreements</button>
        <button className={`agr__side-item ${sideFilter === 'all' ? 'agr__side-item--active' : ''}`} onClick={() => setSideFilter('all')}>All agreements</button>
      </aside>

      <div className="agr__main">
        <div className="agr__header">
          <h2 className="agr__title">{sideFilter === 'mine' ? 'My agreements' : 'All agreements'}</h2>
          <button className="agr__create-btn" onClick={handleOpenCreate}>+ Create new agreement</button>
        </div>

        {loading ? (
          <p className="agr__empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="agr__empty">No agreements found.</p>
        ) : (
          <div className="agr__table-wrap">
            <table className="agr__table">
              <thead>
                <tr>
                  <th>Name</th><th>Account</th><th>Agreement type</th><th>Status</th><th>Start date</th><th>End date</th><th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agr) => (
                  <tr key={agr.id}>
                    <td className="agr__td-name">{agr.title || '—'}</td>
                    <td>{agr.accountName || '—'}</td>
                    <td>{agr.agreementType || '—'}</td>
                    <td><span className={`agr__status ${statusClass(agr.status)}`}>{agr.status || 'Draft'}</span></td>
                    <td className="agr__td-muted">{agr.effectiveDate || '—'}</td>
                    <td className="agr__td-muted">{agr.endDate || '—'}</td>
                    <td>
                      <button className="agr__detail-btn" onClick={() => navigate(`/dashboard/agreements/${agr.id}`)} aria-label="View details">
                        <ChevronIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="agr__modal-backdrop" onClick={handleCloseCreate}>
          <div className="agr__modal" onClick={(e) => e.stopPropagation()}>

            {createStep === 'choose' && (
              <>
                <div className="agr__modal-header">
                  <h3 className="agr__modal-title">Create new agreement</h3>
                  <p className="agr__modal-subtitle">Choose how you'd like to start.</p>
                </div>
                <div className="agr__flow-cards">
                  <button className="agr__flow-card" onClick={() => handleChooseFlow('form')}>
                    <FormIcon />
                    <span className="agr__flow-card-title">Contract form</span>
                    <span className="agr__flow-card-desc">Fill in the agreement details using a structured form and generate the document.</span>
                  </button>
                  <button className="agr__flow-card" onClick={() => handleChooseFlow('offline')}>
                    <UploadIcon />
                    <span className="agr__flow-card-title">Import offline</span>
                    <span className="agr__flow-card-desc">Upload a Word document you've already prepared, then complete the agreement details.</span>
                  </button>
                  <button className="agr__flow-card" onClick={() => handleChooseFlow('signed')}>
                    <SignedIcon />
                    <span className="agr__flow-card-title">Import signed agreement</span>
                    <span className="agr__flow-card-desc">Upload an already-signed document. The agreement status will be set to Signed.</span>
                  </button>
                </div>
                <div className="agr__modal-actions">
                  <button className="agr__btn-secondary" onClick={handleCloseCreate}>Cancel</button>
                </div>
              </>
            )}

            {createStep === 'upload' && (
              <>
                <div className="agr__modal-header">
                  <h3 className="agr__modal-title">{createFlow === 'signed' ? 'Import signed agreement' : 'Import offline document'}</h3>
                  <p className="agr__modal-subtitle">
                    Upload a .docx file{createFlow === 'signed' ? ' — the agreement will be marked as Signed.' : ', then complete the details.'}
                  </p>
                </div>
                <div className="agr__upload-zone" onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" accept=".docx" className="agr__upload-input" onChange={handleFileChange} />
                  {uploading ? (
                    <p className="agr__upload-hint">Converting document…</p>
                  ) : uploadedFile ? (
                    <>
                      <p className="agr__upload-done">✓ {uploadedFile.name}</p>
                      <p className="agr__upload-hint">Click to replace</p>
                    </>
                  ) : (
                    <>
                      {createFlow === 'signed' ? (
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__upload-zone-icon">
                          <rect x="4" y="3" width="16" height="18" rx="2" stroke="#001272" strokeWidth="1.8" />
                          <path d="M9 12l2 2 4-4" stroke="#001272" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agr__upload-zone-icon">
                          <path d="M6 10a5 5 0 0 1 10 0 3 3 0 0 1 0 6H6a3.5 3.5 0 0 1 0-7z" stroke="#001272" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      <p className="agr__upload-title">Upload a Word document (.docx)</p>
                      <p className="agr__upload-hint">Click to browse</p>
                    </>
                  )}
                </div>
                {uploadError && <p className="agr__form-error agr__form-error--upload">{uploadError}</p>}
                <div className="agr__modal-actions">
                  <button className="agr__btn-secondary" onClick={() => setCreateStep('choose')}>Back</button>
                  <button className="agr__btn-primary" disabled={!uploadedFile} onClick={() => setCreateStep('form')}>Next</button>
                </div>
              </>
            )}

            {createStep === 'form' && (
              <>
                <div className="agr__modal-header">
                  <h3 className="agr__modal-title">Agreement details</h3>
                  {createFlow === 'signed' && <p className="agr__modal-subtitle">Status will be set to <strong>Signed</strong> automatically.</p>}
                </div>
                <div className="agr__modal-scroll">
                  {formError && <p className="agr__form-error">{formError}</p>}
                  <div className="agr__form-grid">
                    <div className="agr__field agr__field--full">
                      <label className="agr__label" htmlFor="title">Agreement title</label>
                      <input id="title" name="title" className="agr__input" value={form.title} onChange={handleFormChange} required />
                    </div>

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="accountId">Account</label>
                      <select id="accountId" name="accountId" className="agr__input" value={form.accountId} onChange={handleFormChange}>
                        <option value="">— Select account —</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="agreementType">Agreement type</label>
                      {typeOptions.length > 0 ? (
                        <select id="agreementType" name="agreementType" className="agr__input" value={form.agreementType} onChange={handleFormChange}>
                          <option value="">— Select type —</option>
                          {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input id="agreementType" name="agreementType" className="agr__input" placeholder="e.g. NDA, MSA, SOW" value={form.agreementType} onChange={handleFormChange} />
                      )}
                    </div>

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="agreementSubtype">Agreement subtype</label>
                      {filteredSubtypes.length > 0 ? (
                        <select
                          id="agreementSubtype"
                          name="agreementSubtype"
                          className="agr__input"
                          value={form.agreementSubtype}
                          onChange={handleFormChange}
                          disabled={typeOptions.length > 0 && !form.agreementType}
                        >
                          <option value="">— Select subtype —</option>
                          {filteredSubtypes.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          id="agreementSubtype"
                          name="agreementSubtype"
                          className="agr__input"
                          placeholder={typeOptions.length > 0 && !form.agreementType ? 'Select a type first' : 'e.g. Mutual, One-way'}
                          value={form.agreementSubtype}
                          onChange={handleFormChange}
                          disabled={typeOptions.length > 0 && !form.agreementType}
                        />
                      )}
                    </div>

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="language">Language</label>
                      <select id="language" name="language" className="agr__input" value={form.language} onChange={handleFormChange}>
                        {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>

                    {createFlow !== 'signed' && (
                      <div className="agr__field">
                        <label className="agr__label" htmlFor="status">Status</label>
                        <select id="status" name="status" className="agr__input" value={form.status} onChange={handleFormChange}>
                          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    )}

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="effectiveDate">Start date</label>
                      <input id="effectiveDate" name="effectiveDate" type="date" className="agr__input" value={form.effectiveDate} onChange={handleFormChange} />
                    </div>

                    <div className="agr__field">
                      <label className="agr__label" htmlFor="endDate">End date</label>
                      <input id="endDate" name="endDate" type="date" className="agr__input" value={form.endDate} onChange={handleFormChange} />
                    </div>

                    {customFieldDefs.filter((f) => f.type !== 'lookup').map((field) => (
                      <div key={field.id} className="agr__field">
                        <label className="agr__label">{field.label}</label>
                        {renderCustomFieldInput(field)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="agr__modal-actions">
                  <button className="agr__btn-secondary" onClick={() => createFlow === 'form' ? setCreateStep('choose') : setCreateStep('upload')}>Back</button>
                  <button className="agr__btn-primary" disabled={saving} onClick={handleSubmit}>
                    {saving ? 'Saving…' : 'Create agreement'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AgreementsScreen;