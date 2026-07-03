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
} from '../firebase';
import { analyzeTemplateWithAI } from '../aiApi';
import './AIBuilderModal.css';
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

// Finds the first occurrence of `matchText` among the text nodes inside
// `root` and replaces it with a placeholder <span>, the same way manual
// drag-and-drop does. Walking text nodes (rather than string-replacing
// innerHTML) avoids corrupting existing tags/attributes in the document.
// Finds `matchText` across the FULL concatenated text of `root` — not just
// within a single text node — and replaces it with a placeholder <span>.
// This matters because Word documents converted through mammoth often
// split what looks like one continuous sentence into several small text
// nodes (separate bold/italic/spell-check runs), so a naive per-node
// search misses most real matches and silently applies nothing.
// Concatenates every text node inside `root`, in DOM order, along with the
// [start, end) offset each node occupies in that concatenation. Used by
// BOTH the AI analysis (what text Claude sees) and the replacement search
// below — they must use the exact same extraction, or a match Claude finds
// against one representation of the text can become unfindable against a
// different one (e.g. `element.innerText` collapses whitespace and
// converts <br> per browser rendering rules, in ways raw textContent does
// not — a mismatch that caused matches to silently fail to apply).
function getPlainTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let fullText = '';
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: fullText.length, end: fullText.length + node.textContent.length });
    fullText += node.textContent;
  }
  return { nodes, fullText };
}

// Finds where `matchText` sits, optionally anchored just after `contextText`.
// Models reliably copy each string correctly on its own, but often trim the
// whitespace/punctuation that sits exactly on the boundary between the two
// (e.g. the document literally has "Name/Company: ____", but the model
// returns contextText "Name/Company:" and matchText "____" with the space
// dropped from both). Requiring byte-for-byte adjacency made that a hard
// failure; instead, once contextText is found, matchText is searched for in
// a small window right after it, tolerating a short gap in between.
function findAnchoredIndex(fullText, contextText, matchText, maxGap = 12) {
  if (!contextText) {
    const idx = fullText.indexOf(matchText);
    return idx === -1 ? null : idx;
  }
  const contextIndex = fullText.indexOf(contextText);
  if (contextIndex === -1) return null;
  const searchStart = contextIndex + contextText.length;
  const window = fullText.slice(searchStart, searchStart + matchText.length + maxGap);
  const offset = window.indexOf(matchText);
  return offset === -1 ? null : searchStart + offset;
}

// Pseudo-fields offered to the AI Builder alongside real Agreement/Account
// fields — these don't come from the object schema and never get resolved
// to real data. They mark where DocuSign should place its own fields when
// the document is later sent for signature (see AgreementDetailScreen's
// "Send for signature" and lib/docusign.js). "n" is the signer number (1
// or 2) DocuSign uses to match each anchor tag to a recipient.
const DOCUSIGN_AI_FIELDS = [1, 2].flatMap((n) => [
  { label: `Signature (Signer ${n})`, placeholder: `docusign.sig${n}` },
  { label: `Printed Name (Signer ${n})`, placeholder: `docusign.name${n}` },
  { label: `Title (Signer ${n})`, placeholder: `docusign.title${n}` },
  { label: `Date Signed (Signer ${n})`, placeholder: `docusign.date${n}` },
]);

// "docusign.sig1" -> "/sig1/", matching the literal anchor text DocuSign
// scans for (see lib/docusign.js sendEnvelopeForSignature).
function docusignAnchorTag(placeholder) {
  return `/${placeholder.replace('docusign.', '')}/`;
}

