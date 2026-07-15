import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import htmlDocx from 'html-docx-js/dist/html-docx';
import mammoth from 'mammoth';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  getAgreement,
  updateAgreement,
  deleteAgreement,
  getObjectSchema,
  getBuiltInFieldConfigs,
  getTypeSubtypeMap,
  listAccounts,
  getAccount,
  listTemplates,
  generateAgreementDocument,
  updateAgreementStatus,
  addAgreementAttachment,
  deleteAgreementAttachment,
  connectMicrosoftGraph,
  addReviewSession,
  updateReviewSession,
  createApprovalRequest,
  listApprovalRequestsForAgreement,
  addDocusignEnvelope,
  updateDocusignEnvelope,
} from '../firebase';
import { sendForSignature, getSignatureStatus, getSignedDocument } from '../docusignApi';
import {
  uploadFileToOneDrive,
  shareFileForReview,
  downloadFileFromOneDrive,
  deleteFileFromOneDrive,
} from '../graphApi';
import { sendApprovalEmail, sendActivationEmail } from '../emailApi';
import { reviewAgreementWithAI } from '../reviewApi';
import './AgreementDetailScreen.css';
import './ReviewModal.css';

const PIPELINE_STATUSES = [
  'Draft', 'Generated', 'Import offline', 'In review', 'Reviewed',
  'In approval', 'Approved', 'Pending signatures', 'Signed', 'Activated',
];

const DEFAULT_STATUSES = PIPELINE_STATUSES;
const LANGUAGES = ['English', 'Romanian', 'French', 'German', 'Spanish'];

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__back-icon">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__nav-icon">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AttachmentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__nav-icon">
      <path d="M21 11.5l-9.5 9.5a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.5 5.5l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__attachment-icon">
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="arv__sparkle-icon">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />
      <path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z" fill="currentColor" />
    </svg>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MAX_ATTACHMENT_BYTES = 650 * 1024;

function resolvePlaceholderValue(fieldKey, { agreement, account, template }) {
  if (!fieldKey) return '';
  const parts = fieldKey.split('.');

  if (parts.length === 2 && parts[0] === 'agreement') {
    return agreement[parts[1]] ?? (agreement.customFields || {})[parts[1]] ?? '';
  }
  if (parts.length === 2 && parts[0] === 'template') {
    return template ? (template[parts[1]] ?? '') : '';
  }
  if (parts.length === 2) {
    if (!account) return '';
    return account[parts[1]] ?? (account.customFields || {})[parts[1]] ?? '';
  }
  return (agreement.customFields || {})[fieldKey] ?? '';
}

function fillTemplateHtml(html, context) {
  const container = document.createElement('div');
  container.innerHTML = html || '';
  container.querySelectorAll('.tpl-placeholder').forEach((span) => {
    const fieldKey = span.getAttribute('data-field') || '';
    const value = resolvePlaceholderValue(fieldKey, context);
    span.replaceWith(document.createTextNode(value === null || value === undefined ? '' : String(value)));
  });
  return container.innerHTML;
}

function wrapAsHtmlDocument(bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;
}

function sanitizeFileName(name) {
  return (name || 'Agreement').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Agreement';
}

function buildRedlineFileName(originalName) {
  const base = (originalName || 'Document').replace(/\.docx$/i, '');
  return `${base} - Redlines.docx`;
}

