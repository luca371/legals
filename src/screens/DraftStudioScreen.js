import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  listAccounts,
  getObjectSchema,
  getBuiltInFieldConfigs,
  getTypeSubtypeMap,
  createAgreement,
  updateAgreement,
  addAgreementAttachment,
  generateAgreementDocument,
  MAX_ATTACHMENT_BYTES,
} from '../supabase';
import { indexObject } from '../embeddingsApi';
import { extractAgreementFieldsWithAI } from '../aiApi';
import { htmlToDocxBlob } from '../docxApi';
import { streamDraft, createDraftParser } from '../draftApi';
import { sanitizeDraftHtml, withCaret, splitBlocks, markChanged, htmlToPlainText } from '../draftHtml';
import { newEditState, registerEdit, buildBlocks, nextToType, typeMore } from '../draftEdits';
import './DraftStudioScreen.css';

const LANGUAGES = ['English', 'Romanian', 'French', 'German', 'Spanish'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EMPTY_FORM = {
  title: '',
  accountId: '',
  account2Id: '',
  agreementType: '',
  agreementSubtype: '',
  language: 'English',
  effectiveDate: '',
  endDate: '',
};

// A value the AI or the agent gave, kept only if it is one of the allowed
// options (matched ignoring case); with no options configured it is free text.
function matchOption(options, value) {
  if (!value) return '';
  if (!options.length) return String(value);
  const wanted = String(value).toLowerCase();
  return options.find((o) => String(o).toLowerCase() === wanted) || '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="draft__spark">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" fill="currentColor" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// What the page shows while edits are being typed in: untouched blocks as they
// were, blocks the agent wrote highlighted, and only the one being typed right
// now is partial (with the caret); new blocks after it wait for their turn.
function renderEditState(state) {
  const parts = [];
  let activeKey = null;
  buildBlocks(state).forEach((block) => {
    if (!block.isNew) {
      parts.push(block.html);
      return;
    }
    const typed = state.typed.get(block.key) ?? 0;
    if (typed >= block.html.length) {
      parts.push(markChanged(sanitizeDraftHtml(block.html)));
    } else if (!activeKey || activeKey === block.key) {
      activeKey = block.key;
      parts.push(withCaret(markChanged(sanitizeDraftHtml(block.html.slice(0, typed)))));
    }
  });
  return parts.join('');
}

let messageCounter = 0;
const nextId = () => `m${Date.now()}_${messageCounter++}`;

function DraftStudioScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  // "Start renewal" from an agreement: { id, title } of the agreement renewed.
  const [renewalOf, setRenewalOf] = useState(() => location.state?.renewalOf || null);

  const [accounts, setAccounts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(() => location.state?.prompt || '');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');

  // The paper: what has been received (target) is typed out onto the page at
  // a steady pace (shown), so it reads like live writing even when the text
  // arrives in bursts.
  const docTargetRef = useRef('');
  const docShownRef = useRef(0);
  const streamingRef = useRef(false);
  const docEndedRef = useRef(false);
  // Set while the agent is changing parts of the document instead of rewriting it.
  const editStateRef = useRef(null);
  const metaRef = useRef(null);
  const [shownHtml, setShownHtml] = useState('');
  const [writing, setWriting] = useState(false);
  const [hasDocument, setHasDocument] = useState(false);

  const [meta, setMeta] = useState(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // The "Agreement details" popup shown by Create agreement.
  const [showDetails, setShowDetails] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [customValues, setCustomValues] = useState({});
  const [aiFields, setAiFields] = useState(() => new Set()); // fields filled by the AI, shown with an "AI" tag
  const [extracting, setExtracting] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [typeOptions, setTypeOptions] = useState([]);
  const [subtypeOptions, setSubtypeOptions] = useState([]);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});
  const formRef = useRef(form);
  const customValuesRef = useRef(customValues);
  const touchedRef = useRef(new Set()); // fields the user edited themselves: the AI never overwrites those
  const languageKnownRef = useRef(false);
  const extractSessionRef = useRef(0);
  formRef.current = form;
  customValuesRef.current = customValues;

  const paperRef = useRef(null);
  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const abortRef = useRef(null);
  const breakBeforeChatRef = useRef(false);

  useEffect(() => {
    listAccounts().then(setAccounts).catch((err) => console.error('Failed to load accounts:', err));
    getObjectSchema('agreement').then(setCustomFieldDefs).catch((err) => console.error('Failed to load fields:', err));
    Promise.all([getBuiltInFieldConfigs('agreement'), getTypeSubtypeMap()])
      .then(([configs, map]) => {
        if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
        if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
        setTypeSubtypeMap(map || {});
      })
      .catch((err) => console.error('Failed to load agreement options:', err));
  }, []);

  useEffect(() => {
    if (!showDetails) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !creating) setShowDetails(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDetails, creating]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Typewriter: a little text per tick, more when far behind.
  useEffect(() => {
    const id = setInterval(() => {
      const edit = editStateRef.current;
      if (edit) {
        const next = nextToType(edit);
        if (next) {
          typeMore(edit, next);
          setShownHtml(renderEditState(edit));
        } else if (!streamingRef.current) {
          // everything typed and the answer is over: show the final document
          setShownHtml(renderEditState(edit));
          editStateRef.current = null;
          setWriting(false);
        }
        return;
      }
      const target = docTargetRef.current;
      const shown = docShownRef.current;
      if (shown >= target.length) {
        if (docEndedRef.current || !streamingRef.current) setWriting(false);
        return;
      }
      const backlog = target.length - shown;
      const next = Math.min(target.length, shown + Math.max(2, Math.ceil(backlog / 30)));
      docShownRef.current = next;
      setShownHtml(sanitizeDraftHtml(target.slice(0, next)));
    }, 30);
    return () => clearInterval(id);
  }, []);

  // Keep the line being written in view, unless the user scrolled up to read.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !writing) return;
    if (editStateRef.current) {
      // an edit: follow the block being typed, wherever it is in the document
      paperRef.current?.querySelector('.draft__caret')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const nearBottom = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight < 160;
    if (nearBottom) canvas.scrollTop = canvas.scrollHeight;
  }, [shownHtml, writing]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const suggestions = useMemo(() => {
    const a = accounts[0]?.name || 'Acme SRL';
    const b = accounts[1]?.name || 'Beta SRL';
    return [
      `Generate a mutual NDA between ${a} and ${b}`,
      'Draft a services agreement for 12 months, payment in 30 days',
      'Draft a supplier agreement governed by Romanian law',
    ];
  }, [accounts]);

  const currentDocumentHtml = () => {
    const paper = paperRef.current;
    if (!paper) return '';
    return sanitizeDraftHtml(paper.innerHTML);
  };

  const resetDocument = () => {
    docTargetRef.current = '';
    docShownRef.current = 0;
    setShownHtml('');
  };

  const handleSend = async (presetText) => {
    const content = (presetText ?? input).trim();
    if (!content || streaming) return;

    setInput('');
    setError('');

    const userMessage = { id: nextId(), role: 'user', text: content };
    const agentMessage = { id: nextId(), role: 'assistant', text: '' };
    const history = [...messages, userMessage];
    setMessages([...history, agentMessage]);

    // The document as numbered blocks, so the agent can answer a change request
    // with edits to just the blocks concerned.
    const baseBlocks = hasDocument ? splitBlocks(currentDocumentHtml()) : [];
    editStateRef.current = null;

    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    docEndedRef.current = false;
    setStreaming(true);
    breakBeforeChatRef.current = false;

    const appendChat = (text) =>
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== agentMessage.id) return m;
          let add = text;
          if (!m.text) add = add.replace(/^\s+/, '');
          else if (breakBeforeChatRef.current && add.trim()) add = `\n\n${add.replace(/^\s+/, '')}`;
          if (add.trim()) breakBeforeChatRef.current = false;
          return { ...m, text: m.text + add };
        })
      );

    const parser = createDraftParser({
      onChat: appendChat,
      onSources: (sources) =>
        setMessages((prev) => prev.map((m) => (m.id === agentMessage.id ? { ...m, sources } : m))),
      onDocEnd: () => {
        docEndedRef.current = true;
      },
      onEdit: ({ op, id, html }) => {
        if (!editStateRef.current) editStateRef.current = newEditState(baseBlocks);
        const state = editStateRef.current;
        const blocks = op === 'delete' ? [] : splitBlocks(sanitizeDraftHtml(html));
        if (!registerEdit(state, { op, id, blocks })) {
          console.warn('Ignored an edit that does not fit the document:', { op, id });
          return;
        }
        setWriting(true);
        setShownHtml(renderEditState(state));
      },
      onDocStart: () => {
        editStateRef.current = null;
        resetDocument();
        docEndedRef.current = false;
        setHasDocument(true);
        setWriting(true);
        metaRef.current = null;
        setMeta(null);
        breakBeforeChatRef.current = true;
      },
      onDoc: (text) => {
        docTargetRef.current += text;
      },
      onMeta: (m) => {
        // after an edit the agent only sends the fields that changed
        const merged = { ...(metaRef.current || {}), ...m };
        if (m?.title && m.title !== metaRef.current?.title) setTitle(String(m.title));
        metaRef.current = merged;
        setMeta(merged);
      },
      onError: (message) => setError(message || 'Something went wrong while drafting.'),
    });

    try {
      await streamDraft({
        messages: history.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text })),
        blocks: baseBlocks,
        renewalOfId: renewalOf?.id,
        onText: (chunk) => parser.push(chunk),
        signal: controller.signal,
      });
      parser.end();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Draft failed:', err);
        setError(err.message || 'Could not reach the drafting agent. Please try again.');
        setMessages((prev) => prev.filter((m) => !(m.id === agentMessage.id && !m.text)));
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleNewDraft = () => {
    setRenewalOf(null);
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
    setMessages([]);
    setError('');
    editStateRef.current = null;
    metaRef.current = null;
    setMeta(null);
    setTitle('');
    setHasDocument(false);
    setWriting(false);
    resetDocument();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredSubtypes = useMemo(() => {
    if (!form.agreementType) return subtypeOptions;
    if (Object.keys(typeSubtypeMap).length > 0) return typeSubtypeMap[form.agreementType] || subtypeOptions;
    return subtypeOptions;
  }, [form.agreementType, typeSubtypeMap, subtypeOptions]);

  const subtypesFor = (type) => {
    if (type && Object.keys(typeSubtypeMap).length > 0) return typeSubtypeMap[type] || subtypeOptions;
    return subtypeOptions;
  };

  // Create agreement opens the popup. What the drafting agent already worked out
  // (title, parties, type, language, dates) is filled in at once; the AI then
  // reads the document to fill in what is still empty, custom fields included.
  const openDetails = () => {
    const html = currentDocumentHtml();
    if (!html.trim() || creating) return;

    const first = accounts.find((a) => a.id === meta?.accountId);
    const second = accounts.find((a) => a.id === meta?.account2Id);
    const type = matchOption(typeOptions, meta?.agreementType);
    const subtype = matchOption(subtypesFor(type), meta?.agreementSubtype);
    const languageFromAgent = LANGUAGES.includes(meta?.language) ? meta.language : '';

    const initial = {
      title: title.trim() || (meta?.title ? String(meta.title) : ''),
      accountId: first?.id || '',
      account2Id: second?.id || '',
      agreementType: type,
      agreementSubtype: subtype,
      language: languageFromAgent || 'English',
      effectiveDate: meta?.effectiveDate || '',
      endDate: meta?.endDate || '',
    };

    touchedRef.current = new Set();
    languageKnownRef.current = Boolean(languageFromAgent);
    setForm(initial);
    setCustomValues({});
    setDetailsError('');
    setAiFields(
      new Set(
        Object.entries(initial)
          .filter(([key, value]) => value && !(key === 'language' && !languageFromAgent))
          .map(([key]) => key)
      )
    );
    setShowDetails(true);
    runFieldExtraction(html);
  };

  const runFieldExtraction = async (html) => {
    const session = ++extractSessionRef.current;
    const documentText = htmlToPlainText(html);
    if (!documentText) return;
    setExtracting(true);
    // A slow AI call must never hold the popup hostage: after 30s it just stops waiting.
    const timeoutId = setTimeout(() => {
      if (extractSessionRef.current === session) setExtracting(false);
    }, 30000);
    try {
      const extracted = await extractAgreementFieldsWithAI({
        documentText,
        accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
        agreementTypeOptions: typeOptions,
        agreementSubtypeOptions: subtypeOptions,
        customFieldDefs: customFieldDefs
          .filter((f) => f.type !== 'lookup')
          .map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options })),
      });
      if (extractSessionRef.current !== session) return;

      // Fill only what is empty and was not touched by the user (read from refs,
      // so edits made while the AI was thinking are respected).
      const filled = new Set();
      const current = formRef.current;
      const next = { ...current };
      const fillIf = (key, value) => {
        if (value && !current[key] && !touchedRef.current.has(key)) {
          next[key] = value;
          filled.add(key);
        }
      };
      fillIf('title', extracted.title);
      fillIf('accountId', accounts.some((a) => a.id === extracted.accountId) ? extracted.accountId : '');
      fillIf('agreementType', matchOption(typeOptions, extracted.agreementType));
      fillIf('agreementSubtype', matchOption(subtypesFor(next.agreementType), extracted.agreementSubtype));
      fillIf('effectiveDate', extracted.effectiveDate);
      fillIf('endDate', extracted.endDate);
      if (!languageKnownRef.current && !touchedRef.current.has('language') && LANGUAGES.includes(extracted.language)) {
        next.language = extracted.language;
        filled.add('language');
      }

      const nextCustom = { ...customValuesRef.current };
      Object.entries(extracted.customFields || {}).forEach(([id, value]) => {
        const key = `cf:${id}`;
        const empty = nextCustom[id] === undefined || nextCustom[id] === '';
        if (value !== '' && value != null && empty && !touchedRef.current.has(key)) {
          nextCustom[id] = value;
          filled.add(key);
        }
      });

      setForm(next);
      setCustomValues(nextCustom);
      setAiFields((prev) => new Set([...prev, ...filled]));
    } catch (err) {
      console.warn('AI field extraction failed (non-blocking):', err);
    } finally {
      clearTimeout(timeoutId);
      if (extractSessionRef.current === session) setExtracting(false);
    }
  };

  const closeDetails = () => {
    if (creating) return;
    extractSessionRef.current += 1; // drop a late AI answer
    setExtracting(false);
    setShowDetails(false);
  };

  // Editing a field makes it the user's: the AI tag goes and the AI will not overwrite it.
  const markEdited = (key) => {
    touchedRef.current.add(key);
    setAiFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    markEdited(name);
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'agreementType') {
        // a subtype that does not belong to the new type is dropped
        const allowed = subtypesFor(value);
        if (next.agreementSubtype && allowed.length > 0 && !allowed.includes(next.agreementSubtype)) next.agreementSubtype = '';
      }
      return next;
    });
  };

  const handleCustomFieldChange = (fieldId, value) => {
    markEdited(`cf:${fieldId}`);
    setCustomValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleConfirmCreate = async () => {
    const html = currentDocumentHtml();
    if (!html.trim() || creating) return;
    if (!form.title.trim()) {
      setDetailsError('Agreement title is required.');
      return;
    }
    setCreating(true);
    setDetailsError('');
    try {
      const first = accounts.find((a) => a.id === form.accountId);
      const second = accounts.find((a) => a.id === form.account2Id);
      const agreementTitle = form.title.trim();
      const customFields = Object.fromEntries(
        Object.entries(customValues).filter(([, value]) => value !== '' && value != null)
      );

      const created = await createAgreement({
        title: agreementTitle,
        accountId: first?.id || '',
        accountName: first?.name || '',
        account2Id: second?.id || '',
        account2Name: second?.name || '',
        agreementType: form.agreementType,
        agreementSubtype: form.agreementSubtype,
        language: LANGUAGES.includes(form.language) ? form.language : 'English',
        status: 'Draft',
        effectiveDate: form.effectiveDate,
        endDate: form.endDate,
        customFields,
        contentHtml: html,
      });

      if (renewalOf?.id) {
        try {
          await updateAgreement(created.id, { relatedAgreementId: renewalOf.id, relationType: 'renewal' });
        } catch (linkErr) {
          console.error('Could not link the renewal to the original agreement:', linkErr);
        }
      }

      // The Word file, like a document generated from a template, and the same
      // status change that flow makes: once the document is attached the
      // agreement becomes "Generated". The agreement exists already, so a
      // failure here must not stop the user from opening it (it then stays Draft).
      try {
        const docxBlob = await htmlToDocxBlob(
          `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
        );
        if (docxBlob.size <= MAX_ATTACHMENT_BYTES) {
          await addAgreementAttachment(created.id, {
            id: `att_${Date.now()}`,
            name: `${agreementTitle.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Agreement'}.docx`,
            size: docxBlob.size,
            mimeType: DOCX_MIME,
            dataBase64: await blobToBase64(docxBlob),
            sourceHtml: html,
            uploadedAt: new Date().toISOString(),
          });
          await generateAgreementDocument(created.id, {
            templateId: null,
            status: 'Generated',
            agreementTitle,
          });
        }
      } catch (attachErr) {
        console.error('Could not attach the Word file to the new agreement:', attachErr);
      }

      indexObject('agreement', created.id).catch((err) => console.warn('Background indexing failed:', err));
      navigate(`/dashboard/agreements/${created.id}`);
    } catch (err) {
      console.error('Failed to create the agreement:', err);
      setDetailsError('Could not create the agreement. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const aiTag = (key) => (aiFields.has(key) ? <span className="draft__ai-tag" title="Filled in by the AI - please check">AI</span> : null);
  const aiClass = (key) => (aiFields.has(key) ? ' draft__field-input--ai' : '');

  const renderCustomFieldInput = (field) => {
    const key = `cf:${field.id}`;
    const value = customValues[field.id] ?? '';
    const className = `draft__field-input${aiClass(key)}`;
    if (field.type === 'dropdown') {
      return (
        <select className={className} value={value} onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}>
          <option value="">- Select -</option>
          {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    return <input type={inputType} className={className} value={value} onChange={(e) => handleCustomFieldChange(field.id, e.target.value)} />;
  };

  const partyNames = [accounts.find((a) => a.id === meta?.accountId)?.name, accounts.find((a) => a.id === meta?.account2Id)?.name].filter(Boolean);
  const lastMessage = messages[messages.length - 1];
  const waitingForFirstWords = streaming && lastMessage?.role === 'assistant' && !lastMessage.text && !hasDocument;
  const paperHtml = writing ? withCaret(shownHtml) : shownHtml;

  return (
    <div className="draft">
      <section className="draft__stage">
        <div className="draft__toolbar">
          <input
            className="draft__title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={hasDocument ? 'Agreement title' : 'Untitled agreement'}
            disabled={!hasDocument}
            aria-label="Agreement title"
          />
          <div className="draft__chips">
            {meta?.agreementType && <span className="draft__chip">{meta.agreementType}{meta.agreementSubtype ? ` · ${meta.agreementSubtype}` : ''}</span>}
            {partyNames.length > 0 && <span className="draft__chip">{partyNames.join(' ↔ ')}</span>}
            {meta?.language && <span className="draft__chip">{meta.language}</span>}
            {writing && <span className="draft__chip draft__chip--live"><span className="draft__live-dot" /> Writing…</span>}
          </div>
          <button
            type="button"
            className="draft__btn-primary"
            onClick={openDetails}
            disabled={!hasDocument || writing || streaming || creating}
          >
            Create agreement
          </button>
        </div>

        <div className="draft__canvas" ref={canvasRef}>
          {!hasDocument ? (
            <div className="draft__paper draft__paper--empty">
              <SparkIcon />
              <p className="draft__empty-title">Your agreement will be written here</p>
              <p className="draft__empty-hint">Tell the agent what you need on the right, for example "Generate a mutual NDA between two of your accounts".</p>
            </div>
          ) : (
            <div
              ref={paperRef}
              className={`draft__paper ${writing ? 'draft__paper--writing' : 'draft__paper--ready'}`}
              contentEditable={!writing && !streaming}
              suppressContentEditableWarning
              spellCheck={false}
              dangerouslySetInnerHTML={{ __html: paperHtml }}
            />
          )}
          {hasDocument && !writing && (
            <p className="draft__paper-note">You can click on the page and edit it directly. AI-drafted text should be reviewed by a lawyer before use.</p>
          )}
        </div>
      </section>

      <aside className="draft__chat">
        <div className="draft__chat-header">
          <div className="draft__chat-title"><SparkIcon /> Draft agent</div>
          <button type="button" className="draft__link-btn" onClick={handleNewDraft} disabled={messages.length === 0}>New draft</button>
        </div>

        {renewalOf && (
          <p className="draft__renewal-note">
            Renewal of <strong>{renewalOf.title}</strong>. The agent starts from its text; the agreement you create is linked to it as its renewal.
          </p>
        )}
        <div className="draft__messages">
          {messages.length === 0 && (
            <div className="draft__welcome">
              <p className="draft__welcome-text">
                I write agreements for you. I can see your accounts, playbooks and approved clauses, so just say what you need.
              </p>
              <div className="draft__suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="draft__suggestion" onClick={() => handleSend(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            m.text || m.sources?.length ? (
              <div key={m.id} className="draft__msg">
                {m.sources?.length > 0 && (
                  <div className="draft__sources">
                    <span className="draft__sources-label">Looked at {m.sources.length === 1 ? 'a similar agreement' : `${m.sources.length} similar agreements`}</span>
                    {m.sources.map((s) => (
                      <a
                        key={s.id}
                        className="draft__source"
                        href={`/dashboard/agreements/${s.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title={s.status ? `Status: ${s.status}` : undefined}
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
                {m.text && <div className={`draft__bubble draft__bubble--${m.role}`}>{m.text}</div>}
              </div>
            ) : null
          ))}

          {waitingForFirstWords && (
            <div className="draft__bubble draft__bubble--assistant draft__typing" aria-label="The agent is thinking">
              <span /><span /><span />
            </div>
          )}

          {error && <p className="draft__error">{error}</p>}
          <div ref={chatEndRef} />
        </div>

        <div className="draft__composer">
          <textarea
            className="draft__input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasDocument ? 'Ask for a change, e.g. "make the term 2 years"' : 'Generate me an NDA between…'}
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" className="draft__btn-secondary" onClick={handleStop}>Stop</button>
          ) : (
            <button type="button" className="draft__btn-primary" onClick={() => handleSend()} disabled={!input.trim()}>Send</button>
          )}
        </div>
      </aside>

      {showDetails && (
        <div className="draft__modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDetails(); }}>
          <div className="draft__modal" role="dialog" aria-modal="true" aria-label="Agreement details">
            <div className="draft__modal-header">
              <h3 className="draft__modal-title">Agreement details</h3>
              {extracting ? (
                <p className="draft__modal-sub draft__modal-sub--busy"><SparkIcon /> The AI is reading the document and filling in the fields…</p>
              ) : aiFields.size > 0 ? (
                <p className="draft__modal-sub draft__modal-sub--ai"><SparkIcon /> {aiFields.size} {aiFields.size === 1 ? 'field was' : 'fields were'} filled in automatically. Please review them before creating.</p>
              ) : (
                <p className="draft__modal-sub">Check the details, then create the agreement.</p>
              )}
            </div>

            <div className="draft__modal-body">
              {detailsError && <p className="draft__error">{detailsError}</p>}
              <div className="draft__form-grid">
                <div className="draft__field draft__field--full">
                  <label className="draft__field-label" htmlFor="draft-title">Agreement title {aiTag('title')}</label>
                  <input id="draft-title" name="title" className={`draft__field-input${aiClass('title')}`} value={form.title} onChange={handleFieldChange} />
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-account">Account 1 {aiTag('accountId')}</label>
                  <select id="draft-account" name="accountId" className={`draft__field-input${aiClass('accountId')}`} value={form.accountId} onChange={handleFieldChange}>
                    <option value="">- Select account -</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-account2">Account 2 {aiTag('account2Id')}</label>
                  <select id="draft-account2" name="account2Id" className={`draft__field-input${aiClass('account2Id')}`} value={form.account2Id} onChange={handleFieldChange}>
                    <option value="">- Select account -</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-type">Agreement type {aiTag('agreementType')}</label>
                  {typeOptions.length > 0 ? (
                    <select id="draft-type" name="agreementType" className={`draft__field-input${aiClass('agreementType')}`} value={form.agreementType} onChange={handleFieldChange}>
                      <option value="">- Select type -</option>
                      {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id="draft-type" name="agreementType" className={`draft__field-input${aiClass('agreementType')}`} placeholder="e.g. NDA, MSA, SOW" value={form.agreementType} onChange={handleFieldChange} />
                  )}
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-subtype">Agreement subtype {aiTag('agreementSubtype')}</label>
                  {filteredSubtypes.length > 0 ? (
                    <select
                      id="draft-subtype"
                      name="agreementSubtype"
                      className={`draft__field-input${aiClass('agreementSubtype')}`}
                      value={form.agreementSubtype}
                      onChange={handleFieldChange}
                      disabled={typeOptions.length > 0 && !form.agreementType}
                    >
                      <option value="">- Select subtype -</option>
                      {filteredSubtypes.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      id="draft-subtype"
                      name="agreementSubtype"
                      className={`draft__field-input${aiClass('agreementSubtype')}`}
                      placeholder="e.g. Mutual, One-way"
                      value={form.agreementSubtype}
                      onChange={handleFieldChange}
                    />
                  )}
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-language">Language {aiTag('language')}</label>
                  <select id="draft-language" name="language" className={`draft__field-input${aiClass('language')}`} value={form.language} onChange={handleFieldChange}>
                    {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-start">Start date {aiTag('effectiveDate')}</label>
                  <input id="draft-start" name="effectiveDate" type="date" className={`draft__field-input${aiClass('effectiveDate')}`} value={form.effectiveDate} onChange={handleFieldChange} />
                </div>

                <div className="draft__field">
                  <label className="draft__field-label" htmlFor="draft-end">End date {aiTag('endDate')}</label>
                  <input id="draft-end" name="endDate" type="date" className={`draft__field-input${aiClass('endDate')}`} value={form.endDate} onChange={handleFieldChange} />
                </div>

                {customFieldDefs.filter((f) => f.type !== 'lookup').map((field) => (
                  <div key={field.id} className="draft__field">
                    <label className="draft__field-label">{field.label} {aiTag(`cf:${field.id}`)}</label>
                    {renderCustomFieldInput(field)}
                  </div>
                ))}
              </div>
            </div>

            <div className="draft__modal-actions">
              <button type="button" className="draft__btn-secondary" onClick={closeDetails} disabled={creating}>Cancel</button>
              <button type="button" className="draft__btn-primary" onClick={handleConfirmCreate} disabled={creating}>
                {creating ? 'Creating…' : 'Create agreement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DraftStudioScreen;