function replaceTextWithPlaceholder(root, matchText, field, contextText) {
  if (!root || !matchText) return false;

  const { nodes, fullText } = getPlainTextNodes(root);

  // For blank fill-in fields (a label followed by underscores/dots), the
  // blank run alone is often ambiguous — several identical-looking blanks
  // can exist for different fields. contextText (the label right before
  // it) disambiguates WHERE to look, but is never itself removed.
  const matchIndex = findAnchoredIndex(fullText, contextText, matchText);
  if (matchIndex === null) return false;
  const matchEnd = matchIndex + matchText.length;

  const startEntry = nodes.find((n) => matchIndex >= n.start && matchIndex < n.end);
  const endEntry = nodes.find((n) => matchEnd > n.start && matchEnd <= n.end);
  if (!startEntry || !endEntry) return false;

  const range = document.createRange();
  range.setStart(startEntry.node, matchIndex - startEntry.start);
  range.setEnd(endEntry.node, matchEnd - endEntry.start);
  range.deleteContents();

  const isDocusignTag = field.placeholder.startsWith('docusign.');
  const span = document.createElement('span');

  if (isDocusignTag) {
    // Deliberately a DIFFERENT class from 'tpl-placeholder': the merge
    // step that fills a template with real agreement data (see
    // AgreementDetailScreen's fillTemplateHtml) only ever touches
    // .tpl-placeholder spans, so this literal anchor text — which
    // DocuSign needs to find as-is in the final document — survives
    // generation completely untouched.
    span.className = 'tpl-docusign-tag';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-docusign-field', field.placeholder);
    span.textContent = docusignAnchorTag(field.placeholder);
    span.style.cssText =
      'background:#f4ecff; color:#7c3aed; border-radius:4px; padding:1px 5px; font-size:0.85em; font-weight:600;';
  } else {
    span.className = 'tpl-placeholder';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-field', field.placeholder);
    span.textContent = `{{${field.label}}}`;
  }

  range.insertNode(span);
  return true;
}

function BackIcon() {
  return (
    <svg className="tpl__back-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg className="aib__ai-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />
      <path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z" fill="currentColor" />
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

  const [meta, setMeta] = useState({ name: '', agreementType: '', agreementSubtype: '', language: 'English' });
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [directFields, setDirectFields] = useState([]);
  const [lookupGroups, setLookupGroups] = useState([]);
  const [expandedLookups, setExpandedLookups] = useState({});
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOverField, setDragOverField] = useState(false);

  // AI Builder modal
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState({});
  const [aiError, setAiError] = useState('');

  // Built-in configs
  const [typeOptions, setTypeOptions] = useState([]);
  const [subtypeOptions, setSubtypeOptions] = useState([]);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});

  const editableRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggedFieldRef = useRef(null);

  // Filtered subtypes based on selected type
  const filteredSubtypes = meta.agreementType && Object.keys(typeSubtypeMap).length > 0
    ? (typeSubtypeMap[meta.agreementType] || subtypeOptions)
    : subtypeOptions;

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      setTemplates(await listTemplates());
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
  }, [htmlContent, view]);

  const handleMetaChange = (e) => {
    const { name, value } = e.target;
    // Reset subtype when type changes
    if (name === 'agreementType') {
      setMeta((prev) => ({ ...prev, agreementType: value, agreementSubtype: '' }));
    } else {
      setMeta((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleStartNew = () => {
    setMeta({ name: '', agreementType: '', agreementSubtype: '', language: 'English' });
    setEditingTemplateId(null);
    setHtmlContent('');
    setFileName('');
    setError('');
    setView('setup');
  };

  // Opens an existing template straight in the document editor (skips the
  // setup step, since name/type/subtype/document already exist) — the
  // "Back" button from there still routes through setup if the user wants
  // to change those fields.
  const handleEditTemplate = async (template) => {
    setError('');
    setMeta({
      name: template.name || '',
      agreementType: template.agreementType || '',
      agreementSubtype: template.agreementSubtype || '',
      language: template.language || 'English',
    });
    setEditingTemplateId(template.id);
    setFileName(template.name ? `${template.name}.docx` : '');
    if (editableRef.current) delete editableRef.current.dataset.loaded;
    setHtmlContent(template.contentHtml || '');
    // Switch views in the same synchronous batch as setHtmlContent above —
    // the editable <div> only exists in the DOM once view === 'builder', so
    // if this were delayed until after the awaits below, htmlContent would
    // already have "changed" on a previous render with no element to load
    // it into, and the effect (keyed on htmlContent) wouldn't fire again.
    setView('builder');
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
  };

  const handleContinueToUpload = async (e) => {
    e.preventDefault();
    if (!meta.name.trim() || !meta.agreementType.trim() || !meta.agreementSubtype.trim()) {
      setError('Please fill in name, agreement type, and subtype.');
      return;
    }
    setError('');
    try {
      const [, configs, map] = await Promise.all([
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

  // Load configs on setup view mount
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

  // ---- AI Builder ----

  const handleOpenAIBuilder = async () => {
    setShowAIModal(true);
    setAiAnalyzing(true);
    setAiError('');
    setAiSuggestions([]);
    setSelectedSuggestions({});
    try {
      const documentText = editableRef.current ? getPlainTextNodes(editableRef.current).fullText.trim() : '';
      if (!documentText) {
        setAiError('The document looks empty — nothing to analyze.');
        return;
      }
      const fields = [...directFields, ...lookupGroups.flatMap((g) => g.fields), ...DOCUSIGN_AI_FIELDS];
      const rawSuggestions = await analyzeTemplateWithAI(documentText, fields);
      // eslint-disable-next-line no-console
      console.log('AI Builder — raw suggestions from Claude:', rawSuggestions);

      // Safety net against a hallucinated placeholder code or an altered
      // match string — only keep suggestions that can actually be located
      // in the document (same tolerant anchored search used at apply time).
      const fieldByPlaceholder = new Map(fields.map((f) => [f.placeholder, f]));
      const searchKeyOf = (s) => (s.contextText || '') + s.matchText;
      const seenSearchKey = new Set();
      const candidates = rawSuggestions.filter((s) => {
        if (!s || !s.matchText || !fieldByPlaceholder.has(s.placeholder)) return false;
        if (findAnchoredIndex(documentText, s.contextText, s.matchText) === null) return false;
        // Two suggestions pointing at the exact same spot can't both be
        // applied — the first one consumes it, so the second would
        // silently fail. Keep only the first.
        const key = searchKeyOf(s);
        if (seenSearchKey.has(key)) return false;
        seenSearchKey.add(key);
        return true;
      });

      // Drop any suggestion whose search key fully contains ANOTHER
      // suggestion's search key as a substring — that's almost always an
      // overly broad match (e.g. "Account Name" accidentally swallowing
      // the address text right next to it), which would silently "steal"
      // the text a more precise suggestion needs.
      const valid = candidates.filter(
        (s) => !candidates.some((other) => other !== s && searchKeyOf(s).includes(searchKeyOf(other)))
      );

      // eslint-disable-next-line no-console
      console.log(
        `AI Builder — raw: ${rawSuggestions.length}, passed validation: ${candidates.length}, after overlap filter: ${valid.length}`,
        { candidates, valid }
      );
      setAiSuggestions(valid);
      setSelectedSuggestions(Object.fromEntries(valid.map((_, i) => [i, true])));
      if (valid.length === 0) setAiError('No confident field matches found in this document.');
    } catch (err) {
      console.error('AI Builder failed:', err);
      setAiError(err.message || 'Something went wrong while analyzing the document.');
    } finally {
      setAiAnalyzing(false);
    }
  };

  const closeAIModal = () => {
    if (aiAnalyzing) return;
    setShowAIModal(false);
  };

  const toggleAISuggestion = (index) => {
    setSelectedSuggestions((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleApplyAISuggestions = () => {
    const editable = editableRef.current;
    if (!editable) return;

    const searchKeyOf = (s) => (s.contextText || '') + s.matchText;

    const selected = aiSuggestions
      .map((s, index) => ({ s, index }))
      .filter(({ index }) => selectedSuggestions[index])
      // Apply longer matches first so a short, generic phrase doesn't get
      // consumed before a longer match that contains it.
      .sort((a, b) => searchKeyOf(b.s).length - searchKeyOf(a.s).length);

    const failedLabels = [];
    selected.forEach(({ s }) => {
      const ok = replaceTextWithPlaceholder(editable, s.matchText, { placeholder: s.placeholder, label: s.label }, s.contextText);
      if (!ok) failedLabels.push(s.label);
    });

    setShowAIModal(false);
    if (failedLabels.length > 0) {
      alert(
        `Applied ${selected.length - failedLabels.length} of ${selected.length} selected suggestions.\n\n` +
        `Couldn't apply: ${failedLabels.join(', ')}.\n` +
        `This usually means that text was already used by another suggestion, or the document changed since analysis.`
      );
    }
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
      setEditingTemplateId(null);
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

  // ---- Views ----

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
              <div
                key={t.id}
                className="tpl__card"
                style={{ cursor: 'pointer' }}
                onClick={() => handleEditTemplate(t)}
                title="Click to edit this template"
              >
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
          <h2 className="tpl__title">{editingTemplateId ? 'Edit template' : 'New template'}</h2>
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

            <button type="submit" className="tpl__btn-primary tpl__btn-full">
              {editingTemplateId ? 'Continue to editor' : 'Continue to upload'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // view === 'builder'
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
        {htmlContent && (
          <button className="aib__ai-btn" onClick={handleOpenAIBuilder}>
            <SparkleIcon /> AI Builder
          </button>
        )}
        <button className="tpl__btn-primary" onClick={handleSave} disabled={saving || !htmlContent}>
          {saving ? 'Saving…' : editingTemplateId ? 'Save changes' : 'Save template'}
        </button>
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
            </div>

            <div className="tpl__sidebar-scroll">
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

      {/* AI Builder modal */}
      {showAIModal && (
        <div className="aib__backdrop" onClick={closeAIModal}>
          <div className="aib__modal" onClick={(e) => e.stopPropagation()}>
            <div className="aib__header">
              <h3 className="aib__title"><SparkleIcon /> AI Builder</h3>
              <p className="aib__subtitle">
                Claude scanned the document for phrases that look like they should be dynamic fields, matched
                against your Agreement and Account fields.
              </p>
            </div>

            <div className="aib__body">
              {aiAnalyzing ? (
                <div className="aib__loading">
                  <div className="aib__spinner" />
                  <span>Analyzing document…</span>
                </div>
              ) : (
                <>
                  {aiError && <p className="aib__error">{aiError}</p>}
                  {aiSuggestions.length === 0 && !aiError ? (
                    <p className="aib__empty">No suggestions.</p>
                  ) : (
                    aiSuggestions.map((s, index) => (
                      <div
                        key={`${s.placeholder}-${index}`}
                        className={`aib__suggestion ${selectedSuggestions[index] ? 'aib__suggestion--selected' : ''}`}
                        onClick={() => toggleAISuggestion(index)}
                      >
                        <input
                          type="checkbox"
                          className="aib__suggestion-checkbox"
                          checked={!!selectedSuggestions[index]}
                          onChange={() => toggleAISuggestion(index)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="aib__suggestion-body">
                          <span className="aib__suggestion-match">“{s.contextText ? `${s.contextText} ` : ''}{s.matchText}”</span>
                          <div className="aib__suggestion-arrow">
                            → <span className="aib__suggestion-field">{s.label}</span>
                          </div>
                          {s.reason && <span className="aib__suggestion-reason">{s.reason}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>

            <div className="aib__footer">
              <button type="button" className="aib__btn-secondary" onClick={closeAIModal} disabled={aiAnalyzing}>
                Cancel
              </button>
              <button
                type="button"
                className="aib__btn-primary"
                onClick={handleApplyAISuggestions}
                disabled={aiAnalyzing || aiSuggestions.length === 0}
              >
                Apply selected ({Object.values(selectedSuggestions).filter(Boolean).length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TemplateBuildScreen;