function computeAdvancedStatus(currentStatus, targetStatus) {
  const currentIndex = PIPELINE_STATUSES.indexOf(currentStatus);
  const targetIndex = PIPELINE_STATUSES.indexOf(targetStatus);
  if (targetIndex === -1) return null;
  if (currentIndex === -1 || targetIndex > currentIndex) return targetStatus;
  return null;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function base64ToArrayBuffer(base64) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

async function attachmentToMergeHtml(attachment) {
  if (attachment.sourceHtml) return attachment.sourceHtml;
  const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

async function attachmentToPlainText(attachment) {
  if (attachment.sourceHtml) {
    const div = document.createElement('div');
    div.innerHTML = attachment.sourceHtml;
    return (div.innerText || div.textContent || '').trim();
  }
  if (attachment.dataBase64) {
    const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result.value || '').trim();
  }
  return '';
}

function describeEmailError(err) {
  if (err?.text) return `${err.text}${err.status ? ` (${err.status})` : ''}`;
  if (err?.message) return err.message;
  return 'unknown error';
}

function attachmentToDocusignPayload(attachment) {
  if (attachment.dataBase64) {
    const ext = (attachment.name || '').split('.').pop() || 'docx';
    return { documentBase64: attachment.dataBase64, fileExtension: ext };
  }
  if (attachment.sourceHtml) {
    const base64 = btoa(unescape(encodeURIComponent(attachment.sourceHtml)));
    return { documentBase64: base64, fileExtension: 'html' };
  }
  return null;
}

function buildMergedHtml(htmlParts) {
  return htmlParts
    .map((html, idx) => (idx === 0 ? html : `<div style="page-break-before: always;"></div>${html}`))
    .join('\n');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function exportHtmlAsPdf(html, fileName) {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.zIndex = '-1000';
  container.style.width = '750px';
  container.style.background = '#ffffff';
  container.style.padding = '24px';
  container.style.boxSizing = 'border-box';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(fileName);
  } finally {
    document.body.removeChild(container);
  }
}

function AgreementDetailScreen() {
  const { agreementId } = useParams();
  const navigate = useNavigate();

  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeNav, setActiveNav] = useState('details');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [customValues, setCustomValues] = useState({});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [statusOptions, setStatusOptions] = useState(DEFAULT_STATUSES);
  const [typeOptions, setTypeOptions] = useState([]);
  const [subtypeOptions, setSubtypeOptions] = useState([]);
  const [typeSubtypeMap, setTypeSubtypeMap] = useState({});

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [loadingGenTemplates, setLoadingGenTemplates] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const importFileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedMergeIds, setSelectedMergeIds] = useState([]);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewAttachmentId, setReviewAttachmentId] = useState('');
  const [reviewRecipients, setReviewRecipients] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [sendingReview, setSendingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [fetchingSessionId, setFetchingSessionId] = useState('');
  const [copiedSessionId, setCopiedSessionId] = useState('');

  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAttachmentId, setApprovalAttachmentId] = useState('');
  const [approverEmail, setApproverEmail] = useState('');
  const [approverName, setApproverName] = useState('');
  const [approvalMessage, setApprovalMessage] = useState('');
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [copiedApprovalId, setCopiedApprovalId] = useState('');

  const [showReviewAIModal, setShowReviewAIModal] = useState(false);
  const [aiReviewAttachmentId, setAiReviewAttachmentId] = useState('');
  const [reviewingAI, setReviewingAI] = useState(false);
  const [aiReview, setAiReview] = useState(null);
  const [reviewAIError, setReviewAIError] = useState('');

  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureAttachmentId, setSignatureAttachmentId] = useState('');
  const [signer1Name, setSigner1Name] = useState('');
  const [signer1Email, setSigner1Email] = useState('');
  const [includeSecondSigner, setIncludeSecondSigner] = useState(false);
  const [signer2Name, setSigner2Name] = useState('');
  const [signer2Email, setSigner2Email] = useState('');
  const [signatureMessage, setSignatureMessage] = useState('');
  const [sendingSignature, setSendingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [refreshingEnvelopeId, setRefreshingEnvelopeId] = useState('');

  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateNotifyName, setActivateNotifyName] = useState('');
  const [activateNotifyEmail, setActivateNotifyEmail] = useState('');
  const [activateMessage, setActivateMessage] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState('');

  const filteredSubtypes = useMemo(() => {
    if (!form?.agreementType) return subtypeOptions;
    if (Object.keys(typeSubtypeMap).length > 0) {
      return typeSubtypeMap[form.agreementType] || subtypeOptions;
    }
    return subtypeOptions;
  }, [form?.agreementType, typeSubtypeMap, subtypeOptions]);

  const load = async () => {
    setLoading(true);
    try {
      const [agr, schema, accs, configs, map, approvals] = await Promise.all([
        getAgreement(agreementId),
        getObjectSchema('agreement'),
        listAccounts(),
        getBuiltInFieldConfigs('agreement'),
        getTypeSubtypeMap(),
        listApprovalRequestsForAgreement(agreementId),
      ]);
      if (!agr) {
        setNotFound(true);
      } else {
        setAgreement(agr);
        setCustomFieldDefs(schema);
        setAccounts(accs);
        setTypeSubtypeMap(map);
        setApprovalRequests(approvals);
        if (configs.status?.length) setStatusOptions(configs.status);
        if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
        if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
      }
    } catch (err) {
      console.error('Failed to load agreement:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!agreementId) return;
    load();
  }, [agreementId]);

  const pipelineIndex = PIPELINE_STATUSES.indexOf(agreement?.status || 'Draft');

  const handleStartEdit = () => {
    setForm({
      title: agreement.title || '',
      accountId: agreement.accountId || '',
      accountName: agreement.accountName || '',
      agreementType: agreement.agreementType || '',
      agreementSubtype: agreement.agreementSubtype || '',
      language: agreement.language || 'English',
      status: agreement.status || 'Draft',
      effectiveDate: agreement.effectiveDate || '',
      endDate: agreement.endDate || '',
    });
    setCustomValues(agreement.customFields || {});
    setError('');
    setEditing(true);
  };

  const handleCancelEdit = () => { setEditing(false); setForm(null); };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'accountId') {
      const acc = accounts.find((a) => a.id === value);
      setForm((prev) => ({ ...prev, accountId: value, accountName: acc?.name || '' }));
    } else if (name === 'agreementType') {
      setForm((prev) => ({ ...prev, agreementType: value, agreementSubtype: '' }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCustomChange = (fieldId, value) => setCustomValues((prev) => ({ ...prev, [fieldId]: value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) { setError('Agreement title is required.'); return; }
    setSaving(true);
    try {
      await updateAgreement(agreementId, { ...form, customFields: customValues });
      setEditing(false);
      await load();
    } catch (err) {
      console.error('Failed to save agreement:', err);
      setError('Something went wrong while saving.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete agreement "${agreement.title}"? This can't be undone.`)) return;
    try {
      await deleteAgreement(agreementId);
      navigate('/dashboard/agreements');
    } catch (err) {
      console.error('Failed to delete agreement:', err);
      alert('Could not delete the agreement. Please try again.');
    }
  };

  const openGenerateModal = async () => {
    setShowGenerateModal(true);
    setGenerateError('');
    setSelectedTemplateId('');
    setLoadingGenTemplates(true);
    try {
      const all = await listTemplates();
      const matching = all.filter(
        (t) => t.agreementType === agreement.agreementType && t.agreementSubtype === agreement.agreementSubtype
      );
      setAvailableTemplates(matching);
    } catch (err) {
      console.error('Failed to load templates:', err);
      setGenerateError('Could not load templates. Please try again.');
    } finally {
      setLoadingGenTemplates(false);
    }
  };

  const closeGenerateModal = () => {
    if (generating) return;
    setShowGenerateModal(false);
  };

  const handleGenerate = async () => {
    const template = availableTemplates.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    setGenerating(true);
    setGenerateError('');
    try {
      let account = null;
      if (agreement.accountId) {
        account = await getAccount(agreement.accountId);
      }
      const filledHtml = fillTemplateHtml(template.contentHtml, { agreement, account, template });
      const docxBlob = htmlDocx.asBlob(wrapAsHtmlDocument(filledHtml));

      if (docxBlob.size > MAX_ATTACHMENT_BYTES) {
        setGenerateError(
          `The generated document is too large (${formatFileSize(docxBlob.size)}) to store. Try a shorter template.`
        );
        return;
      }

      const dataBase64 = await blobToBase64(docxBlob);
      const attachment = {
        id: `att_${Date.now()}`,
        name: `${sanitizeFileName(agreement.title)}.docx`,
        size: docxBlob.size,
        mimeType: DOCX_MIME,
        dataBase64,
        sourceHtml: filledHtml,
        uploadedAt: new Date().toISOString(),
      };

      await addAgreementAttachment(agreementId, attachment);
      await generateAgreementDocument(agreementId, {
        templateId: template.id,
        status: computeAdvancedStatus(agreement.status, 'Generated') || agreement.status,
      });

      setShowGenerateModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to generate agreement:', err);
      setGenerateError('Something went wrong while generating the document.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadAttachment = (attachment) => {
    try {
      const blob = base64ToBlob(attachment.dataBase64, attachment.mimeType || DOCX_MIME);
      downloadBlob(blob, attachment.name || 'document.docx');
    } catch (err) {
      console.error('Failed to download attachment:', err);
      alert('Could not download this file.');
    }
  };

  const handleDeleteAttachment = async (attachment) => {
    if (!window.confirm(`Remove "${attachment.name}"?`)) return;
    try {
      await deleteAgreementAttachment(agreementId, attachment.id);
      await load();
    } catch (err) {
      console.error('Failed to remove attachment:', err);
      alert('Could not remove the attachment. Please try again.');
    }
  };

  const handleImportClick = () => {
    setImportError('');
    importFileInputRef.current?.click();
  };

  const handleImportFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; 
    if (files.length === 0) return;

    setImporting(true);
    setImportError('');
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setImportError(`"${file.name}" is too large (${formatFileSize(file.size)}) to attach.`);
          continue;
        }
        const dataBase64 = await blobToBase64(file);
        const isDocx = /\.docx$/i.test(file.name);
        const attachment = {
          id: `att_${Date.now()}_${file.name}`,
          name: file.name,
          size: file.size,
          mimeType: isDocx ? DOCX_MIME : (file.type || 'application/octet-stream'),
          dataBase64,
          uploadedAt: new Date().toISOString(),
        };
        await addAgreementAttachment(agreementId, attachment);
      }
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to import file:', err);
      setImportError('Something went wrong while importing the file.');
    } finally {
      setImporting(false);
    }
  };

  const isDocxAttachment = (att) => att.mimeType === DOCX_MIME || /\.docx$/i.test(att.name || '');

  const mergeableAttachments = useMemo(
    () => (agreement?.attachments || []).filter(isDocxAttachment),
    [agreement]
  );
  const nonMergeableAttachments = useMemo(
    () => (agreement?.attachments || []).filter((a) => !isDocxAttachment(a)),
    [agreement]
  );

  const reviewableAttachments = useMemo(
    () => mergeableAttachments.filter((a) => !a.sourceHtml),
    [mergeableAttachments]
  );

  const openMergeModal = () => {
    setShowMergeModal(true);
    setMergeError('');
    setSelectedMergeIds([]);
  };

  const closeMergeModal = () => {
    if (merging) return;
    setShowMergeModal(false);
  };

  const toggleMergeSelection = (id) => {
    setSelectedMergeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const moveMergeItem = (index, direction) => {
    setSelectedMergeIds((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleMergeExport = async (format) => {
    if (selectedMergeIds.length === 0) return;
    setMerging(true);
    setMergeError('');
    try {
      const attachmentsById = new Map((agreement.attachments || []).map((a) => [a.id, a]));
      const htmlParts = [];
      for (const id of selectedMergeIds) {
        const att = attachmentsById.get(id);
        if (!att) continue;
        htmlParts.push(await attachmentToMergeHtml(att));
      }
      const mergedHtml = buildMergedHtml(htmlParts);
      const fileBase = `${sanitizeFileName(agreement.title)} - Merged`;

      if (format === 'word') {
        const blob = htmlDocx.asBlob(wrapAsHtmlDocument(mergedHtml));
        downloadBlob(blob, `${fileBase}.docx`);
      } else {
        await exportHtmlAsPdf(mergedHtml, `${fileBase}.pdf`);
      }
      setShowMergeModal(false);
    } catch (err) {
      console.error('Failed to merge files:', err);
      setMergeError('Something went wrong while merging the files.');
    } finally {
      setMerging(false);
    }
  };

  const openReviewModal = () => {
    setShowReviewModal(true);
    setReviewError('');
    setReviewAttachmentId('');
    setReviewRecipients('');
    setReviewMessage('');
  };

  const closeReviewModal = () => {
    if (sendingReview) return;
    setShowReviewModal(false);
  };

  const handleSendToReview = async () => {
    const attachment = reviewableAttachments.find((a) => a.id === reviewAttachmentId);
    if (!attachment) {
      setReviewError('Select a document to send.');
      return;
    }
    const recipients = reviewRecipients
      .split(/[,;]/)
      .map((email) => email.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      setReviewError('Enter at least one recipient email.');
      return;
    }

    setSendingReview(true);
    setReviewError('');
    try {
      const { accessToken } = await connectMicrosoftGraph();

      const blob = base64ToBlob(attachment.dataBase64, DOCX_MIME);
      const uploaded = await uploadFileToOneDrive(accessToken, attachment.name, blob);
      await shareFileForReview(accessToken, uploaded.id, recipients, reviewMessage);

      await addReviewSession(agreementId, {
        id: `rev_${Date.now()}`,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        oneDriveItemId: uploaded.id,
        webUrl: uploaded.webUrl,
        sentTo: recipients,
        message: reviewMessage,
        sentAt: new Date().toISOString(),
        status: 'In review',
      });

      const advancedStatus = computeAdvancedStatus(agreement.status, 'In review');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      setShowReviewModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to send document for review:', err);
      setReviewError('Something went wrong while sending the document for review. Please try again.');
    } finally {
      setSendingReview(false);
    }
  };

  const handleFetchRedlines = async (session) => {
    setFetchingSessionId(session.id);
    setReviewError('');
    try {
      const { accessToken } = await connectMicrosoftGraph();
      const blob = await downloadFileFromOneDrive(accessToken, session.oneDriveItemId);
      const dataBase64 = await blobToBase64(blob);

      const redlineAttachment = {
        id: `att_${Date.now()}`,
        name: buildRedlineFileName(session.attachmentName),
        size: blob.size,
        mimeType: DOCX_MIME,
        dataBase64,
        uploadedAt: new Date().toISOString(),
      };
      await addAgreementAttachment(agreementId, redlineAttachment);
      await updateReviewSession(agreementId, session.id, { status: 'Completed' });

      const advancedStatus = computeAdvancedStatus(agreement.status, 'Reviewed');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      // OneDrive is just the transient workbench — clean up now that the
      // redlined copy lives back in Firebase.
      try {
        await deleteFileFromOneDrive(accessToken, session.oneDriveItemId);
      } catch (cleanupErr) {
        console.warn('Could not delete the OneDrive working copy (non-blocking):', cleanupErr);
      }

      await load();
    } catch (err) {
      console.error('Failed to fetch the reviewed document:', err);
      alert('Could not fetch the reviewed document. Please try again.');
    } finally {
      setFetchingSessionId('');
    }
  };

  const handleCopyReviewLink = async (session) => {
    try {
      await navigator.clipboard.writeText(session.webUrl);
      setCopiedSessionId(session.id);
      setTimeout(() => setCopiedSessionId(''), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      window.prompt('Copy this link:', session.webUrl);
    }
  };

  const openApprovalModal = () => {
    setShowApprovalModal(true);
    setApprovalError('');
    setApprovalAttachmentId('');
    setApproverEmail('');
    setApproverName('');
    setApprovalMessage('');
  };

  const closeApprovalModal = () => {
    if (sendingApproval) return;
    setShowApprovalModal(false);
  };

  const handleSendForApproval = async () => {
    const email = approverEmail.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setApprovalError('Enter a valid approver email.');
      return;
    }
    const attachment = (agreement.attachments || []).find((a) => a.id === approvalAttachmentId) || null;

    setSendingApproval(true);
    setApprovalError('');
    try {
      const approvalId = await createApprovalRequest({
        agreementId,
        agreementTitle: agreement.title,
        attachment,
        approverEmail: email,
        approverName,
        message: approvalMessage,
      });

      const approvalLink = `${window.location.origin}/approve/${approvalId}`;
      const currentUser = agreement.createdBy || 'Legal Space';

      try {
        await sendApprovalEmail({
          toEmail: email,
          toName: approverName,
          fromName: currentUser,
          agreementTitle: agreement.title,
          message: approvalMessage,
          approvalLink,
        });
      } catch (emailErr) {
        console.error('Failed to send the approval email:', emailErr);
        setApprovalError(
          `The approval request was created, but the email could not be sent. Share this link manually: ${approvalLink}`
        );
        await load();
        return;
      }

      const advancedStatus = computeAdvancedStatus(agreement.status, 'In approval');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      setShowApprovalModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to send for approval:', err);
      setApprovalError('Something went wrong while sending the approval request.');
    } finally {
      setSendingApproval(false);
    }
  };

  const handleCopyApprovalLink = async (request) => {
    const link = `${window.location.origin}/approve/${request.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedApprovalId(request.id);
      setTimeout(() => setCopiedApprovalId(''), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      window.prompt('Copy this link:', link);
    }
  };

  const handleOpenReviewAI = () => {
    setShowReviewAIModal(true);
    setReviewAIError('');
    setAiReview(null);
    const attachments = agreement.attachments || [];
    if (attachments.length === 0) {
      setAiReviewAttachmentId('');
      setReviewAIError('This agreement has no attached document to review yet.');
    } else if (attachments.length === 1) {
      setAiReviewAttachmentId(attachments[0].id);
    } else {
      setAiReviewAttachmentId('ALL');
    }
  };

  const closeReviewAIModal = () => {
    if (reviewingAI) return;
    setShowReviewAIModal(false);
  };

  // ---- Send for signature (DocuSign) ----

  const openSignatureModal = () => {
    setShowSignatureModal(true);
    setSignatureError('');
    setSigner1Name('');
    setSigner1Email('');
    setIncludeSecondSigner(false);
    setSigner2Name('');
    setSigner2Email('');
    setSignatureMessage('');
    const attachments = agreement.attachments || [];
    setSignatureAttachmentId(attachments.length === 1 ? attachments[0].id : '');
  };

  const closeSignatureModal = () => {
    if (sendingSignature) return;
    setShowSignatureModal(false);
  };

  const handleSendForSignature = async () => {
    const isValidSigner = (name, email) => name.trim() && /^\S+@\S+\.\S+$/.test(email.trim());

    if (!signatureAttachmentId) {
      setSignatureError('Choose a document to send.');
      return;
    }
    if (!isValidSigner(signer1Name, signer1Email)) {
      setSignatureError('Enter a valid name and email for the first signer.');
      return;
    }
    if (includeSecondSigner && !isValidSigner(signer2Name, signer2Email)) {
      setSignatureError('Enter a valid name and email for the second signer.');
      return;
    }

    const attachment = (agreement.attachments || []).find((a) => a.id === signatureAttachmentId);
    const payload = attachment && attachmentToDocusignPayload(attachment);
    if (!payload) {
      setSignatureError('Could not read that document — try a different attachment.');
      return;
    }

    const signers = [{ name: signer1Name.trim(), email: signer1Email.trim() }];
    if (includeSecondSigner) {
      signers.push({ name: signer2Name.trim(), email: signer2Email.trim() });
    }

    setSendingSignature(true);
    setSignatureError('');
    try {
      const envelope = await sendForSignature({
        documentBase64: payload.documentBase64,
        documentName: attachment.name,
        fileExtension: payload.fileExtension,
        signers,
        emailSubject: `Please sign: ${agreement.title}`,
        emailMessage: signatureMessage,
      });

      await addDocusignEnvelope(agreementId, {
        envelopeId: envelope.envelopeId,
        attachmentName: attachment.name,
        signers,
        status: envelope.status || 'sent',
        sentAt: new Date().toISOString(),
      });

      const advancedStatus = computeAdvancedStatus(agreement.status, 'Pending signatures');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      setShowSignatureModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to send for signature:', err);
      setSignatureError(err.message || 'Something went wrong while sending for signature.');
    } finally {
      setSendingSignature(false);
    }
  };

  const handleRefreshEnvelopeStatus = async (envelopeId) => {
    setRefreshingEnvelopeId(envelopeId);
    try {
      const status = await getSignatureStatus(envelopeId);
      const patch = { status: status.status };

      const envelope = (agreement.docusignEnvelopes || []).find((e) => e.envelopeId === envelopeId);

      if (status.status === 'completed') {
        patch.completedAt = new Date().toISOString();

        if (!envelope?.signedAttachmentId) {
          const signedDoc = await getSignedDocument(envelopeId);
          const baseName = (envelope?.attachmentName || 'document').replace(/\.[^./]+$/, '');
          const signedAttachment = {
            id: `att_${Date.now()}`,
            name: `${baseName} - signed.pdf`,
            size: Math.round((signedDoc.dataBase64.length * 3) / 4),
            mimeType: signedDoc.mimeType,
            dataBase64: signedDoc.dataBase64,
            uploadedAt: new Date().toISOString(),
          };
          await addAgreementAttachment(agreementId, signedAttachment);
          patch.signedAttachmentId = signedAttachment.id;
        }
      }

      await updateDocusignEnvelope(agreementId, envelopeId, patch);

      if (status.status === 'completed') {
        const advancedStatus = computeAdvancedStatus(agreement.status, 'Signed');
        if (advancedStatus) {
          await updateAgreementStatus(agreementId, advancedStatus);
        }
      }

      await load();
    } catch (err) {
      console.error('Failed to refresh envelope status:', err);
      alert(`Could not refresh status: ${err.message}`);
    } finally {
      setRefreshingEnvelopeId('');
    }
  };

  const openActivateModal = () => {
    setShowActivateModal(true);
    setActivateError('');
    setActivateNotifyName('');
    setActivateNotifyEmail('');
    setActivateMessage('');
  };

  const closeActivateModal = () => {
    if (activating) return;
    setShowActivateModal(false);
  };

  const handleActivate = async () => {
    const email = activateNotifyEmail.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setActivateError('Enter a valid email, or leave it empty to skip notifying anyone.');
      return;
    }

    setActivating(true);
    setActivateError('');
    let emailWarning = '';
    try {
      if (email) {
        const recordLink = `${window.location.origin}/dashboard/agreements/${agreementId}`;
        try {
          await sendActivationEmail({
            toEmail: email,
            toName: activateNotifyName,
            fromName: agreement.createdBy,
            agreementTitle: agreement.title,
            message: activateMessage,
            recordLink,
          });
        } catch (emailErr) {
          console.error('Failed to send the activation email:', emailErr);
          emailWarning = `Couldn't send the notification email (${describeEmailError(emailErr)}), but the agreement was still activated.`;
        }
      }

      const advancedStatus = computeAdvancedStatus(agreement.status, 'Activated');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      await load();
      if (emailWarning) {
        setActivateError(emailWarning);
      } else {
        setShowActivateModal(false);
      }
    } catch (err) {
      console.error('Failed to activate agreement:', err);
      setActivateError(err.message || 'Something went wrong while activating the agreement.');
    } finally {
      setActivating(false);
    }
  };

  const handleRunReviewAI = async () => {
    if (!aiReviewAttachmentId) return;
    setReviewingAI(true);
    setReviewAIError('');
    setAiReview(null);
    try {
      const attachments = agreement.attachments || [];
      const targets =
        aiReviewAttachmentId === 'ALL' ? attachments : attachments.filter((a) => a.id === aiReviewAttachmentId);

      const texts = await Promise.all(
        targets.map(async (att) => ({ name: att.name, text: await attachmentToPlainText(att) }))
      );
      const documentText = texts
        .filter((t) => t.text)
        .map((t) => `--- ${t.name} ---\n${t.text}`)
        .join('\n\n')
        .slice(0, 20000);

      if (!documentText.trim()) {
        setReviewAIError('Could not extract any readable text from the selected document(s).');
        return;
      }

      const metadata = {
        title: agreement.title,
        accountName: agreement.accountName,
        agreementType: agreement.agreementType,
        agreementSubtype: agreement.agreementSubtype,
        status: agreement.status,
        effectiveDate: agreement.effectiveDate,
        endDate: agreement.endDate,
      };

      const review = await reviewAgreementWithAI(documentText, metadata);
      setAiReview(review);
    } catch (err) {
      console.error('AI review failed:', err);
      setReviewAIError(err.message || 'Something went wrong while reviewing the agreement.');
    } finally {
      setReviewingAI(false);
    }
  };

  const renderCustomFieldInput = (field) => {
    const value = customValues[field.id] ?? '';
    if (field.type === 'dropdown') {
      return (
        <select className="agrd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)}>
          <option value="">— Select —</option>
          {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (field.type === 'number') return <input type="number" className="agrd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    if (field.type === 'date') return <input type="date" className="agrd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
    return <input type="text" className="agrd__input" value={value} onChange={(e) => handleCustomChange(field.id, e.target.value)} />;
  };

  if (loading) return <div className="agrd__loading">Loading…</div>;

  if (notFound) {
    return (
      <div className="agrd">
        <button className="agrd__back" onClick={() => navigate('/dashboard/agreements')}>
          <BackIcon /> Back to agreements
        </button>
        <p className="agrd__empty">This agreement doesn't exist or was deleted.</p>
      </div>
    );
  }

  return (
    <div className="agrd">
      <button className="agrd__back" onClick={() => navigate('/dashboard/agreements')}>
        <BackIcon /> Back to agreements
      </button>

      <div className="agrd__title-row">
        <h2 className="agrd__title">{agreement.title}</h2>
      </div>

      <div className="agrd__pipeline">
        {PIPELINE_STATUSES.map((status, index) => {
          const isPast = index < pipelineIndex;
          const isCurrent = index === pipelineIndex;
          return (
            <div
              key={status}
              className={`agrd__pipeline-item ${isPast ? 'agrd__pipeline-item--past' : ''} ${isCurrent ? 'agrd__pipeline-item--current' : ''}`}
            >
              <span className="agrd__pipeline-label">{status}</span>
            </div>
          );
        })}
      </div>

      <div className="agrd__grid">

        <aside className="agrd__nav">
          <button className={`agrd__nav-btn ${activeNav === 'details' ? 'agrd__nav-btn--active' : ''}`} onClick={() => setActiveNav('details')} title="Agreement details">
            <DetailsIcon />
            <span className="agrd__nav-label">Details</span>
          </button>
          <button className={`agrd__nav-btn ${activeNav === 'attachments' ? 'agrd__nav-btn--active' : ''}`} onClick={() => setActiveNav('attachments')} title="Attachments">
            <AttachmentsIcon />
            <span className="agrd__nav-label">Files</span>
          </button>
        </aside>

        <div className="agrd__content">
          <div className="agrd__content-card">

            {activeNav === 'details' && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Agreement details</h3>
                  {!editing && (
                    <button className="agrd__edit-btn" onClick={handleStartEdit}>
                      <EditIcon /> Edit
                    </button>
                  )}
                </div>

                {!editing ? (
                  <div className="agrd__view-grid">
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Title</span>
                      <span className="agrd__view-value">{agreement.title || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Account</span>
                      <span className="agrd__view-value">{agreement.accountName || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Agreement type</span>
                      <span className="agrd__view-value">{agreement.agreementType || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Agreement subtype</span>
                      <span className="agrd__view-value">{agreement.agreementSubtype || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Language</span>
                      <span className="agrd__view-value">{agreement.language || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Status</span>
                      <span className="agrd__view-value">{agreement.status || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Start date</span>
                      <span className="agrd__view-value">{agreement.effectiveDate || '—'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">End date</span>
                      <span className="agrd__view-value">{agreement.endDate || '—'}</span>
                    </div>
                    {customFieldDefs.filter((f) => f.type !== 'lookup').map((field) => (
                      <div key={field.id} className="agrd__view-field">
                        <span className="agrd__view-label">{field.label}</span>
                        <span className="agrd__view-value">{(agreement.customFields || {})[field.id] || '—'}</span>
                      </div>
                    ))}
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Created by</span>
                      <span className="agrd__view-value">{agreement.createdBy || '—'}</span>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSave}>
                    {error && <p className="agrd__error">{error}</p>}
                    <div className="agrd__form-grid">
                      <div className="agrd__field agrd__field--full">
                        <label className="agrd__label" htmlFor="title">Title</label>
                        <input id="title" name="title" className="agrd__input" value={form.title} onChange={handleFormChange} required />
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="accountId">Account</label>
                        <select id="accountId" name="accountId" className="agrd__input" value={form.accountId} onChange={handleFormChange}>
                          <option value="">— Select account —</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="agreementType">Agreement type</label>
                        {typeOptions.length > 0 ? (
                          <select id="agreementType" name="agreementType" className="agrd__input" value={form.agreementType} onChange={handleFormChange}>
                            <option value="">— Select type —</option>
                            {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input id="agreementType" name="agreementType" className="agrd__input" value={form.agreementType} onChange={handleFormChange} />
                        )}
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="agreementSubtype">Agreement subtype</label>
                        {filteredSubtypes.length > 0 ? (
                          <select
                            id="agreementSubtype"
                            name="agreementSubtype"
                            className="agrd__input"
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
                            className="agrd__input"
                            value={form.agreementSubtype}
                            onChange={handleFormChange}
                            placeholder={typeOptions.length > 0 && !form.agreementType ? 'Select a type first' : ''}
                            disabled={typeOptions.length > 0 && !form.agreementType}
                          />
                        )}
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="language">Language</label>
                        <select id="language" name="language" className="agrd__input" value={form.language} onChange={handleFormChange}>
                          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="status">Status</label>
                        <select id="status" name="status" className="agrd__input" value={form.status} onChange={handleFormChange}>
                          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="effectiveDate">Start date</label>
                        <input id="effectiveDate" name="effectiveDate" type="date" className="agrd__input" value={form.effectiveDate} onChange={handleFormChange} />
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="endDate">End date</label>
                        <input id="endDate" name="endDate" type="date" className="agrd__input" value={form.endDate} onChange={handleFormChange} />
                      </div>

                      {customFieldDefs.filter((f) => f.type !== 'lookup').map((field) => (
                        <div key={field.id} className="agrd__field">
                          <label className="agrd__label">{field.label}</label>
                          {renderCustomFieldInput(field)}
                        </div>
                      ))}
                    </div>

                    <div className="agrd__form-actions">
                      <button type="button" className="agrd__btn-secondary" onClick={handleCancelEdit}>Cancel</button>
                      <button type="submit" className="agrd__btn-primary" disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {activeNav === 'attachments' && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Attachments</h3>
                </div>

                {(agreement.reviewSessions || []).length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">In review</h4>
                    {(agreement.reviewSessions || []).map((session) => (
                      <div key={session.id} className="agrd__review-session-row">
                        <div className="agrd__review-session-info">
                          <span className="agrd__review-session-name">{session.attachmentName}</span>
                          <span className="agrd__review-session-meta">
                            Sent to {session.sentTo.join(', ')} · {new Date(session.sentAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="agrd__review-session-actions">
                          <span className={`agrd__review-session-status agrd__review-session-status--${session.status === 'Completed' ? 'done' : 'pending'}`}>
                            {session.status}
                          </span>
                          {session.webUrl && (
                            <>
                              <button
                                type="button"
                                className="agrd__attachment-btn"
                                onClick={() => handleCopyReviewLink(session)}
                              >
                                {copiedSessionId === session.id ? 'Copied!' : 'Copy link'}
                              </button>
                              <a className="agrd__attachment-btn" href={session.webUrl} target="_blank" rel="noreferrer">
                                Open in Word
                              </a>
                            </>
                          )}
                          {session.status !== 'Completed' && (
                            <button
                              type="button"
                              className="agrd__attachment-btn"
                              onClick={() => handleFetchRedlines(session)}
                              disabled={fetchingSessionId === session.id}
                            >
                              {fetchingSessionId === session.id ? 'Fetching…' : 'Fetch reviewed version'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {approvalRequests.length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">Sent for approval</h4>
                    {approvalRequests.map((request) => (
                      <div key={request.id} className="agrd__review-session-row">
                        <div className="agrd__review-session-info">
                          <span className="agrd__review-session-name">
                            {request.approverName ? `${request.approverName} · ` : ''}{request.approverEmail}
                          </span>
                          <span className="agrd__review-session-meta">
                            {request.attachmentName || 'No document attached'} ·{' '}
                            {request.createdAt?.seconds
                              ? new Date(request.createdAt.seconds * 1000).toLocaleDateString()
                              : 'just now'}
                          </span>
                          {request.status !== 'Pending' && request.comment && (
                            <span className="agrd__review-session-meta">“{request.comment}”</span>
                          )}
                        </div>
                        <div className="agrd__review-session-actions">
                          <span
                            className={`agrd__review-session-status agrd__review-session-status--${
                              request.status === 'Approved' ? 'done' : request.status === 'Rejected' ? 'danger' : 'pending'
                            }`}
                          >
                            {request.status}
                          </span>
                          {request.status === 'Pending' && (
                            <button
                              type="button"
                              className="agrd__attachment-btn"
                              onClick={() => handleCopyApprovalLink(request)}
                            >
                              {copiedApprovalId === request.id ? 'Copied!' : 'Copy link'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(agreement.docusignEnvelopes || []).length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">Sent for signature</h4>
                    {agreement.docusignEnvelopes.map((env) => (
                      <div key={env.envelopeId} className="agrd__review-session-row">
                        <div className="agrd__review-session-info">
                          <span className="agrd__review-session-name">
                            {(env.signers || []).map((s) => `${s.name} (${s.email})`).join('  →  ')}
                          </span>
                          <span className="agrd__review-session-meta">
                            {env.attachmentName} ·{' '}
                            {env.sentAt ? new Date(env.sentAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                        <div className="agrd__review-session-actions">
                          <span
                            className={`agrd__review-session-status agrd__review-session-status--${
                              env.status === 'completed' ? 'done' : env.status === 'declined' || env.status === 'voided' ? 'danger' : 'pending'
                            }`}
                          >
                            {env.status}
                          </span>
                          {env.status !== 'declined' && env.status !== 'voided' && (env.status !== 'completed' || !env.signedAttachmentId) && (
                            <button
                              type="button"
                              className="agrd__attachment-btn"
                              onClick={() => handleRefreshEnvelopeStatus(env.envelopeId)}
                              disabled={refreshingEnvelopeId === env.envelopeId}
                            >
                              {refreshingEnvelopeId === env.envelopeId
                                ? 'Checking…'
                                : env.status === 'completed'
                                ? 'Fetch signed document'
                                : 'Refresh status'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(agreement.attachments || []).length === 0 ? (
                  <div className="agrd__attachments-empty">
                    <p>No attachments yet. Use "Generate agreement" from the Actions panel to create one.</p>
                  </div>
                ) : (
                  <div className="agrd__attachments-list">
                    {(agreement.attachments || []).map((att) => (
                      <div key={att.id} className="agrd__attachment-row">
                        <div className="agrd__attachment-info">
                          <FileIcon />
                          <div className="agrd__attachment-meta">
                            <span className="agrd__attachment-name">{att.name}</span>
                            <span className="agrd__attachment-size">{formatFileSize(att.size)}</span>
                          </div>
                        </div>
                        <div className="agrd__attachment-actions">
                          <button
                            type="button"
                            className="agrd__attachment-btn"
                            onClick={() => handleDownloadAttachment(att)}
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            className="agrd__attachment-btn agrd__attachment-btn--danger"
                            onClick={() => handleDeleteAttachment(att)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right actions panel */}
        <aside className="agrd__actions">
          <div className="agrd__actions-card">
            <h4 className="agrd__actions-title">Actions</h4>
            {(() => {
              const status = agreement.status || 'Draft';
              const isDraft = status === 'Draft';
              const isLocked = ['In approval', 'Pending signatures', 'Activated'].includes(status);
              const showAll = !isDraft && !isLocked;

              return (
                <>
                  {(isDraft || showAll) && (
                    <button className="agrd__btn-primary-sm" onClick={openGenerateModal}>Generate agreement</button>
                  )}
                  {(isDraft || showAll) && (
                    <button className="agrd__btn-secondary-sm" onClick={handleImportClick} disabled={importing}>
                      {importing ? 'Importing…' : 'Import additional files'}
                    </button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-secondary-sm" onClick={openMergeModal}>Merge files</button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-secondary-sm" onClick={openReviewModal}>Send to review</button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-secondary-sm" onClick={openApprovalModal}>Send for approval</button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-secondary-sm arv__trigger-btn" onClick={handleOpenReviewAI}>
                      <SparkleIcon /> Review with AI
                    </button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-secondary-sm" onClick={openSignatureModal}>Send for signature</button>
                  )}
                  {showAll && (
                    <button className="agrd__btn-primary agrd__btn-activate" onClick={openActivateModal}>Activate</button>
                  )}
                </>
              );
            })()}
            <input
              ref={importFileInputRef}
              type="file"
              multiple
              className="agrd__hidden-file-input"
              onChange={handleImportFilesSelected}
            />
            {importError && <p className="agrd__error agrd__error--sm">{importError}</p>}
            <div className="agrd__actions-divider" />
            <button className="agrd__btn-danger-sm" onClick={handleDelete}>Delete agreement</button>
          </div>
        </aside>
      </div>

      {showGenerateModal && (
        <div className="agrd__modal-backdrop" onClick={closeGenerateModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Generate agreement</h3>
              <p className="agrd__modal-subtitle">
                Showing templates for <strong>{agreement.agreementType || '—'}</strong> / <strong>{agreement.agreementSubtype || '—'}</strong>
              </p>

              {generateError && <p className="agrd__error">{generateError}</p>}

              {loadingGenTemplates ? (
                <p className="agrd__modal-hint">Loading templates…</p>
              ) : availableTemplates.length === 0 ? (
                <p className="agrd__modal-hint">
                  No templates found for this agreement type and subtype. Create one in Template Builder first.
                </p>
              ) : (
                <div className="agrd__template-list">
                  {availableTemplates.map((t) => (
                    <label
                      key={t.id}
                      className={`agrd__template-option ${selectedTemplateId === t.id ? 'agrd__template-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="templateId"
                        value={t.id}
                        checked={selectedTemplateId === t.id}
                        onChange={() => setSelectedTemplateId(t.id)}
                      />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{t.name}</span>
                        <span className="agrd__template-option-lang">{t.language}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeGenerateModal} disabled={generating}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleGenerate}
                disabled={!selectedTemplateId || generating}
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge files modal */}
      {showMergeModal && (
        <div className="agrd__modal-backdrop" onClick={closeMergeModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Merge files</h3>
              <p className="agrd__modal-subtitle">Select the Word files to merge, then set the order.</p>

              {mergeError && <p className="agrd__error">{mergeError}</p>}

              {mergeableAttachments.length === 0 ? (
                <p className="agrd__modal-hint">No Word (.docx) attachments available to merge.</p>
              ) : (
                <div className="agrd__merge-list">
                  {mergeableAttachments.map((att) => (
                    <label key={att.id} className="agrd__merge-option">
                      <input
                        type="checkbox"
                        checked={selectedMergeIds.includes(att.id)}
                        onChange={() => toggleMergeSelection(att.id)}
                      />
                      <span className="agrd__merge-option-name">{att.name}</span>
                      <span className="agrd__merge-option-size">{formatFileSize(att.size)}</span>
                    </label>
                  ))}
                </div>
              )}

              {nonMergeableAttachments.length > 0 && (
                <p className="agrd__modal-hint agrd__modal-hint--top">
                  Only Word (.docx) files can be merged — {nonMergeableAttachments.length} other file
                  {nonMergeableAttachments.length === 1 ? '' : 's'} on this record can't be included.
                </p>
              )}

              {selectedMergeIds.length > 0 && (
                <>
                  <h4 className="agrd__merge-order-title">Merge order</h4>
                  <div className="agrd__merge-order-list">
                    {selectedMergeIds.map((id, index) => {
                      const att = mergeableAttachments.find((a) => a.id === id);
                      if (!att) return null;
                      return (
                        <div key={id} className="agrd__merge-order-row">
                          <span className="agrd__merge-order-badge">{index + 1}</span>
                          <span className="agrd__merge-order-name">{att.name}</span>
                          <div className="agrd__merge-order-controls">
                            <button
                              type="button"
                              className="agrd__merge-order-btn"
                              onClick={() => moveMergeItem(index, -1)}
                              disabled={index === 0}
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="agrd__merge-order-btn"
                              onClick={() => moveMergeItem(index, 1)}
                              disabled={index === selectedMergeIds.length - 1}
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeMergeModal} disabled={merging}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-secondary"
                onClick={() => handleMergeExport('pdf')}
                disabled={selectedMergeIds.length === 0 || merging}
              >
                {merging ? 'Exporting…' : 'Export as PDF'}
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={() => handleMergeExport('word')}
                disabled={selectedMergeIds.length === 0 || merging}
              >
                {merging ? 'Exporting…' : 'Export as Word'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && (
        <div className="agrd__modal-backdrop" onClick={closeReviewModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Send to review</h3>
              <p className="agrd__modal-subtitle">
                Opens the selected document in Office 365 Word Online for the reviewer to make track-changes edits.
              </p>

              {reviewError && <p className="agrd__error">{reviewError}</p>}

              <h4 className="agrd__review-section-title">Attachments</h4>
              {reviewableAttachments.length === 0 ? (
                <p className="agrd__modal-hint">
                  No documents available to send. Word Online can't open documents created with "Generate
                  agreement" — only imported .docx files (or documents already returned from a previous review)
                  can be sent.
                </p>
              ) : (
                <div className="agrd__merge-list">
                  {reviewableAttachments.map((att) => (
                    <label
                      key={att.id}
                      className={`agrd__template-option ${reviewAttachmentId === att.id ? 'agrd__template-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="reviewAttachmentId"
                        value={att.id}
                        checked={reviewAttachmentId === att.id}
                        onChange={() => setReviewAttachmentId(att.id)}
                      />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{att.name}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <h4 className="agrd__review-section-title">Send to</h4>
              <input
                type="text"
                className="agrd__input"
                placeholder="reviewer@company.com, another@company.com"
                value={reviewRecipients}
                onChange={(e) => setReviewRecipients(e.target.value)}
              />
              <textarea
                className="agrd__input agrd__textarea"
                placeholder="Optional message for the reviewer"
                value={reviewMessage}
                onChange={(e) => setReviewMessage(e.target.value)}
                rows={3}
              />
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeReviewModal} disabled={sendingReview}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleSendToReview}
                disabled={!reviewAttachmentId || sendingReview}
              >
                {sendingReview ? 'Sending…' : 'Send to review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showApprovalModal && (
        <div className="agrd__modal-backdrop" onClick={closeApprovalModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Send for approval</h3>
              <p className="agrd__modal-subtitle">
                The approver gets an emailed link where they can only view the document and approve or reject
                it — no Legal Space account needed.
              </p>

              {approvalError && <p className="agrd__error">{approvalError}</p>}

              <h4 className="agrd__review-section-title">Document</h4>
              {(agreement.attachments || []).length === 0 ? (
                <p className="agrd__modal-hint">No attachments on this agreement yet.</p>
              ) : (
                <div className="agrd__merge-list">
                  {(agreement.attachments || []).map((att) => (
                    <label
                      key={att.id}
                      className={`agrd__template-option ${approvalAttachmentId === att.id ? 'agrd__template-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="approvalAttachmentId"
                        value={att.id}
                        checked={approvalAttachmentId === att.id}
                        onChange={() => setApprovalAttachmentId(att.id)}
                      />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{att.name}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <h4 className="agrd__review-section-title">Approver</h4>
              <input
                type="text"
                className="agrd__input"
                placeholder="Approver name (optional)"
                value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
              />
              <input
                type="email"
                className="agrd__input"
                placeholder="approver@company.com"
                value={approverEmail}
                onChange={(e) => setApproverEmail(e.target.value)}
              />
              <textarea
                className="agrd__input agrd__textarea"
                placeholder="Optional message for the approver"
                value={approvalMessage}
                onChange={(e) => setApprovalMessage(e.target.value)}
                rows={3}
              />
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeApprovalModal} disabled={sendingApproval}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleSendForApproval}
                disabled={!approverEmail.trim() || sendingApproval}
              >
                {sendingApproval ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewAIModal && (
        <div className="arv__backdrop" onClick={closeReviewAIModal}>
          <div className="arv__modal" onClick={(e) => e.stopPropagation()}>
            <div className="arv__header">
              <h3 className="arv__title"><SparkleIcon /> Review with AI</h3>
              <p className="arv__subtitle">
                A contract-manager-style quality check — not legal advice. Based only on the document text you pick below.
              </p>
            </div>

            <div className="arv__body">
              {(agreement.attachments || []).length === 0 ? (
                <p className="arv__error">This agreement has no attached document to review yet.</p>
              ) : (
                <>
                  <div className="arv__doc-select">
                    <span className="arv__doc-select-label">Document to review</span>
                    <div className="arv__doc-options">
                      {agreement.attachments.map((att) => (
                        <label
                          key={att.id}
                          className={`arv__doc-option ${aiReviewAttachmentId === att.id ? 'arv__doc-option--selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="aiReviewAttachment"
                            checked={aiReviewAttachmentId === att.id}
                            onChange={() => setAiReviewAttachmentId(att.id)}
                          />
                          <span>{att.name}</span>
                        </label>
                      ))}
                      {agreement.attachments.length > 1 && (
                        <label
                          className={`arv__doc-option ${aiReviewAttachmentId === 'ALL' ? 'arv__doc-option--selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="aiReviewAttachment"
                            checked={aiReviewAttachmentId === 'ALL'}
                            onChange={() => setAiReviewAttachmentId('ALL')}
                          />
                          <span>All documents combined</span>
                        </label>
                      )}
                    </div>
                    <button
                      type="button"
                      className="arv__btn-primary arv__run-btn"
                      onClick={handleRunReviewAI}
                      disabled={reviewingAI || !aiReviewAttachmentId}
                    >
                      {reviewingAI ? 'Reviewing…' : aiReview ? 'Re-run review' : 'Run review'}
                    </button>
                  </div>

                  {reviewingAI && (
                    <div className="arv__loading">
                      <div className="arv__spinner" />
                      <span>Reading the document…</span>
                    </div>
                  )}

                  {!reviewingAI && reviewAIError && <p className="arv__error">{reviewAIError}</p>}

                  {!reviewingAI && aiReview && (
                    <>
                      <div className="arv__score-row">
                        <div
                          className={`arv__score-badge arv__score-badge--${aiReview.score >= 8 ? 'good' : aiReview.score >= 5 ? 'mid' : 'low'}`}
                        >
                          {aiReview.score}<span className="arv__score-max">/10</span>
                        </div>
                        <p className="arv__summary">{aiReview.summary}</p>
                      </div>

                      {aiReview.strengths.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title arv__section-title--good">Strengths</h4>
                          <ul className="arv__list">
                            {aiReview.strengths.map((item, i) => <li key={i}>{item}</li>)}
                          </ul>
                        </div>
                      )}

                      {aiReview.gaps.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title arv__section-title--warn">Gaps</h4>
                          <ul className="arv__list">
                            {aiReview.gaps.map((item, i) => <li key={i}>{item}</li>)}
                          </ul>
                        </div>
                      )}

                      {aiReview.suggestions.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title">Suggestions</h4>
                          <ul className="arv__list">
                            {aiReview.suggestions.map((item, i) => <li key={i}>{item}</li>)}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="arv__footer">
              <button type="button" className="arv__btn-secondary" onClick={closeReviewAIModal} disabled={reviewingAI}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send for signature modal (DocuSign) */}
      {showSignatureModal && (
        <div className="agrd__modal-backdrop" onClick={closeSignatureModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Send for signature</h3>
              <p className="agrd__modal-subtitle">
                Sends the document to DocuSign for e-signature. Sandbox mode — signatures aren't legally binding yet.
                {includeSecondSigner && ' Make sure the document also has /sig2/, /name2/, /title2/, /date2/ tags for the second signer.'}
              </p>

              {signatureError && <p className="agrd__error">{signatureError}</p>}

              <h4 className="agrd__review-section-title">Document</h4>
              {(agreement.attachments || []).length === 0 ? (
                <p className="agrd__modal-hint">No attachments on this agreement yet.</p>
              ) : (
                <div className="agrd__merge-list">
                  {agreement.attachments.map((att) => (
                    <label
                      key={att.id}
                      className={`agrd__template-option ${signatureAttachmentId === att.id ? 'agrd__template-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="signatureAttachmentId"
                        value={att.id}
                        checked={signatureAttachmentId === att.id}
                        onChange={() => setSignatureAttachmentId(att.id)}
                      />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{att.name}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <h4 className="agrd__review-section-title">Signer 1</h4>
              <input
                type="text"
                className="agrd__input"
                placeholder="Signer name"
                value={signer1Name}
                onChange={(e) => setSigner1Name(e.target.value)}
              />
              <input
                type="email"
                className="agrd__input"
                placeholder="signer@company.com"
                value={signer1Email}
                onChange={(e) => setSigner1Email(e.target.value)}
              />

              {includeSecondSigner ? (
                <>
                  <h4 className="agrd__review-section-title">
                    Signer 2 <span className="agrd__modal-hint">(signs after Signer 1)</span>
                  </h4>
                  <input
                    type="text"
                    className="agrd__input"
                    placeholder="Signer name"
                    value={signer2Name}
                    onChange={(e) => setSigner2Name(e.target.value)}
                  />
                  <input
                    type="email"
                    className="agrd__input"
                    placeholder="signer@company.com"
                    value={signer2Email}
                    onChange={(e) => setSigner2Email(e.target.value)}
                  />
                  <button
                    type="button"
                    className="agrd__attachment-btn"
                    onClick={() => { setIncludeSecondSigner(false); setSigner2Name(''); setSigner2Email(''); }}
                  >
                    Remove second signer
                  </button>
                </>
              ) : (
                <button type="button" className="agrd__attachment-btn" onClick={() => setIncludeSecondSigner(true)}>
                  + Add a second signer
                </button>
              )}

              <h4 className="agrd__review-section-title">Message</h4>
              <textarea
                className="agrd__input agrd__textarea"
                placeholder="Optional message for the signer"
                value={signatureMessage}
                onChange={(e) => setSignatureMessage(e.target.value)}
                rows={3}
              />
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeSignatureModal} disabled={sendingSignature}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleSendForSignature}
                disabled={!signatureAttachmentId || !signer1Email.trim() || sendingSignature}
              >
                {sendingSignature ? 'Sending…' : 'Send for signature'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate modal */}
      {showActivateModal && (
        <div className="agrd__modal-backdrop" onClick={closeActivateModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Activate agreement</h3>
              <p className="agrd__modal-subtitle">
                Marks this agreement as Activated. Optionally notify someone by email, with a link to the record.
              </p>

              {activateError && <p className="agrd__error">{activateError}</p>}

              <h4 className="agrd__review-section-title">Notify user (optional)</h4>
              <input
                type="text"
                className="agrd__input"
                placeholder="Name (optional)"
                value={activateNotifyName}
                onChange={(e) => setActivateNotifyName(e.target.value)}
              />
              <input
                type="email"
                className="agrd__input"
                placeholder="Leave empty to activate without notifying anyone"
                value={activateNotifyEmail}
                onChange={(e) => setActivateNotifyEmail(e.target.value)}
              />
              <textarea
                className="agrd__input agrd__textarea"
                placeholder="Optional message"
                value={activateMessage}
                onChange={(e) => setActivateMessage(e.target.value)}
                rows={3}
              />
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeActivateModal} disabled={activating}>
                Cancel
              </button>
              <button type="button" className="agrd__btn-primary" onClick={handleActivate} disabled={activating}>
                {activating ? 'Activating…' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgreementDetailScreen;