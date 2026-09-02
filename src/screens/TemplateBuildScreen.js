import { useEffect, useRef, useState } from 'react';
import mammoth from 'mammoth';
import {
  getObjectSchema,
  getBuiltInFieldConfigs,
  getTypeSubtypeMap,
  saveTemplate,
  updateTemplate,
  listTemplates,
  deleteTemplate,
  listAgreements,
} from '../supabase';
import { analyzeTemplateWithAI, suggestClausesWithAI } from '../aiApi';
import './TemplateBuildScreen.css';

const LANGUAGES = ['English', 'Romanian', 'French', 'German', 'Spanish'];

const OBJECT_LABELS = { account: 'Account', agreement: 'Agreement', template: 'Template' };

const BUILT_IN_OBJECT_FIELDS = {
  account: [
    { key: 'name', label: 'Account Name' },
    { key: 'country', label: 'Country' },
    { key: 'city', label: 'City' },
    { key: 'address', label: 'Address' },
    { key: 'taxRegistrationNumber', label: 'Tax Registration Number' },
    { key: 'abbreviation', label: 'Abbreviation' },
    { key: 'registeredOffice', label: 'Registered Office' },
    { key: 'status', label: 'Account Status' },
  ],
  agreement: [
    { key: 'title', label: 'Title' },
    { key: 'accountName', label: 'Account Name (on agreement)' },
    { key: 'agreementType', label: 'Agreement Type' },
    { key: 'agreementSubtype', label: 'Agreement Subtype' },
    { key: 'language', label: 'Language' },
    { key: 'status', label: 'Status' },
    { key: 'effectiveDate', label: 'Effective Date' },
    { key: 'endDate', label: 'End Date' },
    { key: 'createdBy', label: 'Created By' },
  ],
  template: [
    { key: 'name', label: 'Template Name' },
    { key: 'agreementType', label: 'Agreement Type' },
    { key: 'agreementSubtype', label: 'Agreement Subtype' },
    { key: 'language', label: 'Language' },
  ],
};

const BUILT_IN_LOOKUPS = [
  { id: 'builtin_account', label: 'Account', target: 'account', source: 'agreement' },
];

function extractPlaceholders(html) {
  const matches = html.match(/\{\{([^}]+)\}\}/g) || [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, '').trim()))];
}

// Locates `searchText` inside `root`'s text content (searching from just
// after `afterText` when given, to disambiguate a label that repeats) and
// returns a Range spanning exactly that text — even when it crosses
// multiple text nodes. Used to turn an AI-suggested match into a real
// selection we can replace with a placeholder span.
function findTextRange(root, searchText, afterText) {
  if (!root || !searchText) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let fullText = '';
  const nodeOffsets = [];
  let node;
  while ((node = walker.nextNode())) {
    const start = fullText.length;
    fullText += node.nodeValue;
    nodeOffsets.push({ node, start, end: fullText.length });
  }

  let searchStart = 0;
  if (afterText) {
    const idx = fullText.indexOf(afterText);
    if (idx !== -1) searchStart = idx;
  }
  let matchIndex = fullText.indexOf(searchText, searchStart);
  if (matchIndex === -1) matchIndex = fullText.indexOf(searchText);
  if (matchIndex === -1) return null;
  const matchEnd = matchIndex + searchText.length;

  const startInfo = nodeOffsets.find((n) => matchIndex >= n.start && matchIndex <= n.end);
  const endInfo = nodeOffsets.find((n) => matchEnd >= n.start && matchEnd <= n.end);
  if (!startInfo || !endInfo) return null;

  const range = document.createRange();
  range.setStart(startInfo.node, matchIndex - startInfo.start);
  range.setEnd(endInfo.node, matchEnd - endInfo.start);
  return range;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function BackIcon() {
  return (
    <svg className="tpl__back-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function buildFieldGroups() {
  const agreementCustom = await getObjectSchema('agreement');
  const templateCustom = await getObjectSchema('template');

  const directFields = [
    ...BUILT_IN_OBJECT_FIELDS.agreement.map((f) => ({ label: f.label, placeholder: `agreement.${f.key}` })),
    ...BUILT_IN_OBJECT_FIELDS.template.map((f) => ({ label: f.label, placeholder: `template.${f.key}` })),
    ...agreementCustom.filter((f) => f.type !== 'lookup').map((f) => ({ label: f.label, placeholder: f.id })),
    ...templateCustom.filter((f) => f.type !== 'lookup').map((f) => ({ label: f.label, placeholder: f.id })),
  ];

  const lookupDefs = [
    ...BUILT_IN_LOOKUPS,
    ...agreementCustom.filter((f) => f.type === 'lookup').map((f) => ({ id: f.id, label: f.label, target: f.lookupTarget })),
    ...templateCustom.filter((f) => f.type === 'lookup').map((f) => ({ id: f.id, label: f.label, target: f.lookupTarget })),
  ];

  const lookupGroups = [];
  for (const lookup of lookupDefs) {
    const targetCustom = await getObjectSchema(lookup.target);
    const targetBuiltIn = BUILT_IN_OBJECT_FIELDS[lookup.target] || [];

    const fields = [
      ...targetBuiltIn.map((f) => ({
        label: `${lookup.label} → ${f.label}`,
        placeholder: `${lookup.id}.${f.key}`,
      })),
      ...targetCustom.filter((f) => f.type !== 'lookup').map((f) => ({
        label: `${lookup.label} → ${f.label}`,
        placeholder: `${lookup.id}.${f.id}`,
      })),
    ];

    lookupGroups.push({
      id: lookup.id,
      label: lookup.label,
      targetLabel: OBJECT_LABELS[lookup.target] || lookup.target,
      fields,
    });
  }

  return { directFields, lookupGroups };
}

function TemplateBuildScreen() {
  const [view, setView] = useState('list');
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateUsage, setTemplateUsage] = useState({});

  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [meta, setMeta] = useState({ name: '', agreementType: '', agreementSubtype: '', language: 'English' });
  const [directFields, setDirectFields] = useState([]);
  const [lookupGroups, setLookupGroups] = useState([]);
  const [expandedLookups, setExpandedLookups] = useState({});
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOverField, setDragOverField] = useState(false);

  const [typeOptions, setTypeOptions] = useState([]);
  const [subtypeOptions, setSubtypeOptions] = useState([]);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});

  const [fieldSuggestions, setFieldSuggestions] = useState([]);
  const [loadingFieldSuggestions, setLoadingFieldSuggestions] = useState(false);
  const [fieldSuggestionsError, setFieldSuggestionsError] = useState('');

  const [showClausesModal, setShowClausesModal] = useState(false);
  const [missingClauses, setMissingClauses] = useState([]);
  const [existingClauses, setExistingClauses] = useState([]);
  const [insertedClauseIds, setInsertedClauseIds] = useState([]);
  const [loadingClauseSuggestions, setLoadingClauseSuggestions] = useState(false);
  const [clauseSuggestionsError, setClauseSuggestionsError] = useState('');
  const [hasRunClauseAnalysis, setHasRunClauseAnalysis] = useState(false);

  const editableRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggedFieldRef = useRef(null);

  const filteredSubtypes = meta.agreementType && Object.keys(typeSubtypeMap).length > 0
    ? (typeSubtypeMap[meta.agreementType] || subtypeOptions)
    : subtypeOptions;

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const [tpls, agreements] = await Promise.all([listTemplates(), listAgreements()]);
      setTemplates(tpls);
      const usage = {};
      agreements.forEach((a) => {
        if (!a.templateId) return;
        usage[a.templateId] = (usage[a.templateId] || 0) + 1;
      });
      setTemplateUsage(usage);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (view === 'list') loadTemplates();
  }, [view]);

  useEffect(() => {
    if (htmlContent && editableRef.current && !editableRef.current.dataset.loaded) {
      editableRef.current.innerHTML = htmlContent;
      editableRef.current.dataset.loaded = 'true';
    }
  }, [htmlContent]);

  const handleMetaChange = (e) => {
    const { name, value } = e.target;
    if (name === 'agreementType') {
      setMeta((prev) => ({ ...prev, agreementType: value, agreementSubtype: '' }));
    } else {
      setMeta((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleStartNew = () => {
    setEditingTemplateId(null);
    setMeta({ name: '', agreementType: '', agreementSubtype: '', language: 'English' });
    setHtmlContent('');
    setFileName('');
    setError('');
    setFieldSuggestions([]);
    setMissingClauses([]);
    setExistingClauses([]);
    setHasRunClauseAnalysis(false);
    setInsertedClauseIds([]);
    setView('setup');
  };

  const handleEditTemplate = async (template) => {
    setEditingTemplateId(template.id);
    setMeta({
      name: template.name,
      agreementType: template.agreementType,
      agreementSubtype: template.agreementSubtype,
      language: template.language || 'English',
    });
    setError('');
    setFieldSuggestions([]);
    setFieldSuggestionsError('');
    setMissingClauses([]);
    setExistingClauses([]);
    setHasRunClauseAnalysis(false);
    setInsertedClauseIds([]);
    try {
      const [configs, map] = await Promise.all([
        getBuiltInFieldConfigs('agreement'),
        getTypeSubtypeMap(),
      ]);
      const { directFields: df, lookupGroups: lg } = await buildFieldGroups();
      setDirectFields(df);
      setLookupGroups(lg);
      if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
      if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
      setTypeSubtypeMap(map);
    } catch (err) {
      console.error('Failed to load agreement fields:', err);
    }
    if (editableRef.current) delete editableRef.current.dataset.loaded;
    setHtmlContent(template.contentHtml || '');
    setFileName(template.name);
    setView('builder');
  };

  const handleContinueToUpload = async (e) => {
    e.preventDefault();
    if (!meta.name.trim() || !meta.agreementType.trim() || !meta.agreementSubtype.trim()) {
      setError('Please fill in name, agreement type, and subtype.');
      return;
    }
    setError('');
    try {
      const [fields, configs, map] = await Promise.all([
        getObjectSchema('agreement'),
        getBuiltInFieldConfigs('agreement'),
        getTypeSubtypeMap(),
      ]);
      const { directFields: df, lookupGroups: lg } = await buildFieldGroups();
      setDirectFields(df);
      setLookupGroups(lg);
      if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
      if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
      setTypeSubtypeMap(map);
    } catch (err) {
      console.error('Failed to load agreement fields:', err);
    }
    setView('builder');
  };

  useEffect(() => {
    if (view === 'setup') {
      Promise.all([
        getBuiltInFieldConfigs('agreement'),
        getTypeSubtypeMap(),
      ]).then(([configs, map]) => {
        if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
        if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
        setTypeSubtypeMap(map);
      }).catch(console.error);
    }
  }, [view]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setError('Please upload a .docx file (older .doc files are not supported).');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      if (editableRef.current) delete editableRef.current.dataset.loaded;
      setHtmlContent(result.value);
      setFileName(file.name);
    } catch (err) {
      console.error('Failed to convert document:', err);
      setError('Could not read this Word document. Try saving it again from Word and re-uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleFieldDragStart = (e, field) => {
    draggedFieldRef.current = field;
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', JSON.stringify(field)); } catch (err) {}
  };

  const handleDocInternalDragStart = (e) => { e.preventDefault(); };

  const insertPlaceholderAtPoint = (field, clientX, clientY) => {
    const editable = editableRef.current;
    if (!editable || !field) return;
    editable.focus();

    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
    }
    if (!range) { range = document.createRange(); range.selectNodeContents(editable); range.collapse(false); }
    range.collapse(true);

    const span = document.createElement('span');
    span.className = 'tpl-placeholder';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-field', field.placeholder);
    span.textContent = `{{${field.label}}}`;
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    const space = document.createTextNode('\u00A0');
    range.insertNode(space);
    window.getSelection()?.removeAllRanges();
  };

  const handleDocDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDocDragOver = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDragOverField(true); };

  const handleDocDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverField(false);
    let field = draggedFieldRef.current;
    if (!field) {
      const raw = e.dataTransfer.getData('text/plain');
      if (raw) { try { field = JSON.parse(raw); } catch (err) { field = null; } }
    }
    if (!field) return;
    insertPlaceholderAtPoint(field, e.clientX, e.clientY);
    draggedFieldRef.current = null;
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const finalHtml = editableRef.current?.innerHTML || '';
      const fieldsUsed = extractPlaceholders(finalHtml);
      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, { ...meta, contentHtml: finalHtml, fieldsUsed });
      } else {
        await saveTemplate({ ...meta, contentHtml: finalHtml, fieldsUsed });
      }
      setView('list');
    } catch (err) {
      console.error('Failed to save template:', err);
      setError('Something went wrong while saving the template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"? This can't be undone.`)) return;
    try {
      await deleteTemplate(template.id);
      await loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
      alert('Could not delete the template. Please try again.');
    }
  };

  const toggleLookupGroup = (id) => {
    setExpandedLookups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allFlatFields = [...directFields, ...lookupGroups.flatMap((g) => g.fields)];

  const handleSuggestFields = async () => {
    if (!editableRef.current) return;
    setLoadingFieldSuggestions(true);
    setFieldSuggestionsError('');
    try {
      const documentText = editableRef.current.innerText || '';
      const results = await analyzeTemplateWithAI(documentText, allFlatFields);
      setFieldSuggestions(results.map((s) => ({ ...s, id: uid() })));
    } catch (err) {
      console.error('AI field suggestion failed:', err);
      setFieldSuggestionsError(err.message || 'Could not get AI suggestions. Please try again.');
    } finally {
      setLoadingFieldSuggestions(false);
    }
  };

  const applyFieldSuggestion = (suggestion) => {
    const range = findTextRange(editableRef.current, suggestion.matchText, suggestion.contextText);
    if (!range) return false;
    range.deleteContents();
    const span = document.createElement('span');
    span.className = 'tpl-placeholder';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-field', suggestion.placeholder);
    span.textContent = `{{${suggestion.label}}}`;
    range.insertNode(span);
    return true;
  };

  const handleAcceptFieldSuggestion = (suggestion) => {
    const applied = applyFieldSuggestion(suggestion);
    if (!applied) {
      setFieldSuggestionsError(`Couldn't locate "${suggestion.matchText}" anymore — it may have moved or already been replaced.`);
    }
    setFieldSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  };

  const handleRejectFieldSuggestion = (id) => {
    setFieldSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAcceptAllFieldSuggestions = () => {
    fieldSuggestions.forEach((s) => applyFieldSuggestion(s));
    setFieldSuggestions([]);
  };

  const handleOpenClausesModal = async () => {
    setShowClausesModal(true);
    if (hasRunClauseAnalysis) return;
    setLoadingClauseSuggestions(true);
    setClauseSuggestionsError('');
    try {
      const documentText = editableRef.current?.innerText || '';
      const results = await suggestClausesWithAI(documentText, {
        agreementType: meta.agreementType,
        agreementSubtype: meta.agreementSubtype,
        language: meta.language,
      });
      setMissingClauses(results.missingClauses.map((c) => ({ ...c, id: uid() })));
      setExistingClauses(results.existingClauses.map((c) => ({ ...c, id: uid() })));
      setHasRunClauseAnalysis(true);
    } catch (err) {
      console.error('AI clause suggestion failed:', err);
      setClauseSuggestionsError(err.message || 'Could not get AI suggestions. Please try again.');
    } finally {
      setLoadingClauseSuggestions(false);
    }
  };

  const closeClausesModal = () => setShowClausesModal(false);

  // A signature block is either an actual docusign.* placeholder chip
  // (dropped in from the field sidebar) or, failing that, the first
  // paragraph that reads like the start of a signature section — new
  // clauses go right before whichever of those comes first, never after.
  const findSignatureBlock = (root) => {
    if (!root) return null;
    const sigChip = root.querySelector('.tpl-placeholder[data-field^="docusign."]');
    let target = sigChip;
    if (!target) {
      const blocks = Array.from(root.querySelectorAll('p, div, li'));
      target = blocks.find((el) => /in witness whereof|signature|signed\s+by|semn(at|ătur)/i.test(el.textContent || '')) || null;
    }
    if (!target) return null;
    let topLevel = target;
    while (topLevel.parentElement && topLevel.parentElement !== root) {
      topLevel = topLevel.parentElement;
    }
    return topLevel.parentElement === root ? topLevel : null;
  };

  // If the document numbers its clauses ("1. Definitions", "2. Term", …),
  // new clauses continue that numbering instead of starting a fresh "1.".
  const detectNextClauseNumber = (root) => {
    if (!root) return null;
    let maxNum = 0;
    let found = false;
    root.querySelectorAll('p, li').forEach((el) => {
      const match = (el.textContent || '').trim().match(/^(\d+)[.)]\s+\S/);
      if (match) {
        found = true;
        maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    });
    return found ? maxNum + 1 : null;
  };

  const handleInsertClause = (clause) => {
    const editable = editableRef.current;
    if (!editable) return;

    const nextNumber = detectNextClauseNumber(editable);
    const p = document.createElement('p');
    p.textContent = nextNumber ? `${nextNumber}. ${clause.title}. ${clause.text}` : `${clause.title}. ${clause.text}`;

    const signatureBlock = findSignatureBlock(editable);
    if (signatureBlock) {
      editable.insertBefore(p, signatureBlock);
    } else {
      editable.appendChild(p);
    }
    setInsertedClauseIds((prev) => [...prev, clause.id]);
  };

  if (view === 'list') {
    return (
      <div className="tpl">
        <div className="tpl__list-header">
          <h2 className="tpl__title">Templates</h2>
          <button className="tpl__btn-primary" onClick={handleStartNew}>+ New template</button>
        </div>

        {loadingTemplates ? (
          <p className="tpl__empty">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="tpl__empty">No templates yet. Create your first one.</p>
        ) : (
          <div className="tpl__grid">
            {templates.map((t) => (
              <div key={t.id} className="tpl__card" onClick={() => handleEditTemplate(t)}>
                <div className="tpl__card-header">
                  <span className="tpl__card-name">{t.name}</span>
                  <button
                    className="tpl__card-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                    aria-label="Delete template"
                  >
                    ✕
                  </button>
                </div>
                <div className="tpl__card-meta">
                  <span className="tpl__tag">{t.agreementType}</span>
                  <span className="tpl__tag">{t.agreementSubtype}</span>
                  <span className="tpl__tag tpl__tag--lang">{t.language}</span>
                </div>
                <p className="tpl__card-fields">{(t.fieldsUsed || []).length} field{(t.fieldsUsed || []).length === 1 ? '' : 's'} mapped</p>
                <p className="tpl__card-usage">Used in {templateUsage[t.id] || 0} document{(templateUsage[t.id] || 0) === 1 ? '' : 's'}</p>
                <span className="tpl__card-edit-hint">Click to edit</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === 'setup') {
    return (
      <div className="tpl">
        <button className="tpl__back" onClick={() => setView('list')}>
          <BackIcon /> Back to templates
        </button>

        <div className="tpl__setup-card">
          <h2 className="tpl__title">New template</h2>
          <p className="tpl__subtitle">This information is used later to find the right template when generating an agreement.</p>

          {error && <p className="tpl__error">{error}</p>}

          <form onSubmit={handleContinueToUpload}>
            <div className="tpl__setup-grid">
              <div className="tpl__field tpl__field--full">
                <label className="tpl__label" htmlFor="name">Template name</label>
                <input id="name" name="name" className="tpl__input" value={meta.name} onChange={handleMetaChange} placeholder="e.g. NDA - Standard" required />
              </div>

              <div className="tpl__field">
                <label className="tpl__label" htmlFor="agreementType">Agreement type</label>
                {typeOptions.length > 0 ? (
                  <select id="agreementType" name="agreementType" className="tpl__input" value={meta.agreementType} onChange={handleMetaChange} required>
                    <option value="">— Select type —</option>
                    {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input id="agreementType" name="agreementType" className="tpl__input" value={meta.agreementType} onChange={handleMetaChange} placeholder="e.g. NDA, MSA, SOW" required />
                )}
              </div>

              <div className="tpl__field">
                <label className="tpl__label" htmlFor="agreementSubtype">Agreement subtype</label>
                {filteredSubtypes.length > 0 ? (
                  <select
                    id="agreementSubtype"
                    name="agreementSubtype"
                    className="tpl__input"
                    value={meta.agreementSubtype}
                    onChange={handleMetaChange}
                    required
                    disabled={typeOptions.length > 0 && !meta.agreementType}
                  >
                    <option value="">— Select subtype —</option>
                    {filteredSubtypes.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    id="agreementSubtype"
                    name="agreementSubtype"
                    className="tpl__input"
                    value={meta.agreementSubtype}
                    onChange={handleMetaChange}
                    placeholder={meta.agreementType ? 'e.g. Mutual, One-way' : 'Select a type first'}
                    disabled={typeOptions.length > 0 && !meta.agreementType}
                    required
                  />
                )}
              </div>

              <div className="tpl__field tpl__field--full">
                <label className="tpl__label" htmlFor="language">Language</label>
                <select id="language" name="language" className="tpl__input" value={meta.language} onChange={handleMetaChange}>
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="tpl__btn-primary tpl__btn-full">Continue to upload</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tpl tpl--builder">
      <div className="tpl__builder-topbar">
        <button className="tpl__back" onClick={() => setView('setup')}>
          <BackIcon /> Back
        </button>
        <div className="tpl__builder-meta">
          <strong>{meta.name}</strong>
          <span className="tpl__tag">{meta.agreementType}</span>
          <span className="tpl__tag">{meta.agreementSubtype}</span>
          <span className="tpl__tag tpl__tag--lang">{meta.language}</span>
        </div>
        <div className="tpl__topbar-actions">
          <button className="tpl__btn-secondary" onClick={handleOpenClausesModal} disabled={!htmlContent}>
            Suggest clauses
          </button>
          <button className="tpl__btn-primary" onClick={handleSave} disabled={saving || !htmlContent}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      {error && <p className="tpl__error">{error}</p>}

      {!htmlContent ? (
        <div className="tpl__upload-zone" onClick={() => fileInputRef.current?.click()}>
          <input ref={fileInputRef} type="file" accept=".docx" className="tpl__upload-input" onChange={handleFileChange} />
          {uploading ? (
            <p>Converting document…</p>
          ) : (
            <>
              <p className="tpl__upload-title">Upload a Word document (.docx)</p>
              <p className="tpl__upload-hint">Click to browse, or drag a file here</p>
            </>
          )}
        </div>
      ) : (
        <div className="tpl__builder-layout">
          <aside className="tpl__sidebar">
            <div className="tpl__sidebar-header">
              <h3 className="tpl__sidebar-title">Drag a field into the document</h3>
              <p className="tpl__sidebar-hint">Fields come from Agreement and Template object schemas.</p>
              <button
                type="button"
                className="tpl__ai-btn"
                onClick={handleSuggestFields}
                disabled={loadingFieldSuggestions || allFlatFields.length === 0}
              >
                {loadingFieldSuggestions ? 'Scanning document…' : 'Suggest fields with AI'}
              </button>
              {fieldSuggestionsError && <p className="tpl__ai-error">{fieldSuggestionsError}</p>}
            </div>

            <div className="tpl__sidebar-scroll">
              {fieldSuggestions.length > 0 && (
                <div className="tpl__ai-suggestions">
                  <div className="tpl__ai-suggestions-header">
                    <span>{fieldSuggestions.length} suggestion{fieldSuggestions.length === 1 ? '' : 's'}</span>
                    <button type="button" className="tpl__ai-accept-all" onClick={handleAcceptAllFieldSuggestions}>
                      Accept all
                    </button>
                  </div>
                  {fieldSuggestions.map((s) => (
                    <div key={s.id} className="tpl__ai-suggestion">
                      <p className="tpl__ai-suggestion-match">“{s.matchText}”</p>
                      <p className="tpl__ai-suggestion-label">→ {s.label}</p>
                      {s.reason && <p className="tpl__ai-suggestion-reason">{s.reason}</p>}
                      <div className="tpl__ai-suggestion-actions">
                        <button type="button" className="tpl__ai-reject" onClick={() => handleRejectFieldSuggestion(s.id)}>
                          ✕ Skip
                        </button>
                        <button type="button" className="tpl__ai-accept" onClick={() => handleAcceptFieldSuggestion(s)}>
                          ✓ Insert
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="tpl__field-list">
                {directFields.map((field) => (
                  <div
                    key={field.placeholder}
                    className="tpl__field-chip"
                    draggable="true"
                    onDragStart={(e) => handleFieldDragStart(e, field)}
                  >
                    <span className="tpl__field-chip-dots">⠿</span>
                    {field.label}
                  </div>
                ))}
              </div>

              {lookupGroups.length > 0 && (
                <div className="tpl__lookup-groups">
                  {lookupGroups.map((group) => (
                    <div key={group.id} className="tpl__lookup-group">
                      <button
                        type="button"
                        className="tpl__lookup-group-header"
                        onClick={() => toggleLookupGroup(group.id)}
                      >
                        <span className="tpl__lookup-group-chevron">{expandedLookups[group.id] ? '▾' : '▸'}</span>
                        <span className="tpl__lookup-group-name">{group.label}</span>
                        <span className="tpl__lookup-group-target">{group.targetLabel}</span>
                      </button>

                      {expandedLookups[group.id] && (
                        <div className="tpl__lookup-group-fields">
                          {group.fields.map((field) => (
                            <div
                              key={field.placeholder}
                              className="tpl__field-chip tpl__field-chip--nested"
                              draggable="true"
                              onDragStart={(e) => handleFieldDragStart(e, field)}
                            >
                              <span className="tpl__field-chip-dots">⠿</span>
                              {field.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="tpl__filename">{fileName}</div>
          </aside>

          <div className="tpl__doc-wrap">
            <div
              ref={editableRef}
              className={`tpl__doc ${dragOverField ? 'tpl__doc--dragover' : ''}`}
              contentEditable
              suppressContentEditableWarning
              onDragStart={handleDocInternalDragStart}
              onDragEnter={handleDocDragEnter}
              onDragOver={handleDocDragOver}
              onDragLeave={() => setDragOverField(false)}
              onDrop={handleDocDrop}
            />
          </div>
        </div>
      )}

      {showClausesModal && (
        <div className="agrd__modal-backdrop" onClick={closeClausesModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Suggested clauses</h3>
              <p className="agrd__modal-subtitle">
                Based on this template's type ({meta.agreementType || 'unspecified'}) and what's already in the
                document — not legal advice, a starting point to adapt.
              </p>

              {clauseSuggestionsError && <p className="agrd__error">{clauseSuggestionsError}</p>}

              {loadingClauseSuggestions ? (
                <p className="tpl__empty">Reading the document…</p>
              ) : (
                <>
                  <h4 className="tpl__clause-section-title">Missing clauses</h4>
                  {missingClauses.length === 0 ? (
                    <p className="tpl__empty">
                      {clauseSuggestionsError ? '' : 'No obvious gaps found — this template already covers the essentials.'}
                    </p>
                  ) : (
                    <div className="tpl__clause-list">
                      {missingClauses.map((clause) => {
                        const inserted = insertedClauseIds.includes(clause.id);
                        return (
                          <div key={clause.id} className="tpl__clause">
                            <div className="tpl__clause-header">
                              <span className="tpl__clause-title">{clause.title}</span>
                              <button
                                type="button"
                                className={inserted ? 'tpl__clause-inserted' : 'tpl__ai-accept'}
                                onClick={() => handleInsertClause(clause)}
                                disabled={inserted}
                              >
                                {inserted ? '✓ Inserted' : 'Insert'}
                              </button>
                            </div>
                            {clause.reason && <p className="tpl__clause-reason">{clause.reason}</p>}
                            <p className="tpl__clause-text">{clause.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {existingClauses.length > 0 && (
                    <>
                      <h4 className="tpl__clause-section-title tpl__clause-section-title--spaced">
                        Existing clauses — quality &amp; risk
                      </h4>
                      <div className="tpl__clause-list">
                        {existingClauses.map((clause) => (
                          <div key={clause.id} className="tpl__clause">
                            <div className="tpl__clause-header">
                              <span className="tpl__clause-title">{clause.title}</span>
                              <div className="tpl__clause-scores">
                                <span className={`tpl__risk-badge tpl__risk-badge--${(clause.risk || 'medium').toLowerCase()}`}>
                                  {clause.risk || 'medium'} risk
                                </span>
                                <span className="tpl__score-badge">{clause.score}/10</span>
                              </div>
                            </div>
                            {clause.assessment && <p className="tpl__clause-reason">{clause.assessment}</p>}
                            {clause.improvement && (
                              <p className="tpl__clause-improvement">
                                <strong>Improve:</strong> {clause.improvement}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeClausesModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TemplateBuildScreen;