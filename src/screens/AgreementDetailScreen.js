import { useEffect, useState, useMemo, useRef } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { useNavigate, useParams } from 'react-router-dom';
import { htmlToDocxBlob } from '../docxApi';
import mammoth from 'mammoth';
import { pushAttachmentToSalesforce, syncAgreementToSalesforce } from '../salesforceApi';
import NoticeModal from '../components/NoticeModal';
import { useAuth } from '../AuthContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  getAgreement,
  updateAgreement,
  deleteAgreement,
  listAccounts,
  getAccount,
  listTemplates,
  generateAgreementDocument,
  updateAgreementStatus,
  addAgreementAttachment,
  deleteAgreementAttachment,
  createApprovalRequest,
  listApprovalRequestsForAgreement,
  addDocusignEnvelope,
  updateDocusignEnvelope,
  getCurrentUser,
  getObjectSchema,
  getBuiltInFieldConfigs,
  getTypeSubtypeMap,
  createReviewRequest,
  listReviewRequestsForAgreement,
  acceptReviewChanges,
  rejectReviewChanges,
  listPlaybooksByAccount,
  listAgreements,
  listAgreementsRelatedTo,
  getReminderSettings,
  saveAgreementReviewSummary,
  logAuditEvent,
  MAX_ATTACHMENT_BYTES,
  listObligations,
  createObligations,
  setObligationStatus,
  deleteObligation,
  listTasks,
  createTasks,
} from '../supabase';
import { featureOn } from '../aiFeatures';
import { sendForSignature, getSignatureStatus, getSignedDocument } from '../docusignApi';
import { sendApprovalEmail, sendActivationEmail, sendReviewEmail } from '../emailApi';
import { reviewAgreementWithAI } from '../reviewApi';
import { prepareRenewalBrief, findObligations } from '../agentApi';
import { indexObject } from '../embeddingsApi';
import { buildFinalHtmlFromTokens, renderChangeTokensToHtml, listChangeIds, computeChangeTokens } from '../redlineUtils';
import './AgreementDetailScreen.css';
import './ReviewModal.css';
import { sanitizeDocumentHtml } from '../sanitizeHtml';

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

function RenewalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__nav-icon">
      <path d="M20 12a8 8 0 1 1-2.3-5.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 4v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ObligationsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__nav-icon">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8.5l1.5 1.5L12 7.5M8 14.5l1.5 1.5 2.5-2.5M14 9h3M14 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const RENEWAL_ACTION_LABELS = {
  renew: 'Renew as is',
  renew_with_changes: 'Renew with changes',
  renegotiate: 'Renegotiate',
  let_lapse: 'Let it lapse',
  unclear: 'Not enough information',
};

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="agrd__bell-icon">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function resolvePlaceholderValue(fieldKey, { agreement, account, account2, template }) {
  if (!fieldKey) return '';
  const parts = fieldKey.split('.');

  if (parts.length === 2 && parts[0] === 'agreement') {
    return agreement[parts[1]] ?? (agreement.customFields || {})[parts[1]] ?? '';
  }
  if (parts.length === 2 && parts[0] === 'template') {
    return template ? (template[parts[1]] ?? '') : '';
  }
  if (parts.length === 2 && parts[0] === 'builtin_account2') {
    if (!account2) return '';
    return account2[parts[1]] ?? (account2.customFields || {})[parts[1]] ?? '';
  }
  if (parts.length === 2) {
    if (!account) return '';
    return account[parts[1]] ?? (account.customFields || {})[parts[1]] ?? '';
  }
  return (agreement.customFields || {})[fieldKey] ?? '';
}

function fillTemplateHtml(html, context) {
  const container = document.createElement('div');
  container.innerHTML = sanitizeDocumentHtml(html || '');
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

function buildRedlineFileName(originalName, version) {
  const base = (originalName || 'Document').replace(/\.docx$/i, '');
  return `${base} - v${version} - Redlines.docx`;
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
    div.innerHTML = sanitizeDocumentHtml(attachment.sourceHtml);
    return (div.innerText || div.textContent || '').trim();
  }
  // Review AI reads Word text in the browser; a PDF can't be opened by
  // mammoth (it would throw and fail the whole review), so it is skipped.
  if (attachment.dataBase64 && !/\.pdf$/i.test(attachment.name || '') && attachment.mimeType !== 'application/pdf') {
    const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result.value || '').trim();
  }
  return '';
}

// Same "insert before the signature block, continue the numbering" logic
// used in the template builder, but operating on a detached container
// (this flow has no live contentEditable — edits accumulate in an HTML
// string across multiple "Apply suggestion" clicks).
function findSignatureBlockNode(root) {
  if (!root) return null;
  const blocks = Array.from(root.querySelectorAll('p, div, li'));
  const target = blocks.find((el) => /in witness whereof|signature|signed\s+by|semn(at|ătur)/i.test(el.textContent || ''));
  if (!target) return null;
  let topLevel = target;
  while (topLevel.parentElement && topLevel.parentElement !== root) {
    topLevel = topLevel.parentElement;
  }
  return topLevel.parentElement === root ? topLevel : null;
}

function detectNextClauseNumberNode(root) {
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
}

// Locates `searchText` verbatim inside `root`'s text content (which may
// span several text nodes) and replaces exactly that span with
// `replacementText` as plain text — used to apply an AI-proposed redline
// rewrite of an existing clause onto the detached document container.
function findAndReplaceTextNode(root, searchText, replacementText) {
  if (!root || !searchText) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let fullText = '';
  const nodeOffsets = [];
  let node;
  while ((node = walker.nextNode())) {
    const start = fullText.length;
    fullText += node.nodeValue;
    nodeOffsets.push({ node, start, end: fullText.length });
  }

  const matchIndex = fullText.indexOf(searchText);
  if (matchIndex === -1) return false;
  const matchEnd = matchIndex + searchText.length;

  const startInfo = nodeOffsets.find((n) => matchIndex >= n.start && matchIndex <= n.end);
  const endInfo = nodeOffsets.find((n) => matchEnd >= n.start && matchEnd <= n.end);
  if (!startInfo || !endInfo) return false;

  const range = document.createRange();
  range.setStart(startInfo.node, matchIndex - startInfo.start);
  range.setEnd(endInfo.node, matchEnd - endInfo.start);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacementText));
  return true;
}

// One playbook as the review AI reads it: the general rules plus the review
// criteria and the obligations it should expect to find.
function playbookToReviewText(pb) {
  const parts = [`[${pb.title}]`];
  if (pb.body?.trim()) parts.push(pb.body.trim());
  if (pb.reviewCriteria?.trim()) parts.push(`Review criteria:\n${pb.reviewCriteria.trim()}`);
  if (pb.obligations?.trim()) parts.push(`Obligations the agreement must contain:\n${pb.obligations.trim()}`);
  return parts.join('\n');
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

async function attachmentToDocusignPayloadSafe(attachment) {
  const payload = attachmentToDocusignPayload(attachment);
  if (!payload || !attachment.sourceHtml || payload.fileExtension.toLowerCase() !== 'docx') return payload;
  // Generated documents go to DocuSign as HTML: its converter accepts that
  // reliably, while it kept rejecting our generated .docx files.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.4}</style></head><body>${attachment.sourceHtml}</body></html>`;
  return { documentBase64: btoa(unescape(encodeURIComponent(html))), fileExtension: 'html' };
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
  container.innerHTML = sanitizeDocumentHtml(html);
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
  const confirm = useConfirm();
  const { canWrite, isAdmin, aiFeatures } = useAuth();
  const { agreementId } = useParams();
  const navigate = useNavigate();

  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeNav, setActiveNav] = useState('details');
  const [obligations, setObligations] = useState([]);
  const [obligationsLoading, setObligationsLoading] = useState(false);
  const [obligationsError, setObligationsError] = useState('');
  const [obligationProposals, setObligationProposals] = useState(null);
  const [obligationSummary, setObligationSummary] = useState('');
  const [findingObligations, setFindingObligations] = useState(false);
  const [savingObligations, setSavingObligations] = useState(false);
  const [renewalBrief, setRenewalBrief] = useState(null);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalError, setRenewalError] = useState('');
  // Notice period and auto-renewal as recorded on the agreement (editable).
  const [noticeDaysInput, setNoticeDaysInput] = useState('');
  const [autoRenewalInput, setAutoRenewalInput] = useState('');
  const [savingNotice, setSavingNotice] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState('');
  // Follow-up tasks: the agreement's open tasks, and next steps picked from the brief.
  const [agreementTasks, setAgreementTasks] = useState([]);
  const [selectedSteps, setSelectedSteps] = useState([]);
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [customValues, setCustomValues] = useState({});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [relatedAgreementTitle, setRelatedAgreementTitle] = useState('');
  const [reverseRelatedAgreements, setReverseRelatedAgreements] = useState([]);
  const [showRelationModal, setShowRelationModal] = useState(false);
  const [relationDraftType, setRelationDraftType] = useState('renewal');
  const [relationDraftTargetId, setRelationDraftTargetId] = useState('');
  const [relationPickerAgreements, setRelationPickerAgreements] = useState([]);
  const [loadingRelationPicker, setLoadingRelationPicker] = useState(false);
  const [savingRelation, setSavingRelation] = useState(false);
  const [relationError, setRelationError] = useState('');

  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyMode, setNotifyMode] = useState('default'); // 'default' | 'custom'
  const [notifyDays, setNotifyDays] = useState([]);
  const [tenantDefaultDays, setTenantDefaultDays] = useState([]);
  const [newNotifyDay, setNewNotifyDay] = useState('');
  const [loadingNotify, setLoadingNotify] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifyError, setNotifyError] = useState('');
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
  const [sfPushingId, setSfPushingId] = useState('');
  const [sfNotice, setSfNotice] = useState(null);
  const [sfSyncing, setSfSyncing] = useState(false);

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedMergeIds, setSelectedMergeIds] = useState([]);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');

  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareFromId, setCompareFromId] = useState('');
  const [compareToId, setCompareToId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareTokens, setCompareTokens] = useState(null);

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewAttachmentId, setReviewAttachmentId] = useState('');
  const [reviewersList, setReviewersList] = useState([{ name: '', email: '' }]);
  const [reviewCc, setReviewCc] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [sendingReview, setSendingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewRequests, setReviewRequests] = useState([]);
  const [copiedReviewId, setCopiedReviewId] = useState('');
  const [processingReviewId, setProcessingReviewId] = useState('');
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [activeReviewRequest, setActiveReviewRequest] = useState(null);
  const [changeDecisions, setChangeDecisions] = useState({});
  const [currentChangeId, setCurrentChangeId] = useState(null);
  const redlineMainRef = useRef(null);

  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAttachmentId, setApprovalAttachmentId] = useState('');
  const [approversList, setApproversList] = useState([{ name: '', email: '' }]);
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
  const [reviewModalView, setReviewModalView] = useState('list'); // 'list' | 'detail' | 'redline-detail'
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(null);
  const [appliedSuggestionIndexes, setAppliedSuggestionIndexes] = useState([]);
  const [pendingReviewEditsHtml, setPendingReviewEditsHtml] = useState(null);
  const [activeRedlineRef, setActiveRedlineRef] = useState(null); // { source: 'risks' | 'playbookViolations', index }
  const [appliedRedlineRefs, setAppliedRedlineRefs] = useState([]); // ['risks-0', 'playbookViolations-2', ...]
  const [availablePlaybooks, setAvailablePlaybooks] = useState([]);
  const [selectedPlaybookIds, setSelectedPlaybookIds] = useState([]);
  const [savingReviewEdits, setSavingReviewEdits] = useState(false);

  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureAttachmentIds, setSignatureAttachmentIds] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [signersList, setSignersList] = useState([{ name: '', email: '' }]);
  const [ccList, setCcList] = useState([]);
  const [signatureMessage, setSignatureMessage] = useState('');
  const [sendingSignature, setSendingSignature] = useState(false);
  const [markingManualSignature, setMarkingManualSignature] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [refreshingEnvelopeId, setRefreshingEnvelopeId] = useState('');

  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateNotifyName, setActivateNotifyName] = useState('');
  const [activateNotifyEmail, setActivateNotifyEmail] = useState('');
  const [activateMessage, setActivateMessage] = useState('');
  const [activateCc, setActivateCc] = useState('');
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
    let agr;
    try {
      agr = await getAgreement(agreementId);
    } catch (err) {
      console.error('Failed to load agreement:', err);
      setNotFound(true);
      setLoading(false);
      return;
    }
    setAgreement(agr);
    setNoticeDaysInput(agr.noticePeriodDays ?? '');
    setAutoRenewalInput(agr.autoRenewal === null || agr.autoRenewal === undefined ? '' : agr.autoRenewal ? 'yes' : 'no');

    try {
      const [schema, configs, map, approvals, reviews] = await Promise.all([
        getObjectSchema('agreement'),
        getBuiltInFieldConfigs('agreement'),
        getTypeSubtypeMap(),
        listApprovalRequestsForAgreement(agreementId),
        listReviewRequestsForAgreement(agreementId),
      ]);
      setCustomFieldDefs(schema);
      setApprovalRequests(approvals);
      setReviewRequests(reviews);
      if (configs.status?.length) setStatusOptions(configs.status);
      if (configs.agreementType?.length) setTypeOptions(configs.agreementType);
      if (configs.agreementSubtype?.length) setSubtypeOptions(configs.agreementSubtype);
      setTypeSubtypeMap(map);
    } catch (err) {
      console.error('Failed to load agreement metadata (non-blocking):', err);
    }

    try {
      const accs = await listAccounts();
      setAccounts(accs);
    } catch (err) {
      console.error('Failed to load accounts (non-blocking):', err);
    }

    try {
      setReverseRelatedAgreements(await listAgreementsRelatedTo(agreementId));
    } catch (err) {
      console.error('Failed to load related agreements (non-blocking):', err);
    }

    if (agr.relatedAgreementId) {
      try {
        const related = await getAgreement(agr.relatedAgreementId);
        setRelatedAgreementTitle(related.title || '');
      } catch (err) {
        console.error('Failed to load linked agreement title (non-blocking):', err);
        setRelatedAgreementTitle('');
      }
    } else {
      setRelatedAgreementTitle('');
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!agreementId) return;
    load();
  }, [agreementId]);

  // Logged once per page visit (not on every load() refresh after an
  // action) - agreement.title becomes available once `load` finishes.
  const loggedViewRef = useRef(null);
  useEffect(() => {
    if (!agreement || loggedViewRef.current === agreementId) return;
    loggedViewRef.current = agreementId;
    logAuditEvent('viewed', 'agreement', agreementId, agreement.title);
  }, [agreement, agreementId]);

  const pipelineIndex = PIPELINE_STATUSES.indexOf(agreement?.status || 'Draft');

  const handleStartEdit = () => {
    setForm({
      title: agreement.title || '',
      accountId: agreement.accountId || '',
      accountName: agreement.accountName || '',
      account2Id: agreement.account2Id || '',
      account2Name: agreement.account2Name || '',
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
    if (name === 'account2Id') {
      const acc = accounts.find((a) => a.id === value);
      setForm((prev) => ({ ...prev, account2Id: value, account2Name: acc?.name || '' }));
    } else if (name === 'accountId') {
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
      indexObject('agreement', agreementId).catch((err) => console.warn('Background indexing failed:', err));
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
    if (!(await confirm({ title: 'Delete agreement', message: `"${agreement.title}" and its documents will be permanently deleted. This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
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
      const account2 = agreement.account2Id ? await getAccount(agreement.account2Id) : null;
      const filledHtml = fillTemplateHtml(template.contentHtml, { agreement, account, account2, template });
      const docxBlob = await htmlToDocxBlob(wrapAsHtmlDocument(filledHtml));

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
        agreementTitle: agreement.title,
      });
      indexObject('agreement', agreementId).catch((err) => console.warn('Background indexing failed:', err));

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

  const handlePreviewAttachment = async (attachment) => {
    try {
      let html = attachment.sourceHtml;
      if (!html && attachment.dataBase64) {
        const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
        const result = await mammoth.convertToHtml({ arrayBuffer });
        html = result.value;
      }
      if (!html || !html.trim()) {
        alert('This file has no readable content to preview.');
        return;
      }
      const blob = new Blob([wrapAsHtmlDocument(html)], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to preview attachment:', err);
      alert('Could not preview this file.');
    }
  };

  const handleDownloadAttachment = async (attachment) => {
    try {
      // Documents generated in the app keep their source HTML. Rebuild a regular
      // .docx from it, so older files (whose Word-only format shows up empty in
      // Pages, Google Docs or Preview) download correctly too.
      const rebuild = attachment.sourceHtml && /\.docx$/i.test(attachment.name || '');
      const blob = rebuild
        ? await htmlToDocxBlob(wrapAsHtmlDocument(attachment.sourceHtml))
        : base64ToBlob(attachment.dataBase64, attachment.mimeType || DOCX_MIME);
      downloadBlob(blob, attachment.name || 'document.docx');
    } catch (err) {
      console.error('Failed to download attachment:', err);
      alert('Could not download this file.');
    }
  };

  const handleSyncAgreementToSalesforce = async () => {
    if (sfSyncing) return;
    setSfSyncing(true);
    try {
      const result = await syncAgreementToSalesforce(agreementId);
      logAuditEvent('synced_to_salesforce', 'agreement', agreementId, agreement.title, {
        action: result.action,
        sfStatus: result.sfStatus,
        documents: (result.files?.created || 0) + (result.files?.newVersion || 0),
      });
      await load();
      const titles = {
        created: 'Contract created in Salesforce',
        updated: 'Contract updated in Salesforce',
        unchanged: 'Contract already up to date',
      };
      const f = result.files || { created: 0, newVersion: 0, unchanged: 0, failed: [] };
      const sent = f.created + f.newVersion;
      const fileLine = sent > 0
        ? ` ${sent} document${sent === 1 ? '' : 's'} sent.`
        : f.unchanged > 0 ? ' Documents already up to date.' : '';
      const base = `"${agreement.title}" is under ${agreement.accountName || 'the account'} in Salesforce, with status ${result.sfStatus}.${fileLine}`;
      setSfNotice(f.failed.length > 0
        ? {
            type: 'error',
            title: 'Contract synced, but some documents failed',
            message: `${base} Not sent: ${f.failed.join('; ')}`,
          }
        : { type: 'success', title: titles[result.action] || 'Synced with Salesforce', message: base });
    } catch (err) {
      console.error('Failed to sync agreement to Salesforce:', err);
      setSfNotice({ type: 'error', title: 'Could not sync with Salesforce', message: err.message });
    } finally {
      setSfSyncing(false);
    }
  };

  const handleSendToSalesforce = async (attachment) => {
    if (sfPushingId) return;
    setSfPushingId(attachment.id);
    try {
      const result = await pushAttachmentToSalesforce(agreementId, attachment.id);
      if (!result.unchanged) {
        logAuditEvent('sent_to_salesforce', 'agreement', agreementId, agreement.title, {
          document: attachment.name,
          outcome: result.newVersion ? 'new version' : 'first upload',
        });
      }
      await load();
      setSfNotice({
        type: 'success',
        title: result.unchanged
          ? 'Already up to date in Salesforce'
          : result.newVersion ? 'New version sent to Salesforce' : 'Sent to Salesforce',
        message: result.unchanged
          ? `"${attachment.name}" has not changed since it was last sent.`
          : `"${attachment.name}" is now in the Files of ${agreement.accountName || 'the account'}${agreement.sfContractId ? ' and of its contract' : ''} in Salesforce.`,
      });
    } catch (err) {
      console.error('Failed to send to Salesforce:', err);
      setSfNotice({ type: 'error', title: 'Could not send to Salesforce', message: err.message });
    } finally {
      setSfPushingId('');
    }
  };

  const handleDeleteAttachment = async (attachment) => {
    if (!(await confirm({ title: 'Remove document', message: `"${attachment.name}" will be removed from this agreement.`, confirmLabel: 'Remove', danger: true }))) return;
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
        const blob = await htmlToDocxBlob(wrapAsHtmlDocument(mergedHtml));
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

  const openRelationModal = async () => {
    setShowRelationModal(true);
    setRelationError('');
    setRelationDraftType(agreement.relationType || 'renewal');
    setRelationDraftTargetId(agreement.relatedAgreementId || '');
    setLoadingRelationPicker(true);
    try {
      const all = await listAgreements();
      setRelationPickerAgreements(all.filter((a) => a.id !== agreementId));
    } catch (err) {
      console.error('Failed to load agreements for the relation picker:', err);
      setRelationError('Could not load the list of agreements.');
    } finally {
      setLoadingRelationPicker(false);
    }
  };

  const closeRelationModal = () => {
    if (savingRelation) return;
    setShowRelationModal(false);
  };

  const handleSaveRelation = async () => {
    if (!relationDraftTargetId) {
      setRelationError('Choose an agreement to link to.');
      return;
    }
    setSavingRelation(true);
    setRelationError('');
    try {
      await updateAgreement(agreementId, { relatedAgreementId: relationDraftTargetId, relationType: relationDraftType });
      setShowRelationModal(false);
      await load();
    } catch (err) {
      console.error('Failed to save relation:', err);
      setRelationError('Could not save this link. Please try again.');
    } finally {
      setSavingRelation(false);
    }
  };

  const handleRemoveRelation = async () => {
    setSavingRelation(true);
    setRelationError('');
    try {
      await updateAgreement(agreementId, { relatedAgreementId: null, relationType: null });
      setShowRelationModal(false);
      await load();
    } catch (err) {
      console.error('Failed to remove relation:', err);
      setRelationError('Could not remove this link. Please try again.');
    } finally {
      setSavingRelation(false);
    }
  };

  const openNotifyModal = async () => {
    setShowNotifyModal(true);
    setNotifyError('');
    setLoadingNotify(true);
    try {
      const defaults = await getReminderSettings();
      setTenantDefaultDays(defaults);
      if (agreement.reminderDaysOverride) {
        setNotifyMode('custom');
        setNotifyDays(agreement.reminderDaysOverride);
      } else {
        setNotifyMode('default');
        setNotifyDays(defaults);
      }
    } catch (err) {
      console.error('Failed to load reminder settings:', err);
      setNotifyError('Could not load reminder settings.');
    } finally {
      setLoadingNotify(false);
    }
  };

  const closeNotifyModal = () => {
    if (savingNotify) return;
    setShowNotifyModal(false);
  };

  const handleAddNotifyDay = () => {
    const value = parseInt(newNotifyDay, 10);
    if (!Number.isFinite(value) || value <= 0 || notifyDays.includes(value)) return;
    setNotifyDays((prev) => [...prev, value].sort((a, b) => b - a));
    setNewNotifyDay('');
  };

  const handleRemoveNotifyDay = (value) => {
    setNotifyDays((prev) => prev.filter((d) => d !== value));
  };

  const handleSaveNotify = async () => {
    setSavingNotify(true);
    setNotifyError('');
    try {
      await updateAgreement(agreementId, { reminderDaysOverride: notifyMode === 'custom' ? notifyDays : null });
      setShowNotifyModal(false);
      await load();
    } catch (err) {
      console.error('Failed to save reminder settings:', err);
      setNotifyError('Could not save this. Please try again.');
    } finally {
      setSavingNotify(false);
    }
  };

  const openCompareModal = () => {
    setShowCompareModal(true);
    setCompareError('');
    setCompareTokens(null);
    const attachments = mergeableAttachments;
    if (attachments.length >= 2) {
      setCompareFromId(attachments[attachments.length - 1].id);
      setCompareToId(attachments[0].id);
    } else {
      setCompareFromId('');
      setCompareToId('');
    }
  };

  const closeCompareModal = () => {
    if (comparing) return;
    setShowCompareModal(false);
  };

  const handleRunCompare = async () => {
    if (!compareFromId || !compareToId || compareFromId === compareToId) {
      setCompareError('Choose two different versions to compare.');
      return;
    }
    setComparing(true);
    setCompareError('');
    setCompareTokens(null);
    try {
      const attachmentsById = new Map((agreement.attachments || []).map((a) => [a.id, a]));
      const fromAttachment = attachmentsById.get(compareFromId);
      const toAttachment = attachmentsById.get(compareToId);
      if (!fromAttachment || !toAttachment) {
        setCompareError('Could not find one of the selected versions.');
        return;
      }
      const [fromHtml, toHtml] = await Promise.all([
        attachmentToMergeHtml(fromAttachment),
        attachmentToMergeHtml(toAttachment),
      ]);
      setCompareTokens(computeChangeTokens(fromHtml, toHtml));
    } catch (err) {
      console.error('Failed to compare versions:', err);
      setCompareError('Something went wrong while comparing these versions.');
    } finally {
      setComparing(false);
    }
  };

  const openReviewModal = () => {
    setShowReviewModal(true);
    setReviewError('');
    setReviewAttachmentId('');
    setReviewersList([{ name: '', email: '' }]);
    setReviewCc('');
    setReviewMessage('');
  };

  const closeReviewModal = () => {
    if (sendingReview) return;
    setShowReviewModal(false);
  };

  const updateReviewerAt = (index, field, value) => {
    setReviewersList((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const addReviewerRow = () => {
    if (reviewersList.length >= 10) return;
    setReviewersList((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeReviewerAt = (index) => {
    setReviewersList((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleSendToReview = async () => {
    const attachment = mergeableAttachments.find((a) => a.id === reviewAttachmentId);
    if (!attachment) {
      setReviewError('Select a document to send.');
      return;
    }
    const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email.trim());
    if (reviewersList.length === 0 || !reviewersList.every((r) => isValidEmail(r.email))) {
      setReviewError('Enter a valid email for every reviewer.');
      return;
    }

    setSendingReview(true);
    setReviewError('');
    let emailWarning = '';
    try {
      const originalHtml = await attachmentToMergeHtml(attachment);
      const ccEmail = reviewCc.trim();
      const currentUser = agreement.createdBy || 'EsoVia';
      const batchId = crypto.randomUUID();

      // Sequential chain: create a Pending row for every reviewer up front,
      // but only email the first one — submitting on the public review page
      // emails the next reviewer in the batch.
      let firstReviewId = '';
      for (let i = 0; i < reviewersList.length; i += 1) {
        const reviewer = reviewersList[i];
        const reviewId = await createReviewRequest({
          agreementId,
          agreementTitle: agreement.title,
          attachmentId: attachment.id,
          attachmentName: attachment.name,
          originalHtml,
          reviewerEmail: reviewer.email.trim(),
          reviewerName: reviewer.name.trim(),
          message: reviewMessage,
          sequence: i + 1,
          batchId,
          requestedBy: currentUser,
        });
        if (i === 0) firstReviewId = reviewId;
      }

      try {
        await sendReviewEmail({ reviewId: firstReviewId, ccEmail });
      } catch (emailErr) {
        console.error('Failed to send the review email:', emailErr);
        emailWarning = `Review link${reviewersList.length > 1 ? 's' : ''} created, but the notification email couldn't be sent (${describeEmailError(emailErr)}) - copy the link manually below.`;
      }

      const advancedStatus = computeAdvancedStatus(agreement.status, 'In review');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      await load();
      if (emailWarning) {
        setReviewError(emailWarning);
      } else {
        setShowReviewModal(false);
        setActiveNav('attachments');
      }
    } catch (err) {
      console.error('Failed to send document for review:', err);
      setReviewError('Something went wrong while sending the document for review. Please try again.');
    } finally {
      setSendingReview(false);
    }
  };

  const handleCopyReviewLink = async (reviewRequest) => {
    const link = `${window.location.origin}/review/${reviewRequest.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedReviewId(reviewRequest.id);
      setTimeout(() => setCopiedReviewId(''), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      window.prompt('Copy this link:', link);
    }
  };

  const handlePreviewSubmittedChanges = (reviewRequest) => {
    if (!reviewRequest.submittedHtml) return;
    const blob = new Blob([wrapAsHtmlDocument(reviewRequest.submittedHtml)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const activeChangeTokens = activeReviewRequest?.redlineTokens || [];
  const activeChangeIds = listChangeIds(activeChangeTokens);
  const pendingChangeCount = activeChangeIds.filter((id) => !changeDecisions[id]).length;

  const openChangesModal = (reviewRequest) => {
    setActiveReviewRequest(reviewRequest);
    setChangeDecisions({});
    const ids = listChangeIds(reviewRequest?.redlineTokens || []);
    setCurrentChangeId(ids[0] || null);
    setShowChangesModal(true);
  };

  const closeChangesModal = () => {
    if (processingReviewId) return;
    setShowChangesModal(false);
    setActiveReviewRequest(null);
    setChangeDecisions({});
    setCurrentChangeId(null);
  };

  const goToChange = (id) => setCurrentChangeId(id);

  useEffect(() => {
    if (!currentChangeId || !redlineMainRef.current) return;
    const el = redlineMainRef.current.querySelector(`[data-change-id="${currentChangeId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentChangeId]);

  const decideChange = (id, decision) => {
    setChangeDecisions((prev) => ({ ...prev, [id]: decision }));
    const idx = activeChangeIds.indexOf(id);
    const nextPending = activeChangeIds.slice(idx + 1).find((cid) => !changeDecisions[cid] && cid !== id);
    if (nextPending) setCurrentChangeId(nextPending);
  };

  const handleMainPanelClick = (e) => {
    const wrapper = e.target.closest('[data-change-id]');
    if (wrapper) setCurrentChangeId(wrapper.getAttribute('data-change-id'));
  };

  const handleAcceptAllRemaining = () => {
    setChangeDecisions((prev) => {
      const next = { ...prev };
      activeChangeIds.forEach((id) => { if (!next[id]) next[id] = 'accepted'; });
      return next;
    });
  };

  const handleRejectAllRemaining = () => {
    setChangeDecisions((prev) => {
      const next = { ...prev };
      activeChangeIds.forEach((id) => { if (!next[id]) next[id] = 'rejected'; });
      return next;
    });
  };

  const handleFinalizeReview = async () => {
    if (!activeReviewRequest) return;
    setProcessingReviewId(activeReviewRequest.id);
    try {
      const finalHtml = buildFinalHtmlFromTokens(activeChangeTokens, changeDecisions);
      const docxBlob = await htmlToDocxBlob(wrapAsHtmlDocument(finalHtml));
      const dataBase64 = await blobToBase64(docxBlob);
      const version = (agreement.attachments || []).length + 1;
      const newAttachment = {
        id: `att_${Date.now()}`,
        name: buildRedlineFileName(activeReviewRequest.attachmentName, version),
        size: docxBlob.size,
        mimeType: DOCX_MIME,
        dataBase64,
        sourceHtml: finalHtml,
        version,
        basedOnReviewId: activeReviewRequest.id,
        uploadedAt: new Date().toISOString(),
      };
      await addAgreementAttachment(agreementId, newAttachment);
      await acceptReviewChanges(activeReviewRequest.id);
      indexObject('agreement', agreementId).catch((err) => console.warn('Background indexing failed:', err));

      const advancedStatus = computeAdvancedStatus(agreement.status, 'Reviewed');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      setShowChangesModal(false);
      setActiveReviewRequest(null);
      setChangeDecisions({});
      setCurrentChangeId(null);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to finalize review changes:', err);
      alert('Could not finalize the review. Please try again.');
    } finally {
      setProcessingReviewId('');
    }
  };

  const handleRejectReviewChanges = async (reviewRequest) => {
    if (!(await confirm({ title: 'Reject submission', message: 'None of the reviewer\'s changes will be applied.', confirmLabel: 'Reject', danger: true }))) return;
    setProcessingReviewId(reviewRequest.id);
    try {
      await rejectReviewChanges(reviewRequest.id);
      await load();
    } catch (err) {
      console.error('Failed to reject review changes:', err);
      alert('Could not reject the changes. Please try again.');
    } finally {
      setProcessingReviewId('');
    }
  };

  const openApprovalModal = () => {
    setShowApprovalModal(true);
    setApprovalError('');
    setApprovalAttachmentId('');
    setApproversList([{ name: '', email: '' }]);
    setApprovalMessage('');
  };

  const closeApprovalModal = () => {
    if (sendingApproval) return;
    setShowApprovalModal(false);
  };

  const updateApproverAt = (index, field, value) => {
    setApproversList((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const addApproverRow = () => {
    if (approversList.length >= 10) return;
    setApproversList((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeApproverAt = (index) => {
    setApproversList((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleSendForApproval = async () => {
    const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email.trim());
    if (approversList.length === 0 || !approversList.every((a) => isValidEmail(a.email))) {
      setApprovalError('Enter a valid email for every approver.');
      return;
    }
    const attachment = (agreement.attachments || []).find((a) => a.id === approvalAttachmentId) || null;
    const currentUser = agreement.createdBy || 'EsoVia';
    const batchId = crypto.randomUUID();

    setSendingApproval(true);
    setApprovalError('');
    try {
      // Sequential chain: create a Pending row for every approver up front
      // (so the internal view shows the whole queue), but only email the
      // first one now — decideApprovalRequest on the public page emails (server-side) the
      // next approver in the batch once each one approves.
      let firstApprovalId = '';
      for (let i = 0; i < approversList.length; i += 1) {
        const approver = approversList[i];
        const approvalId = await createApprovalRequest({
          agreementId,
          agreementTitle: agreement.title,
          attachment,
          approverEmail: approver.email.trim(),
          approverName: approver.name.trim(),
          message: approvalMessage,
          sequence: i + 1,
          batchId,
          requestedBy: currentUser,
        });
        if (i === 0) firstApprovalId = approvalId;
      }

      const approvalLink = `${window.location.origin}/approve/${firstApprovalId}`;

      try {
        await sendApprovalEmail({ approvalId: firstApprovalId });
      } catch (emailErr) {
        console.error('Failed to send the approval email:', emailErr);
        setApprovalError(
          `The approval request${approversList.length > 1 ? 's were' : ' was'} created, but the email could not be sent. Share this link manually: ${approvalLink}`
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

  const handleOpenReviewAI = async () => {
    setShowReviewAIModal(true);
    setReviewAIError('');
    setAiReview(null);
    setReviewModalView('list');
    setActiveSuggestionIndex(null);
    setAppliedSuggestionIndexes([]);
    setPendingReviewEditsHtml(null);
    setActiveRedlineRef(null);
    setAppliedRedlineRefs([]);
    setAvailablePlaybooks([]);
    setSelectedPlaybookIds([]);
    const attachments = agreement.attachments || [];
    if (attachments.length === 0) {
      setAiReviewAttachmentId('');
      setReviewAIError('This agreement has no attached document to review yet.');
    } else if (attachments.length === 1) {
      setAiReviewAttachmentId(attachments[0].id);
    } else {
      setAiReviewAttachmentId('ALL');
    }

    if (agreement.accountId) {
      try {
        const playbooks = await listPlaybooksByAccount(agreement.accountId);
        setAvailablePlaybooks(playbooks);
        setSelectedPlaybookIds(playbooks.map((pb) => pb.id));
      } catch (err) {
        console.warn('Could not load account playbooks (non-blocking):', err);
      }
    }
  };

  const togglePlaybookSelected = (id) => {
    setSelectedPlaybookIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const closeReviewAIModal = () => {
    if (reviewingAI || savingReviewEdits) return;
    setShowReviewAIModal(false);
  };

  const openSuggestionDetail = (index) => {
    setActiveSuggestionIndex(index);
    setReviewModalView('detail');
  };

  const backToReviewList = () => {
    setReviewModalView('list');
    setActiveSuggestionIndex(null);
    setActiveRedlineRef(null);
  };

  const handleApplySuggestion = async (suggestion, index) => {
    if (appliedSuggestionIndexes.includes(index) || !suggestion.suggestedText) return;
    try {
      let baseHtml = pendingReviewEditsHtml;
      if (baseHtml === null) {
        const attachment = (agreement.attachments || []).find((a) => a.id === aiReviewAttachmentId);
        if (!attachment) return;
        baseHtml = await attachmentToMergeHtml(attachment);
      }

      const container = document.createElement('div');
      container.innerHTML = sanitizeDocumentHtml(baseHtml);

      const nextNumber = detectNextClauseNumberNode(container);
      const p = document.createElement('p');
      p.textContent = nextNumber
        ? `${nextNumber}. ${suggestion.title}. ${suggestion.suggestedText}`
        : `${suggestion.title}. ${suggestion.suggestedText}`;

      const signatureBlock = findSignatureBlockNode(container);
      if (signatureBlock) {
        container.insertBefore(p, signatureBlock);
      } else {
        container.appendChild(p);
      }

      setPendingReviewEditsHtml(container.innerHTML);
      setAppliedSuggestionIndexes((prev) => [...prev, index]);
    } catch (err) {
      console.error('Failed to apply suggestion:', err);
      alert('Could not apply this suggestion. Please try again.');
    }
  };

  const openRedlineDetail = (source, index) => {
    setActiveRedlineRef({ source, index });
    setReviewModalView('redline-detail');
  };

  const handleApplyRedline = async (item, refKey) => {
    if (appliedRedlineRefs.includes(refKey) || !item.originalExcerpt || !item.proposedText) return;
    try {
      let baseHtml = pendingReviewEditsHtml;
      if (baseHtml === null) {
        const attachment = (agreement.attachments || []).find((a) => a.id === aiReviewAttachmentId);
        if (!attachment) return;
        baseHtml = await attachmentToMergeHtml(attachment);
      }

      const container = document.createElement('div');
      container.innerHTML = sanitizeDocumentHtml(baseHtml);

      const replaced = findAndReplaceTextNode(container, item.originalExcerpt, item.proposedText);
      if (!replaced) {
        alert("Couldn't locate that exact text in the document anymore - it may have moved or already been edited.");
        return;
      }

      setPendingReviewEditsHtml(container.innerHTML);
      setAppliedRedlineRefs((prev) => [...prev, refKey]);
    } catch (err) {
      console.error('Failed to apply redline:', err);
      alert('Could not apply this change. Please try again.');
    }
  };

  const handleSaveReviewEdits = async () => {
    if (!pendingReviewEditsHtml) return;
    setSavingReviewEdits(true);
    try {
      const sourceAttachment = (agreement.attachments || []).find((a) => a.id === aiReviewAttachmentId);
      const docxBlob = await htmlToDocxBlob(wrapAsHtmlDocument(pendingReviewEditsHtml));
      const dataBase64 = await blobToBase64(docxBlob);
      const version = (agreement.attachments || []).length + 1;
      const newAttachment = {
        id: `att_${Date.now()}`,
        name: `${(sourceAttachment?.name || 'Document').replace(/\.docx$/i, '')} - v${version} - AI Suggestions.docx`,
        size: docxBlob.size,
        mimeType: DOCX_MIME,
        dataBase64,
        sourceHtml: pendingReviewEditsHtml,
        version,
        uploadedAt: new Date().toISOString(),
      };
      await addAgreementAttachment(agreementId, newAttachment);
      indexObject('agreement', agreementId).catch((err) => console.warn('Background indexing failed:', err));
      setPendingReviewEditsHtml(null);
      setAppliedSuggestionIndexes([]);
      setAppliedRedlineRefs([]);
      setShowReviewAIModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to save the AI-suggested changes:', err);
      alert('Could not save the new document version. Please try again.');
    } finally {
      setSavingReviewEdits(false);
    }
  };

  const openSignatureModal = () => {
    setShowSignatureModal(true);
    setSignatureError('');
    setSignersList([{ name: '', email: '' }]);
    setCcList([]);
    setSignatureMessage('');
    const attachments = agreement.attachments || [];
    setSignatureAttachmentIds(attachments.length === 1 ? [attachments[0].id] : []);
  };

  const toggleSignatureAttachment = (id) => {
    setSignatureAttachmentIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const closeSignatureModal = () => {
    if (sendingSignature || markingManualSignature) return;
    setShowSignatureModal(false);
  };

  // Generic drag-to-reorder for the signer/approver/reviewer lists — only
  // one of those modals is ever open at once, so a single piece of drag
  // state is safe to share across all three.
  const handleDragStart = (index) => (e) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverRow = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropReorder = (setter, targetIndex) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) return;
    setter((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIndex, 1);
      updated.splice(targetIndex, 0, moved);
      return updated;
    });
    setDragIndex(null);
  };

  const handleDragEnd = () => setDragIndex(null);

  const updateSignerAt = (index, field, value) => {
    setSignersList((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const addSignerRow = () => {
    if (signersList.length >= 10) return;
    setSignersList((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeSignerAt = (index) => {
    setSignersList((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const updateCcAt = (index, field, value) => {
    setCcList((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const addCcRow = () => {
    if (ccList.length >= 10) return;
    setCcList((prev) => [...prev, { name: '', email: '' }]);
  };

  const removeCcAt = (index) => {
    setCcList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendForSignature = async () => {
    const isValidSigner = (name, email) => name.trim() && /^\S+@\S+\.\S+$/.test(email.trim());
    const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email.trim());

    if (signatureAttachmentIds.length === 0) {
      setSignatureError('Choose at least one document to send.');
      return;
    }
    if (signersList.length === 0 || !signersList.every((s) => isValidSigner(s.name, s.email))) {
      setSignatureError('Enter a valid name and email for every signer.');
      return;
    }
    const ccToSend = ccList.filter((r) => r.email.trim() || r.name.trim());
    if (ccToSend.some((r) => !isValidEmail(r.email))) {
      setSignatureError('Enter a valid email for every recipient in copy.');
      return;
    }

    const attachmentsById = new Map((agreement.attachments || []).map((a) => [a.id, a]));
    const selectedAttachments = signatureAttachmentIds.map((id) => attachmentsById.get(id)).filter(Boolean);
    const documents = await Promise.all(selectedAttachments.map(async (att) => {
      const payload = await attachmentToDocusignPayloadSafe(att);
      return payload && { documentBase64: payload.documentBase64, documentName: att.name, fileExtension: payload.fileExtension };
    }));
    if (documents.some((d) => !d)) {
      setSignatureError('Could not read one of the selected documents - try a different attachment.');
      return;
    }

    const signers = signersList.map((s) => ({ name: s.name.trim(), email: s.email.trim() }));
    const ccRecipients = ccToSend.map((r) => ({ name: r.name.trim(), email: r.email.trim() }));
    const combinedName = selectedAttachments.map((a) => a.name).join(', ');

    setSendingSignature(true);
    setSignatureError('');
    try {
      const envelope = await sendForSignature({
        documents,
        signers,
        ccRecipients,
        emailSubject: `Please sign: ${agreement.title}`,
        emailMessage: signatureMessage,
      });

      await addDocusignEnvelope(agreementId, {
        envelopeId: envelope.envelopeId,
        attachmentName: combinedName,
        documentCount: documents.length,
        signers,
        ccRecipients,
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

  const handleMarkSignedManually = async () => {
    if (signatureAttachmentIds.length !== 1) {
      setSignatureError('Choose exactly one document to mark as signed manually.');
      return;
    }
    const attachment = (agreement.attachments || []).find((a) => a.id === signatureAttachmentIds[0]);
    if (!attachment) {
      setSignatureError('Could not find that document - try a different attachment.');
      return;
    }

    setMarkingManualSignature(true);
    setSignatureError('');
    try {
      const user = await getCurrentUser();
      await addDocusignEnvelope(agreementId, {
        envelopeId: `manual-${Date.now()}`,
        manual: true,
        attachmentName: attachment.name,
        signedAttachmentId: attachment.id,
        signers: [],
        status: 'completed',
        markedBy: user?.email || 'Unknown',
        completedAt: new Date().toISOString(),
      });

      const advancedStatus = computeAdvancedStatus(agreement.status, 'Signed');
      if (advancedStatus) {
        await updateAgreementStatus(agreementId, advancedStatus);
      }

      setShowSignatureModal(false);
      setActiveNav('attachments');
      await load();
    } catch (err) {
      console.error('Failed to mark as signed manually:', err);
      setSignatureError(err.message || 'Something went wrong while marking this as signed.');
    } finally {
      setMarkingManualSignature(false);
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
          const documentId = (envelope?.documentCount || 1) > 1 ? 'combined' : undefined;
          const signedDoc = await getSignedDocument(envelopeId, documentId);
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
    setActivateCc('');
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
        try {
          await sendActivationEmail({
            agreementId,
            toEmail: email,
            toName: activateNotifyName,
            message: activateMessage,
            ccEmail: activateCc.trim(),
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

  useEffect(() => {
    if (activeNav !== 'obligations') return undefined;
    let cancelled = false;
    setObligationsLoading(true);
    setObligationsError('');
    listObligations(agreementId)
      .then((rows) => { if (!cancelled) setObligations(rows); })
      .catch((err) => {
        console.error('Failed to load obligations:', err);
        if (!cancelled) setObligationsError('Could not load the obligations. Has 008_obligations.sql been run in Supabase?');
      })
      .finally(() => { if (!cancelled) setObligationsLoading(false); });
    return () => { cancelled = true; };
  }, [activeNav, agreementId]);

  const handleFindObligations = async () => {
    setFindingObligations(true);
    setObligationsError('');
    try {
      const result = await findObligations(agreementId);
      setObligationSummary(result.summary || '');
      setObligationProposals((result.obligations || []).map((o) => ({ ...o, selected: true })));
    } catch (err) {
      console.error('Failed to find obligations:', err);
      setObligationsError(err.message || 'Could not find obligations. Please try again.');
    } finally {
      setFindingObligations(false);
    }
  };

  const updateObligationProposal = (index, patch) =>
    setObligationProposals((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const handleSaveObligationProposals = async () => {
    const chosen = (obligationProposals || []).filter((p) => p.selected);
    if (chosen.length === 0) return;
    setSavingObligations(true);
    setObligationsError('');
    try {
      const saved = await createObligations(
        agreementId,
        chosen.map((p) => ({
          description: p.description,
          responsibleParty: p.responsibleParty,
          dueDate: p.dueDate,
          recurrence: p.recurrence,
          trigger: p.trigger,
          clause: p.clause,
          sourceQuote: p.quote,
        })),
        'ai'
      );
      setObligations((prev) => [...prev, ...saved]);
      setObligationProposals((prev) => {
        const rest = (prev || []).filter((p) => !p.selected);
        return rest.length > 0 ? rest : null;
      });
    } catch (err) {
      console.error('Failed to save obligations:', err);
      setObligationsError('Could not save the obligations. Please try again.');
    } finally {
      setSavingObligations(false);
    }
  };

  const handleToggleObligation = async (ob) => {
    try {
      const updated = await setObligationStatus(ob.id, ob.status === 'done' ? 'open' : 'done');
      setObligations((prev) => prev.map((o) => (o.id === ob.id ? updated : o)));
    } catch (err) {
      console.error('Failed to update obligation:', err);
      setObligationsError('Could not update the obligation.');
    }
  };

  const handleDeleteObligation = async (ob) => {
    try {
      await deleteObligation(ob.id);
      setObligations((prev) => prev.filter((o) => o.id !== ob.id));
    } catch (err) {
      console.error('Failed to delete obligation:', err);
      setObligationsError('Could not delete the obligation.');
    }
  };

  useEffect(() => {
    if (activeNav !== 'renewal') return undefined;
    let cancelled = false;
    listTasks({ status: 'open', agreementId })
      .then((rows) => { if (!cancelled) setAgreementTasks(rows); })
      .catch((err) => console.error('Failed to load tasks:', err));
    return () => { cancelled = true; };
  }, [activeNav, agreementId]);

  const saveNotice = async (days, auto) => {
    setSavingNotice(true);
    setNoticeMessage('');
    try {
      await updateAgreement(agreementId, { noticePeriodDays: days, autoRenewal: auto });
      await load();
      setNoticeMessage('Saved.');
    } catch (err) {
      console.error('Failed to save notice period:', err);
      setNoticeMessage('Could not save the notice period.');
    } finally {
      setSavingNotice(false);
    }
  };

  const handleSaveNotice = () => {
    const raw = String(noticeDaysInput).trim();
    const days = raw === '' ? null : Number(raw);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      setNoticeMessage('Enter the notice period as a whole number of days.');
      return;
    }
    saveNotice(days, autoRenewalInput === '' ? null : autoRenewalInput === 'yes');
  };

  const handleUseBriefTerm = () => {
    const term = renewalBrief?.term || {};
    const days = Number.isInteger(term.noticePeriodDays) ? term.noticePeriodDays : agreement.noticePeriodDays ?? null;
    const auto = typeof term.autoRenewal === 'boolean' ? term.autoRenewal : agreement.autoRenewal ?? null;
    setNoticeDaysInput(days ?? '');
    setAutoRenewalInput(auto === null ? '' : auto ? 'yes' : 'no');
    saveNotice(days, auto);
  };

  const handleCreateTasksFromBrief = async () => {
    const steps = (renewalBrief?.nextSteps || []).filter((_, i) => selectedSteps[i]);
    if (!steps.length) return;
    setCreatingTasks(true);
    setRenewalError('');
    try {
      const created = await createTasks(
        steps.map((st) => ({
          title: st.step.length > 140 ? `${st.step.slice(0, 137)}…` : st.step,
          details: st.step.length > 140 ? st.step : `From the renewal brief of "${agreement.title}".`,
          taskType: 'renewal',
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(st.by || '') ? st.by : null,
          agreementId,
          accountId: agreement.accountId || null,
        })),
        'agent'
      );
      setAgreementTasks((prev) => [...created, ...prev]);
      setSelectedSteps([]);
    } catch (err) {
      console.error('Failed to create tasks:', err);
      setRenewalError('Could not create the tasks.');
    } finally {
      setCreatingTasks(false);
    }
  };

  const handlePrepareRenewalBrief = async () => {
    setRenewalLoading(true);
    setRenewalError('');
    setSelectedSteps([]);
    try {
      setRenewalBrief(await prepareRenewalBrief(agreementId));
    } catch (err) {
      console.error('Failed to prepare renewal brief:', err);
      setRenewalError(err.message || 'Could not prepare the renewal brief. Please try again.');
    } finally {
      setRenewalLoading(false);
    }
  };

  const handleRunReviewAI = async () => {
    if (!aiReviewAttachmentId) return;
    setReviewingAI(true);
    setReviewAIError('');
    setAiReview(null);
    setAppliedSuggestionIndexes([]);
    setPendingReviewEditsHtml(null);
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

      const selectedPlaybooks = availablePlaybooks.filter((pb) => selectedPlaybookIds.includes(pb.id));
      const playbook = selectedPlaybooks.map(playbookToReviewText).join('\n\n');

      const metadata = {
        accountId: agreement.accountId || null,
        title: agreement.title,
        accountName: agreement.accountName,
        agreementType: agreement.agreementType,
        agreementSubtype: agreement.agreementSubtype,
        status: agreement.status,
        effectiveDate: agreement.effectiveDate,
        endDate: agreement.endDate,
        playbook,
      };

      const review = await reviewAgreementWithAI(documentText, metadata);
      setAiReview(review);

      const reviewSummary = {
        riskLevel: review.riskLevel || 'medium',
        highRiskCount: (review.risks || []).filter((r) => r.severity === 'high').length,
        playbookViolationCount: (review.playbookViolations || []).length,
        reviewedAt: new Date().toISOString(),
      };
      saveAgreementReviewSummary(agreementId, reviewSummary).catch((err) =>
        console.warn('Could not save review summary for account health score:', err)
      );
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
          <option value="">- Select -</option>
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
        {canWrite && (        <button
          type="button"
          className={`agrd__bell-btn ${agreement.reminderDaysOverride ? 'agrd__bell-btn--custom' : ''}`}
          onClick={openNotifyModal}
          title={agreement.reminderDaysOverride ? 'Custom expiry reminders set for this agreement' : 'Set expiry reminders for this agreement'}
          aria-label="Set expiry reminders"
        >
          <BellIcon />
        </button>)}
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

      <div className="agrd__relations">
          {agreement.relatedAgreementId && (
            <div className="agrd__relation-row">
              <span className="agrd__relation-label">{agreement.relationType === 'amendment' ? 'Amends' : 'Renews'}</span>
              <button type="button" className="agrd__relation-link" onClick={() => navigate(`/dashboard/agreements/${agreement.relatedAgreementId}`)}>
                {relatedAgreementTitle || 'View agreement'}
              </button>
            </div>
          )}
          {reverseRelatedAgreements.map((rel) => (
            <div key={rel.id} className="agrd__relation-row">
              <span className="agrd__relation-label">{rel.relationType === 'amendment' ? 'Amended by' : 'Renewed by'}</span>
              <button type="button" className="agrd__relation-link" onClick={() => navigate(`/dashboard/agreements/${rel.id}`)}>
                {rel.title}
              </button>
            </div>
          ))}
          {canWrite && (
          <button type="button" className="agrd__btn-secondary-sm" onClick={openRelationModal}>
            {agreement.relatedAgreementId ? 'Edit link to another agreement' : '+ Link to another agreement'}
          </button>
          )}
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
          <button className={`agrd__nav-btn ${activeNav === 'obligations' ? 'agrd__nav-btn--active' : ''}`} onClick={() => setActiveNav('obligations')} title="Obligations">
            <ObligationsIcon />
            <span className="agrd__nav-label">Obligations</span>
          </button>
          {canWrite && (
            <button className={`agrd__nav-btn ${activeNav === 'renewal' ? 'agrd__nav-btn--active' : ''}`} onClick={() => setActiveNav('renewal')} title="Renewal">
              <RenewalIcon />
              <span className="agrd__nav-label">Renewal</span>
            </button>
          )}
        </aside>

        <div className="agrd__content">
          <div className="agrd__content-card">

            {activeNav === 'details' && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Agreement details</h3>
                  {canWrite && !editing && (
                    <button className="agrd__edit-btn" onClick={handleStartEdit}>
                      <EditIcon /> Edit
                    </button>
                  )}
                </div>

                {!editing ? (
                  <div className="agrd__view-grid">
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Title</span>
                      <span className="agrd__view-value">{agreement.title || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Account 1</span>
                      <span className="agrd__view-value">{agreement.accountName || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Account 2</span>
                      <span className="agrd__view-value">{agreement.account2Name || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Agreement type</span>
                      <span className="agrd__view-value">{agreement.agreementType || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Agreement subtype</span>
                      <span className="agrd__view-value">{agreement.agreementSubtype || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Language</span>
                      <span className="agrd__view-value">{agreement.language || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Status</span>
                      <span className="agrd__view-value">{agreement.status || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Start date</span>
                      <span className="agrd__view-value">{agreement.effectiveDate || '-'}</span>
                    </div>
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">End date</span>
                      <span className="agrd__view-value">{agreement.endDate || '-'}</span>
                    </div>
                    {customFieldDefs.filter((f) => f.type !== 'lookup').map((field) => (
                      <div key={field.id} className="agrd__view-field">
                        <span className="agrd__view-label">{field.label}</span>
                        <span className="agrd__view-value">{(agreement.customFields || {})[field.id] || '-'}</span>
                      </div>
                    ))}
                    <div className="agrd__view-field">
                      <span className="agrd__view-label">Created by</span>
                      <span className="agrd__view-value">{agreement.createdBy || '-'}</span>
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
                        <label className="agrd__label" htmlFor="accountId">Account 1</label>
                        <select id="accountId" name="accountId" className="agrd__input" value={form.accountId} onChange={handleFormChange}>
                          <option value="">- Select account -</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="account2Id">Account 2</label>
                        <select id="account2Id" name="account2Id" className="agrd__input" value={form.account2Id} onChange={handleFormChange}>
                          <option value="">- Select account -</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>

                      <div className="agrd__field">
                        <label className="agrd__label" htmlFor="agreementType">Agreement type</label>
                        {typeOptions.length > 0 ? (
                          <select id="agreementType" name="agreementType" className="agrd__input" value={form.agreementType} onChange={handleFormChange}>
                            <option value="">- Select type -</option>
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
                            <option value="">- Select subtype -</option>
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

            {activeNav === 'obligations' && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Obligations</h3>
                  {canWrite && featureOn(aiFeatures, 'obligations') && (
                    <button type="button" className="agrd__btn-primary" onClick={handleFindObligations} disabled={findingObligations}>
                      {findingObligations ? 'Reading…' : 'Find obligations with AI'}
                    </button>
                  )}
                </div>
                <p className="agrd__renewal-hint">
                  Who must do what, and by when, under this agreement. The AI only proposes: nothing is saved until
                  you tick the ones that are right and save them. It can miss or misread an obligation, so check each
                  one against the quoted clause.
                </p>

                {obligationsError && <p className="agrd__error">{obligationsError}</p>}
                {findingObligations && <p className="agrd__renewal-hint">Reading the agreement. This can take up to a minute.</p>}

                {obligationProposals && !findingObligations && (
                  <div className="agrd__ob-proposals">
                    <h4 className="agrd__renewal-title">Proposed by AI</h4>
                    {obligationSummary && <p className="agrd__renewal-text">{obligationSummary}</p>}
                    {obligationProposals.length === 0 ? (
                      <p className="agrd__renewal-hint">No new obligations were found.</p>
                    ) : (
                      <>
                        {obligationProposals.map((p, i) => (
                          <label key={i} className="agrd__ob-card">
                            <input
                              type="checkbox"
                              checked={p.selected}
                              onChange={(e) => updateObligationProposal(i, { selected: e.target.checked })}
                            />
                            <div className="agrd__ob-body">
                              <p className="agrd__ob-desc">{p.description}</p>
                              <p className="agrd__ob-meta">
                                {p.responsibleParty ? `${p.responsibleParty}` : 'No party stated'}
                                {p.recurrence ? ` · ${p.recurrence}` : ''}
                                {p.trigger ? ` · ${p.trigger}` : ''}
                                {p.clause ? ` · ${p.clause}` : ''}
                                {` · ${p.confidence} confidence`}
                              </p>
                              {p.quote && <p className="agrd__ob-quote">&ldquo;{p.quote}&rdquo;</p>}
                              <div className="agrd__ob-due" onClick={(e) => e.stopPropagation()}>
                                <span>Due date</span>
                                <input
                                  type="date"
                                  value={p.dueDate || ''}
                                  onChange={(e) => updateObligationProposal(i, { dueDate: e.target.value || null })}
                                />
                              </div>
                            </div>
                          </label>
                        ))}
                        <div className="agrd__ob-actions">
                          <button
                            type="button"
                            className="agrd__btn-primary"
                            onClick={handleSaveObligationProposals}
                            disabled={savingObligations || !obligationProposals.some((p) => p.selected)}
                          >
                            {savingObligations ? 'Saving…' : `Save ${obligationProposals.filter((p) => p.selected).length} selected`}
                          </button>
                          <button type="button" className="agrd__btn-secondary" onClick={() => setObligationProposals(null)}>
                            Discard
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <h4 className="agrd__renewal-title agrd__ob-saved-title">In the register</h4>
                {obligationsLoading ? (
                  <p className="agrd__renewal-hint">Loading…</p>
                ) : obligations.length === 0 ? (
                  <p className="agrd__renewal-hint">No obligations saved for this agreement yet.</p>
                ) : (
                  <ul className="agrd__ob-list">
                    {obligations.map((ob) => (
                      <li key={ob.id} className={`agrd__ob-row ${ob.status === 'done' ? 'agrd__ob-row--done' : ''}`}>
                        {canWrite ? (
                          <input type="checkbox" checked={ob.status === 'done'} onChange={() => handleToggleObligation(ob)} title="Mark as done" />
                        ) : (
                          <span className="agrd__ob-status">{ob.status === 'done' ? 'Done' : 'Open'}</span>
                        )}
                        <div className="agrd__ob-body">
                          <p className="agrd__ob-desc">{ob.description}</p>
                          <p className="agrd__ob-meta">
                            {ob.responsibleParty || 'No party stated'}
                            {ob.dueDate ? ` · due ${ob.dueDate}` : ''}
                            {ob.recurrence ? ` · ${ob.recurrence}` : ''}
                            {ob.trigger ? ` · ${ob.trigger}` : ''}
                            {ob.clause ? ` · ${ob.clause}` : ''}
                          </p>
                          {ob.sourceQuote && <p className="agrd__ob-quote">&ldquo;{ob.sourceQuote}&rdquo;</p>}
                        </div>
                        {canWrite && (
                          <button type="button" className="agrd__ob-delete" onClick={() => handleDeleteObligation(ob)} title="Delete obligation">
                            Delete
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {activeNav === 'renewal' && canWrite && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Renewal</h3>
                  {featureOn(aiFeatures, 'renewals') && (
                    <button type="button" className="agrd__btn-primary" onClick={handlePrepareRenewalBrief} disabled={renewalLoading}>
                      {renewalLoading ? 'Preparing…' : renewalBrief ? 'Prepare brief again' : 'Prepare renewal brief'}
                    </button>
                  )}
                </div>

                <div className="agrd__notice">
                  <h4 className="agrd__renewal-title">Notice and renewal</h4>
                  <div className="agrd__notice-row">
                    <label className="agrd__notice-field">
                      Notice period (days)
                      <input
                        type="number"
                        min="0"
                        className="agrd__notice-input"
                        value={noticeDaysInput}
                        onChange={(e) => setNoticeDaysInput(e.target.value)}
                        placeholder="e.g. 30"
                      />
                    </label>
                    <label className="agrd__notice-field">
                      Renews automatically
                      <select className="agrd__notice-input" value={autoRenewalInput} onChange={(e) => setAutoRenewalInput(e.target.value)}>
                        <option value="">Not stated</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                    <div className="agrd__notice-field">
                      Notice deadline
                      <strong className="agrd__notice-deadline">
                        {agreement.noticeDeadline || (agreement.endDate ? 'Set a notice period' : 'Set an end date first')}
                      </strong>
                    </div>
                    <button type="button" className="agrd__btn-secondary" onClick={handleSaveNotice} disabled={savingNotice}>
                      {savingNotice ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {noticeMessage && <p className="agrd__renewal-source">{noticeMessage}</p>}
                  <p className="agrd__renewal-source">
                    The notice deadline is the end date minus the notice period. Reminders are emailed before it, on the
                    same schedule as expiry reminders.
                  </p>
                </div>

                {agreementTasks.length > 0 && (
                  <div className="agrd__renewal-section">
                    <h4 className="agrd__renewal-title">Open tasks</h4>
                    <ul className="agrd__renewal-list">
                      {agreementTasks.map((t) => (
                        <li key={t.id}>{t.dueDate ? <strong>{t.dueDate}: </strong> : null}{t.title}{t.assigneeEmail ? ` (${t.assigneeEmail})` : ''}</li>
                      ))}
                    </ul>
                    <p className="agrd__renewal-source">Manage them in Tasks.</p>
                  </div>
                )}
                <p className="agrd__renewal-hint">
                  An AI agent reads this agreement and prepares what you need before it ends: the term, notice
                  deadlines, whether it renews on its own, and a recommendation. It only reads - it never changes,
                  sends or signs anything. It is not legal advice, so check the points before relying on them.
                </p>

                {renewalError && <p className="agrd__error">{renewalError}</p>}
                {renewalLoading && <p className="agrd__renewal-hint">Reading the agreement and preparing the brief. This can take up to a minute.</p>}

                {renewalBrief && !renewalLoading && (
                  <div className="agrd__renewal">
                    {renewalBrief.headline && <p className="agrd__renewal-headline">{renewalBrief.headline}</p>}
                    {renewalBrief.summary && <p className="agrd__renewal-text">{renewalBrief.summary}</p>}

                    <div className="agrd__renewal-reco">
                      <span className={`agrd__renewal-action agrd__renewal-action--${renewalBrief.recommendation.action}`}>
                        {RENEWAL_ACTION_LABELS[renewalBrief.recommendation.action] || 'Not enough information'}
                      </span>
                      <p className="agrd__renewal-text">{renewalBrief.recommendation.reasoning}</p>
                    </div>

                    <div className="agrd__renewal-section">
                      <h4 className="agrd__renewal-title">Term and notice</h4>
                      <dl className="agrd__renewal-term">
                        <div><dt>Ends</dt><dd>{renewalBrief.term.endDate || '-'}{renewalBrief.term.daysUntilEnd !== null ? ` (${renewalBrief.term.daysUntilEnd >= 0 ? `in ${renewalBrief.term.daysUntilEnd} days` : `${Math.abs(renewalBrief.term.daysUntilEnd)} days ago`})` : ''}</dd></div>
                        <div><dt>Renews automatically</dt><dd>{renewalBrief.term.autoRenewal === null ? 'Not stated' : renewalBrief.term.autoRenewal ? 'Yes' : 'No'}</dd></div>
                        <div><dt>Notice period</dt><dd>{renewalBrief.term.noticePeriod || 'Not stated'}</dd></div>
                        <div><dt>Notice deadline</dt><dd>{renewalBrief.term.noticeDeadline || 'Not stated'}</dd></div>
                      </dl>
                      {renewalBrief.term.source && <p className="agrd__renewal-source">Source: {renewalBrief.term.source}</p>}
                      {(renewalBrief.term.noticePeriodDays !== null || renewalBrief.term.autoRenewal !== null) && (
                        <button type="button" className="agrd__btn-secondary agrd__brief-apply" onClick={handleUseBriefTerm} disabled={savingNotice}>
                          Save notice period{renewalBrief.term.noticePeriodDays !== null ? ` (${renewalBrief.term.noticePeriodDays} days)` : ''} and auto-renewal to the agreement
                        </button>
                      )}
                    </div>

                    {renewalBrief.keyTerms.length > 0 && (
                      <div className="agrd__renewal-section">
                        <h4 className="agrd__renewal-title">Key terms</h4>
                        <ul className="agrd__renewal-list">
                          {renewalBrief.keyTerms.map((t, i) => <li key={i}>{t.point}</li>)}
                        </ul>
                      </div>
                    )}

                    {renewalBrief.changesToSeek.length > 0 && (
                      <div className="agrd__renewal-section">
                        <h4 className="agrd__renewal-title">Changes to seek</h4>
                        <ul className="agrd__renewal-list">
                          {renewalBrief.changesToSeek.map((c, i) => (
                            <li key={i}><strong>{c.change}</strong>{c.why ? `: ${c.why}` : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {renewalBrief.risks.length > 0 && (
                      <div className="agrd__renewal-section">
                        <h4 className="agrd__renewal-title">Risks</h4>
                        <ul className="agrd__renewal-list">
                          {renewalBrief.risks.map((r, i) => (
                            <li key={i}>
                              <span className={`agrd__renewal-sev agrd__renewal-sev--${r.severity || 'medium'}`}>{r.severity || 'medium'}</span>{' '}
                              <strong>{r.issue}</strong>{r.detail ? `: ${r.detail}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {renewalBrief.nextSteps.length > 0 && (
                      <div className="agrd__renewal-section">
                        <h4 className="agrd__renewal-title">Next steps</h4>
                        <ul className="agrd__renewal-list agrd__renewal-steps">
                          {renewalBrief.nextSteps.map((s, i) => (
                            <li key={i}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={!!selectedSteps[i]}
                                  onChange={(e) => setSelectedSteps((prev) => { const next = [...prev]; next[i] = e.target.checked; return next; })}
                                />{' '}
                                {s.by ? <strong>{s.by}: </strong> : null}{s.step}
                              </label>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="agrd__btn-secondary agrd__brief-apply"
                          onClick={handleCreateTasksFromBrief}
                          disabled={creatingTasks || !selectedSteps.some(Boolean)}
                        >
                          {creatingTasks ? 'Creating…' : 'Create tasks from the selected steps'}
                        </button>
                      </div>
                    )}

                    <p className="agrd__renewal-source">
                      Generated by AI on {new Date(renewalBrief.generatedAt).toLocaleString()}. Review before relying on it.
                    </p>
                  </div>
                )}
              </>
            )}

            {activeNav === 'attachments' && (
              <>
                <div className="agrd__content-header">
                  <h3 className="agrd__content-title">Attachments</h3>
                </div>

                {reviewRequests.length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">Sent for review</h4>
                    {reviewRequests.map((rr) => {
                      const batchMates = rr.batchId ? reviewRequests.filter((r) => r.batchId === rr.batchId) : [rr];
                      const isChain = batchMates.length > 1;
                      const isWaitingTurn =
                        rr.status === 'Pending' &&
                        isChain &&
                        batchMates.some((r) => r.sequence < rr.sequence && r.status === 'Pending');

                      return (
                      <div key={rr.id} className="agrd__review-session-row">
                        <div className="agrd__review-session-info">
                          <span className="agrd__review-session-name">
                            {isChain && `#${rr.sequence} · `}
                            {rr.reviewerName ? `${rr.reviewerName} · ` : ''}{rr.reviewerEmail}
                          </span>
                          <span className="agrd__review-session-meta">
                            {rr.attachmentName} · {new Date(rr.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="agrd__review-session-actions">
                          <span
                            className={`agrd__review-session-status agrd__review-session-status--${
                              rr.status === 'Accepted' ? 'done' : rr.status === 'Rejected' ? 'danger' : rr.status === 'Submitted' ? 'pending' : 'pending'
                            }`}
                          >
                            {isWaitingTurn ? 'Waiting its turn' : rr.status}
                          </span>
                          {rr.status === 'Pending' && !isWaitingTurn && (
                            <button
                              type="button"
                              className="agrd__attachment-btn"
                              onClick={() => handleCopyReviewLink(rr)}
                            >
                              {copiedReviewId === rr.id ? 'Copied!' : 'Copy link'}
                            </button>
                          )}
                          {rr.status === 'Submitted' && (
                            <>
                              <button
                                type="button"
                                className="agrd__attachment-btn"
                                onClick={() => handlePreviewSubmittedChanges(rr)}
                              >
                                Preview final
                              </button>
                              <button
                                type="button"
                                className="agrd__attachment-btn"
                                onClick={() => openChangesModal(rr)}
                              >
                                Review changes
                              </button>
                              <button
                                type="button"
                                className="agrd__attachment-btn agrd__attachment-btn--danger"
                                onClick={() => handleRejectReviewChanges(rr)}
                                disabled={processingReviewId === rr.id}
                              >
                                Reject all
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
                {approvalRequests.length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">Sent for approval</h4>
                    {approvalRequests.map((request) => {
                      const batchMates = request.batchId
                        ? approvalRequests.filter((r) => r.batchId === request.batchId)
                        : [request];
                      const isChain = batchMates.length > 1;
                      const isWaitingTurn =
                        request.status === 'Pending' &&
                        isChain &&
                        batchMates.some((r) => r.sequence < request.sequence && r.status !== 'Approved');

                      return (
                        <div key={request.id} className="agrd__review-session-row">
                          <div className="agrd__review-session-info">
                            <span className="agrd__review-session-name">
                              {isChain && `#${request.sequence} · `}
                              {request.approverName ? `${request.approverName} · ` : ''}{request.approverEmail}
                            </span>
                            <span className="agrd__review-session-meta">
                              {request.attachmentName || 'No document attached'} ·{' '}
                              {request.createdAt?.seconds
                                ? new Date(request.createdAt.seconds * 1000).toLocaleDateString()
                                : 'just now'}
                            </span>
                            {request.status !== 'Pending' && request.comment && (
                              <span className="agrd__review-session-meta">"{request.comment}"</span>
                            )}
                          </div>
                          <div className="agrd__review-session-actions">
                            <span
                              className={`agrd__review-session-status agrd__review-session-status--${
                                request.status === 'Approved' ? 'done' : request.status === 'Rejected' ? 'danger' : 'pending'
                              }`}
                            >
                              {isWaitingTurn ? 'Waiting its turn' : request.status}
                            </span>
                            {request.status === 'Pending' && !isWaitingTurn && (
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
                      );
                    })}
                  </div>
                )}
                {(agreement.docusignEnvelopes || []).length > 0 && (
                  <div className="agrd__review-sessions">
                    <h4 className="agrd__review-sessions-title">Sent for signature</h4>
                    {agreement.docusignEnvelopes.map((env) => (
                      <div key={env.envelopeId} className="agrd__review-session-row">
                        <div className="agrd__review-session-info">
                          <span className="agrd__review-session-name">
                            {env.manual
                              ? `Marked as signed manually${env.markedBy ? ` by ${env.markedBy}` : ''}`
                              : (env.signers || []).map((s) => `${s.name} (${s.email})`).join('  →  ')}
                          </span>
                          <span className="agrd__review-session-meta">
                            {env.attachmentName} ·{' '}
                            {(env.sentAt || env.completedAt) ? new Date(env.sentAt || env.completedAt).toLocaleDateString() : ''}
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
                            <span className="agrd__attachment-name">
                              {att.name}
                              {att.version && <span className="agrd__version-badge">v{att.version}</span>}
                              {agreement.sfFiles?.[att.id] && <span className="agrd__version-badge">In Salesforce</span>}
                            </span>
                            <span className="agrd__attachment-size">{formatFileSize(att.size)}</span>
                          </div>
                        </div>
                        <div className="agrd__attachment-actions">
                          <button
                            type="button"
                            className="agrd__attachment-btn"
                            onClick={() => handlePreviewAttachment(att)}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            className="agrd__attachment-btn"
                            onClick={() => handleDownloadAttachment(att)}
                          >
                            Download
                          </button>
                          {isAdmin && agreement.accountId && (
                            <button
                              type="button"
                              className="agrd__attachment-btn"
                              onClick={() => handleSendToSalesforce(att)}
                              disabled={!!sfPushingId}
                            >
                              {sfPushingId === att.id
                                ? 'Sending…'
                                : agreement.sfFiles?.[att.id]
                                  ? 'Update in Salesforce'
                                  : 'Send to Salesforce'}
                            </button>
                          )}
                          {canWrite && (
                          <button
                            type="button"
                            className="agrd__attachment-btn agrd__attachment-btn--danger"
                            onClick={() => handleDeleteAttachment(att)}
                          >
                            Remove
                          </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {canWrite ? (
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
                  {showAll && mergeableAttachments.length >= 2 && (
                    <button className="agrd__btn-secondary-sm" onClick={openCompareModal}>Compare versions</button>
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
            {isAdmin && agreement.accountId && (
              <button className="agrd__btn-secondary-sm" onClick={handleSyncAgreementToSalesforce} disabled={sfSyncing}>
                {sfSyncing
                  ? 'Syncing…'
                  : agreement.sfContractId
                    ? 'Update contract in Salesforce'
                    : 'Create contract in Salesforce'}
              </button>
            )}
            <div className="agrd__actions-divider" />
            <button className="agrd__btn-danger-sm" onClick={handleDelete}>Delete agreement</button>
          </div>
        </aside>
        ) : (
        <aside className="agrd__actions">
          <div className="agrd__actions-card">
            <h4 className="agrd__actions-title">Actions</h4>
            <p className="agrd__modal-hint">Your profile is read-only. Ask an admin if you need to edit this agreement.</p>
          </div>
        </aside>
        )}
      </div>

      {showGenerateModal && (
        <div className="agrd__modal-backdrop" onClick={closeGenerateModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Generate agreement</h3>
              <p className="agrd__modal-subtitle">
                Showing templates for <strong>{agreement.agreementType || '-'}</strong> / <strong>{agreement.agreementSubtype || '-'}</strong>
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
                  Only Word (.docx) files can be merged - {nonMergeableAttachments.length} other file
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

      {showCompareModal && (
        <div className="agrd__modal-backdrop" onClick={closeCompareModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Compare versions</h3>
              <p className="agrd__modal-subtitle">
                Side-by-side redline between any two Word (.docx) versions on this agreement - insertions underlined, deletions struck through.
              </p>

              {compareError && <p className="agrd__error">{compareError}</p>}

              {mergeableAttachments.length < 2 ? (
                <p className="agrd__modal-hint">Need at least two Word (.docx) attachments to compare.</p>
              ) : (
                <div className="agrd__compare-pickers">
                  <div className="agrd__compare-picker">
                    <span className="agrd__doc-select-label">From</span>
                    <select className="agrd__input" value={compareFromId} onChange={(e) => setCompareFromId(e.target.value)}>
                      <option value="">- Select -</option>
                      {mergeableAttachments.map((att) => (
                        <option key={att.id} value={att.id}>{att.name}{att.version ? ` (v${att.version})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <span className="agrd__compare-arrow">→</span>
                  <div className="agrd__compare-picker">
                    <span className="agrd__doc-select-label">To</span>
                    <select className="agrd__input" value={compareToId} onChange={(e) => setCompareToId(e.target.value)}>
                      <option value="">- Select -</option>
                      {mergeableAttachments.map((att) => (
                        <option key={att.id} value={att.id}>{att.name}{att.version ? ` (v${att.version})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="agrd__btn-primary"
                    onClick={handleRunCompare}
                    disabled={!compareFromId || !compareToId || compareFromId === compareToId || comparing}
                  >
                    {comparing ? 'Comparing…' : 'Compare'}
                  </button>
                </div>
              )}

              {compareTokens && (
                listChangeIds(compareTokens).length === 0 ? (
                  <p className="agrd__modal-hint agrd__modal-hint--top">These two versions are identical - no differences found.</p>
                ) : (
                  <div
                    className="arv__redline-preview agrd__compare-preview"
                    dangerouslySetInnerHTML={{ __html: renderChangeTokensToHtml(compareTokens) }}
                  />
                )
              )}
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeCompareModal} disabled={comparing}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRelationModal && (
        <div className="agrd__modal-backdrop" onClick={closeRelationModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Link to another agreement</h3>
              <p className="agrd__modal-subtitle">
                Mark this agreement as a renewal or amendment of another one - the link shows on both records.
              </p>

              {relationError && <p className="agrd__error">{relationError}</p>}

              <div className="agrd__field">
                <label className="agrd__label">Relation</label>
                <select className="agrd__input" value={relationDraftType} onChange={(e) => setRelationDraftType(e.target.value)}>
                  <option value="renewal">Renewal of</option>
                  <option value="amendment">Amendment of</option>
                </select>
              </div>

              <div className="agrd__field">
                <label className="agrd__label">Agreement</label>
                {loadingRelationPicker ? (
                  <p className="agrd__modal-hint">Loading…</p>
                ) : (
                  <select className="agrd__input" value={relationDraftTargetId} onChange={(e) => setRelationDraftTargetId(e.target.value)}>
                    <option value="">- Select an agreement -</option>
                    {relationPickerAgreements.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}{a.accountName ? ` (${a.accountName})` : ''}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="agrd__modal-actions">
              {agreement.relatedAgreementId && (
                <button type="button" className="agrd__btn-secondary" onClick={handleRemoveRelation} disabled={savingRelation}>
                  Remove link
                </button>
              )}
              <button type="button" className="agrd__btn-secondary" onClick={closeRelationModal} disabled={savingRelation}>
                Cancel
              </button>
              <button type="button" className="agrd__btn-primary" onClick={handleSaveRelation} disabled={!relationDraftTargetId || savingRelation}>
                {savingRelation ? 'Saving…' : 'Save link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotifyModal && (
        <div className="agrd__modal-backdrop" onClick={closeNotifyModal}>
          <div className="agrd__modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Expiry reminders</h3>
              <p className="agrd__modal-subtitle">
                When to email {agreement.createdBy || 'the creator'} before this agreement's end date.
              </p>

              {notifyError && <p className="agrd__error">{notifyError}</p>}

              {loadingNotify ? (
                <p className="agrd__modal-hint">Loading…</p>
              ) : (
                <>
                  <label className="agrd__template-option">
                    <input type="radio" name="notifyMode" checked={notifyMode === 'default'} onChange={() => setNotifyMode('default')} />
                    <div className="agrd__template-option-info">
                      <span className="agrd__template-option-name">Use organization default</span>
                      <span className="agrd__template-option-lang">
                        {tenantDefaultDays.length > 0 ? tenantDefaultDays.map((d) => `${d}d`).join(', ') : 'No reminders configured'}
                      </span>
                    </div>
                  </label>
                  <label className="agrd__template-option">
                    <input type="radio" name="notifyMode" checked={notifyMode === 'custom'} onChange={() => setNotifyMode('custom')} />
                    <div className="agrd__template-option-info">
                      <span className="agrd__template-option-name">Custom for this agreement only</span>
                    </div>
                  </label>

                  {notifyMode === 'custom' && (
                    <>
                      <div className="settings__reminder-days agrd__notify-days">
                        {notifyDays.length === 0 ? (
                          <span className="agrd__modal-hint">No reminders - this agreement won't get expiry emails.</span>
                        ) : (
                          notifyDays.map((d) => (
                            <span key={d} className="settings__reminder-chip">
                              {d} day{d === 1 ? '' : 's'} before
                              <button
                                type="button"
                                className="settings__reminder-chip-remove"
                                onClick={() => handleRemoveNotifyDay(d)}
                                aria-label={`Remove ${d}-day reminder`}
                              >
                                ✕
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="settings__reminder-add-row">
                        <input
                          type="number"
                          min="1"
                          className="settings__playbook-input settings__reminder-add-input"
                          placeholder="e.g. 60"
                          value={newNotifyDay}
                          onChange={(e) => setNewNotifyDay(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNotifyDay(); } }}
                        />
                        <button type="button" className="agrd__btn-secondary" onClick={handleAddNotifyDay}>
                          + Add threshold
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeNotifyModal} disabled={savingNotify}>
                Cancel
              </button>
              <button type="button" className="agrd__btn-primary" onClick={handleSaveNotify} disabled={savingNotify || loadingNotify}>
                {savingNotify ? 'Saving…' : 'Save'}
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
              {mergeableAttachments.length === 0 ? (
                <p className="agrd__modal-hint">
                  No documents available to send. Only Word (.docx)-based attachments can be sent for review.
                </p>
              ) : (
                <div className="agrd__merge-list">
                  {mergeableAttachments.map((att) => (
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
                        <span className="agrd__template-option-name">{att.name}{att.version && <span className="agrd__version-badge">v{att.version}</span>}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {reviewersList.map((reviewer, index) => (
                <div
                  key={index}
                  className={`agrd__recipient-row ${dragIndex === index ? 'agrd__recipient-row--dragging' : ''}`}
                  onDragOver={handleDragOverRow}
                  onDrop={handleDropReorder(setReviewersList, index)}
                >
                  <h4 className="agrd__review-section-title">
                    Reviewer {reviewersList.length > 1 ? index + 1 : ''}
                    {reviewersList.length > 1 && index > 0 && (
                      <span className="agrd__modal-hint"> (reviews after Reviewer {index})</span>
                    )}
                  </h4>
                  <div className="agrd__recipient-fields">
                    {reviewersList.length > 1 && (
                      <span
                        className="agrd__drag-handle"
                        draggable
                        onDragStart={handleDragStart(index)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Drag to reorder reviewer ${index + 1}`}
                        title="Drag to reorder"
                      >
                        ⠿
                      </span>
                    )}
                    <input
                      type="text"
                      className="agrd__input"
                      placeholder="Name (optional)"
                      value={reviewer.name}
                      onChange={(e) => updateReviewerAt(index, 'name', e.target.value)}
                    />
                    <input
                      type="email"
                      className="agrd__input"
                      placeholder="reviewer@company.com"
                      value={reviewer.email}
                      onChange={(e) => updateReviewerAt(index, 'email', e.target.value)}
                    />
                    {reviewersList.length > 1 && (
                      <button
                        type="button"
                        className="agrd__recipient-remove"
                        onClick={() => removeReviewerAt(index)}
                        aria-label={`Remove reviewer ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {reviewersList.length < 10 && (
                <button type="button" className="agrd__attachment-btn agrd__attachment-btn--block" onClick={addReviewerRow}>
                  + Add another reviewer
                </button>
              )}
              {reviewersList.length > 1 && (
                <p className="agrd__modal-hint agrd__modal-hint--top">
                  Sequential - each reviewer is only notified after the previous one submits their changes.
                </p>
              )}

              <h4 className="agrd__review-section-title">
                CC <span className="agrd__modal-hint">(optional)</span>
              </h4>
              <input
                type="text"
                className="agrd__input"
                placeholder="cc@company.com, another-cc@company.com"
                value={reviewCc}
                onChange={(e) => setReviewCc(e.target.value)}
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
                it - no EsoVia account needed.
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
                      <FileIcon />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{att.name}{att.version && <span className="agrd__version-badge">v{att.version}</span>}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {approversList.map((approver, index) => (
                <div
                  key={index}
                  className={`agrd__recipient-row ${dragIndex === index ? 'agrd__recipient-row--dragging' : ''}`}
                  onDragOver={handleDragOverRow}
                  onDrop={handleDropReorder(setApproversList, index)}
                >
                  <h4 className="agrd__review-section-title">
                    Approver {approversList.length > 1 ? index + 1 : ''}
                    {approversList.length > 1 && index > 0 && (
                      <span className="agrd__modal-hint"> (approves after Approver {index})</span>
                    )}
                  </h4>
                  <div className="agrd__recipient-fields">
                    {approversList.length > 1 && (
                      <span
                        className="agrd__drag-handle"
                        draggable
                        onDragStart={handleDragStart(index)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Drag to reorder approver ${index + 1}`}
                        title="Drag to reorder"
                      >
                        ⠿
                      </span>
                    )}
                    <input
                      type="text"
                      className="agrd__input"
                      placeholder="Name (optional)"
                      value={approver.name}
                      onChange={(e) => updateApproverAt(index, 'name', e.target.value)}
                    />
                    <input
                      type="email"
                      className="agrd__input"
                      placeholder="approver@company.com"
                      value={approver.email}
                      onChange={(e) => updateApproverAt(index, 'email', e.target.value)}
                    />
                    {approversList.length > 1 && (
                      <button
                        type="button"
                        className="agrd__recipient-remove"
                        onClick={() => removeApproverAt(index)}
                        aria-label={`Remove approver ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {approversList.length < 10 && (
                <button type="button" className="agrd__attachment-btn agrd__attachment-btn--block" onClick={addApproverRow}>
                  + Add another approver
                </button>
              )}
              {approversList.length > 1 && (
                <p className="agrd__modal-hint agrd__modal-hint--top">
                  Sequential - each approver is only notified after the previous one approves. If anyone rejects, the chain stops.
                </p>
              )}

              <h4 className="agrd__review-section-title">Message</h4>
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
                disabled={!approversList[0]?.email.trim() || sendingApproval}
              >
                {sendingApproval ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewAIModal && reviewModalView === 'list' && (
        <div className="arv__backdrop" onClick={closeReviewAIModal}>
          <div className="arv__modal" onClick={(e) => e.stopPropagation()}>
            <div className="arv__header">
              <h3 className="arv__title"><SparkleIcon /> Review with AI</h3>
              <p className="arv__subtitle">
                A contract-manager-style quality check - not legal advice. Based only on the document text you pick below.
                By using this tool, you're interacting with our AI system.
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
                    {availablePlaybooks.length > 0 && (
                      <div className="arv__playbook-select">
                        <span className="arv__doc-select-label">Playbooks to check against</span>
                        <div className="arv__playbook-options">
                          {availablePlaybooks.map((pb) => (
                            <label key={pb.id} className="arv__playbook-option">
                              <input
                                type="checkbox"
                                checked={selectedPlaybookIds.includes(pb.id)}
                                onChange={() => togglePlaybookSelected(pb.id)}
                              />
                              <span>{pb.title}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="arv__btn-primary arv__run-btn"
                      onClick={handleRunReviewAI}
                      disabled={reviewingAI || !aiReviewAttachmentId || !featureOn(aiFeatures, 'review')}
                      title={featureOn(aiFeatures, 'review') ? undefined : 'AI review is turned off for your organization.'}
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
                          className={`arv__score-badge arv__score-badge--${aiReview.overallScore >= 8 ? 'good' : aiReview.overallScore >= 5 ? 'mid' : 'low'}`}
                        >
                          {aiReview.overallScore}<span className="arv__score-max">/10</span>
                        </div>
                        <div className="arv__score-row-text">
                          <span className={`arv__risk-pill arv__risk-pill--${(aiReview.riskLevel || 'medium').toLowerCase()}`}>
                            {aiReview.riskLevel} risk
                          </span>
                          <p className="arv__summary">{aiReview.summary}</p>
                        </div>
                      </div>

                      {aiReview.categories?.length > 0 && (
                        <div className="arv__categories">
                          {aiReview.categories.map((cat) => (
                            <div key={cat.name} className="arv__category">
                              <div className="arv__category-top">
                                <span className="arv__category-name">{cat.name}</span>
                                <span className="arv__category-score">{cat.score}/10</span>
                              </div>
                              <div className="arv__category-bar-track">
                                <div
                                  className={`arv__category-bar-fill arv__category-bar-fill--${cat.score >= 8 ? 'good' : cat.score >= 5 ? 'mid' : 'low'}`}
                                  style={{ width: `${cat.score * 10}%` }}
                                />
                              </div>
                              {cat.note && <p className="arv__category-note">{cat.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {aiReview.strengths.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title arv__section-title--good">Strengths</h4>
                          <ul className="arv__list">
                            {aiReview.strengths.map((item, i) => <li key={i}>{item}</li>)}
                          </ul>
                        </div>
                      )}

                      {aiReview.risks?.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title arv__section-title--warn">Risks</h4>
                          <p className="arv__suggestion-hint">Risks with a proposed rewrite are clickable - click to see the redline and apply it.</p>
                          <div className="arv__risk-list">
                            {aiReview.risks.map((risk, i) => {
                              const refKey = `risks-${i}`;
                              const hasRedline = !!(risk.originalExcerpt && risk.proposedText);
                              const applied = appliedRedlineRefs.includes(refKey);
                              const Tag = hasRedline ? 'button' : 'div';
                              return (
                                <Tag
                                  key={i}
                                  type={hasRedline ? 'button' : undefined}
                                  className={`arv__risk-item ${hasRedline ? 'arv__risk-item--clickable' : ''} ${applied ? 'arv__risk-item--applied' : ''}`}
                                  onClick={hasRedline ? () => openRedlineDetail('risks', i) : undefined}
                                >
                                  <div className="arv__risk-item-top">
                                    <span className="arv__risk-item-issue">{risk.issue}</span>
                                    <div className="arv__risk-item-badges">
                                      {applied && <span className="arv__applied-pill">✓ Applied</span>}
                                      <span className={`arv__risk-pill arv__risk-pill--${(risk.severity || 'medium').toLowerCase()}`}>
                                        {risk.severity}
                                      </span>
                                    </div>
                                  </div>
                                  {risk.explanation && <p className="arv__risk-item-explanation">{risk.explanation}</p>}
                                </Tag>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {aiReview.playbookViolations?.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title arv__section-title--warn">Playbook violations</h4>
                          <p className="arv__suggestion-hint">Checked against the playbook(s) selected for this review.</p>
                          <div className="arv__risk-list">
                            {aiReview.playbookViolations.map((violation, i) => {
                              const refKey = `playbookViolations-${i}`;
                              const hasRedline = !!(violation.originalExcerpt && violation.proposedText);
                              const applied = appliedRedlineRefs.includes(refKey);
                              const Tag = hasRedline ? 'button' : 'div';
                              return (
                                <Tag
                                  key={i}
                                  type={hasRedline ? 'button' : undefined}
                                  className={`arv__risk-item ${hasRedline ? 'arv__risk-item--clickable' : ''} ${applied ? 'arv__risk-item--applied' : ''}`}
                                  onClick={hasRedline ? () => openRedlineDetail('playbookViolations', i) : undefined}
                                >
                                  <div className="arv__risk-item-top">
                                    <span className="arv__risk-item-issue">{violation.issue}</span>
                                    <div className="arv__risk-item-badges">
                                      {applied && <span className="arv__applied-pill">✓ Applied</span>}
                                      <span className={`arv__risk-pill arv__risk-pill--${(violation.severity || 'medium').toLowerCase()}`}>
                                        {violation.severity}
                                      </span>
                                    </div>
                                  </div>
                                  {violation.rule && <p className="arv__risk-item-rule">Rule: {violation.rule}</p>}
                                  {violation.explanation && <p className="arv__risk-item-explanation">{violation.explanation}</p>}
                                </Tag>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {aiReview.suggestions?.length > 0 && (
                        <div className="arv__section">
                          <h4 className="arv__section-title">Suggestions</h4>
                          <p className="arv__suggestion-hint">Click any suggestion for the full detail and to apply it.</p>
                          <div className="arv__suggestion-list">
                            {aiReview.suggestions.map((s, i) => {
                              const applied = appliedSuggestionIndexes.includes(i);
                              return (
                                <button
                                  type="button"
                                  key={i}
                                  className={`arv__suggestion-item arv__suggestion-item--clickable ${applied ? 'arv__suggestion-item--applied' : ''}`}
                                  onClick={() => openSuggestionDetail(i)}
                                >
                                  <div className="arv__suggestion-item-top">
                                    <p className="arv__suggestion-title">{s.title}</p>
                                    {applied && <span className="arv__applied-pill">✓ Applied</span>}
                                  </div>
                                  {s.detail && <p className="arv__suggestion-detail">{s.detail}</p>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {pendingReviewEditsHtml && (
                        <div className="arv__save-banner">
                          <span>
                            {appliedSuggestionIndexes.length + appliedRedlineRefs.length} change{appliedSuggestionIndexes.length + appliedRedlineRefs.length === 1 ? '' : 's'} applied -
                            saved as one new document version, not one file per change.
                          </span>
                          <button
                            type="button"
                            className="arv__btn-primary"
                            onClick={handleSaveReviewEdits}
                            disabled={savingReviewEdits}
                          >
                            {savingReviewEdits ? 'Saving…' : 'Save as new document version'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="arv__footer">
              <button type="button" className="arv__btn-secondary" onClick={closeReviewAIModal} disabled={reviewingAI || savingReviewEdits}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewAIModal && reviewModalView === 'detail' && activeSuggestionIndex !== null && aiReview && (() => {
        const suggestion = aiReview.suggestions[activeSuggestionIndex];
        const applied = appliedSuggestionIndexes.includes(activeSuggestionIndex);
        const canApply = !!suggestion.suggestedText && aiReviewAttachmentId !== 'ALL';
        return (
          <div className="arv__backdrop" onClick={closeReviewAIModal}>
            <div className="arv__modal" onClick={(e) => e.stopPropagation()}>
              <div className="arv__header">
                <button type="button" className="tpl__back tpl__back--modal" onClick={backToReviewList}>
                  <BackIcon /> Back to review
                </button>
                <h3 className="arv__title">{suggestion.title}</h3>
              </div>

              <div className="arv__body">
                <div className="tpl__detail-sections">
                  <div className="tpl__detail-section">
                    <h4 className="tpl__detail-section-title">What to do</h4>
                    <p className="tpl__detail-text">{suggestion.detail}</p>
                  </div>

                  {suggestion.suggestedText && (
                    <div className="tpl__detail-section tpl__detail-section--improve">
                      <h4 className="tpl__detail-section-title">Suggested text</h4>
                      <p className="tpl__detail-text">{suggestion.suggestedText}</p>
                    </div>
                  )}

                  {!suggestion.suggestedText && (
                    <p className="arv__suggestion-hint">
                      This suggestion is about editing or removing existing wording, so there's no ready-to-insert text - apply it manually in the document.
                    </p>
                  )}

                  {suggestion.suggestedText && aiReviewAttachmentId === 'ALL' && (
                    <p className="arv__error">
                      Applying suggestions needs one specific document selected - go back and pick a single document instead of "All documents combined".
                    </p>
                  )}
                </div>
              </div>

              <div className="arv__footer">
                <button type="button" className="arv__btn-secondary" onClick={backToReviewList}>
                  Back
                </button>
                <button
                  type="button"
                  className="arv__btn-primary"
                  onClick={() => handleApplySuggestion(suggestion, activeSuggestionIndex)}
                  disabled={!canApply || applied}
                >
                  {applied ? '✓ Applied' : 'Apply suggestion'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showReviewAIModal && reviewModalView === 'redline-detail' && activeRedlineRef && aiReview && (() => {
        const item = aiReview[activeRedlineRef.source][activeRedlineRef.index];
        const refKey = `${activeRedlineRef.source}-${activeRedlineRef.index}`;
        const applied = appliedRedlineRefs.includes(refKey);
        const canApply = aiReviewAttachmentId !== 'ALL';
        const changeTokens = computeChangeTokens(`<p>${item.originalExcerpt}</p>`, `<p>${item.proposedText}</p>`);
        return (
          <div className="arv__backdrop" onClick={closeReviewAIModal}>
            <div className="arv__modal" onClick={(e) => e.stopPropagation()}>
              <div className="arv__header">
                <button type="button" className="tpl__back tpl__back--modal" onClick={backToReviewList}>
                  <BackIcon /> Back to review
                </button>
                <h3 className="arv__title">{item.issue}</h3>
              </div>

              <div className="arv__body">
                <div className="tpl__detail-sections">
                  {activeRedlineRef.source === 'playbookViolations' && item.rule && (
                    <div className="tpl__detail-section">
                      <h4 className="tpl__detail-section-title">Playbook rule</h4>
                      <p className="tpl__detail-text">{item.rule}</p>
                    </div>
                  )}

                  <div className="tpl__detail-section">
                    <h4 className="tpl__detail-section-title">Why this matters</h4>
                    <p className="tpl__detail-text">{item.explanation}</p>
                  </div>

                  <div className="tpl__detail-section tpl__detail-section--improve">
                    <h4 className="tpl__detail-section-title">Proposed redline</h4>
                    <div
                      className="arv__redline-preview"
                      dangerouslySetInnerHTML={{ __html: renderChangeTokensToHtml(changeTokens) }}
                    />
                  </div>

                  {!canApply && (
                    <p className="arv__error">
                      Applying redlines needs one specific document selected - go back and pick a single document instead of "All documents combined".
                    </p>
                  )}
                </div>
              </div>

              <div className="arv__footer">
                <button type="button" className="arv__btn-secondary" onClick={backToReviewList}>
                  Back
                </button>
                <button
                  type="button"
                  className="arv__btn-primary"
                  onClick={() => handleApplyRedline(item, refKey)}
                  disabled={!canApply || applied}
                >
                  {applied ? '✓ Applied' : 'Apply redline'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showSignatureModal && (
        <div className="agrd__modal-backdrop" onClick={closeSignatureModal}>
          <div className="agrd__modal agrd__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__modal-scroll">
              <h3 className="agrd__modal-title">Send for signature</h3>
              <p className="agrd__modal-subtitle">
                Sends the document to DocuSign for e-signature. Sandbox mode - signatures aren't legally binding yet.
                {signersList.length > 1 && ` Make sure the document also has the matching /sig{n}/, /name{n}/, /title{n}/, /date{n}/ tags for each of the ${signersList.length} signers.`}
              </p>

              {signatureError && <p className="agrd__error">{signatureError}</p>}

              <h4 className="agrd__review-section-title">Documents</h4>
              <p className="agrd__modal-hint">
                Select one or more - everything checked gets sent together in a single signing envelope.
              </p>
              {(agreement.attachments || []).length === 0 ? (
                <p className="agrd__modal-hint">No attachments on this agreement yet.</p>
              ) : (
                <div className="agrd__merge-list">
                  {agreement.attachments.map((att) => (
                    <label
                      key={att.id}
                      className={`agrd__template-option ${signatureAttachmentIds.includes(att.id) ? 'agrd__template-option--selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={signatureAttachmentIds.includes(att.id)}
                        onChange={() => toggleSignatureAttachment(att.id)}
                      />
                      <div className="agrd__template-option-info">
                        <span className="agrd__template-option-name">{att.name}{att.version && <span className="agrd__version-badge">v{att.version}</span>}</span>
                        <span className="agrd__template-option-lang">{formatFileSize(att.size)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="agrd__attachment-btn agrd__attachment-btn--block"
                onClick={handleMarkSignedManually}
                disabled={signatureAttachmentIds.length !== 1 || sendingSignature || markingManualSignature}
              >
                {markingManualSignature ? 'Marking as signed…' : 'Signed on paper? Mark as signed manually (select exactly one document)'}
              </button>

              {signersList.map((signer, index) => (
                <div
                  key={index}
                  className={`agrd__recipient-row ${dragIndex === index ? 'agrd__recipient-row--dragging' : ''}`}
                  onDragOver={handleDragOverRow}
                  onDrop={handleDropReorder(setSignersList, index)}
                >
                  <h4 className="agrd__review-section-title">
                    Signer {signersList.length > 1 ? index + 1 : ''}
                    {signersList.length > 1 && index > 0 && (
                      <span className="agrd__modal-hint"> (signs after Signer {index})</span>
                    )}
                  </h4>
                  <div className="agrd__recipient-fields">
                    {signersList.length > 1 && (
                      <span
                        className="agrd__drag-handle"
                        draggable
                        onDragStart={handleDragStart(index)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Drag to reorder signer ${index + 1}`}
                        title="Drag to reorder"
                      >
                        ⠿
                      </span>
                    )}
                    <input
                      type="text"
                      className="agrd__input"
                      placeholder="Signer name"
                      value={signer.name}
                      onChange={(e) => updateSignerAt(index, 'name', e.target.value)}
                    />
                    <input
                      type="email"
                      className="agrd__input"
                      placeholder="signer@company.com"
                      value={signer.email}
                      onChange={(e) => updateSignerAt(index, 'email', e.target.value)}
                    />
                    {signersList.length > 1 && (
                      <button
                        type="button"
                        className="agrd__recipient-remove"
                        onClick={() => removeSignerAt(index)}
                        aria-label={`Remove signer ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {signersList.length < 10 && (
                <button type="button" className="agrd__attachment-btn agrd__attachment-btn--block" onClick={addSignerRow}>
                  + Add a signer
                </button>
              )}
              {signersList.length > 1 && (
                <p className="agrd__modal-hint agrd__modal-hint--top">
                  Sequential - each signer is only notified after the previous one signs. Drag ⠿ to reorder.
                </p>
              )}

              <h4 className="agrd__review-section-title">
                Recipients in copy <span className="agrd__modal-hint">(optional, don't sign)</span>
              </h4>
              {ccList.map((recipient, index) => (
                <div key={index} className="agrd__recipient-row">
                  <div className="agrd__recipient-fields">
                    <input
                      type="text"
                      className="agrd__input"
                      placeholder="Name"
                      value={recipient.name}
                      onChange={(e) => updateCcAt(index, 'name', e.target.value)}
                    />
                    <input
                      type="email"
                      className="agrd__input"
                      placeholder="email@company.com"
                      value={recipient.email}
                      onChange={(e) => updateCcAt(index, 'email', e.target.value)}
                    />
                    <button
                      type="button"
                      className="agrd__recipient-remove"
                      onClick={() => removeCcAt(index)}
                      aria-label={`Remove CC recipient ${index + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {ccList.length < 10 && (
                <button type="button" className="agrd__attachment-btn agrd__attachment-btn--block" onClick={addCcRow}>
                  + Add a recipient in copy
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
              <button type="button" className="agrd__btn-secondary" onClick={closeSignatureModal} disabled={sendingSignature || markingManualSignature}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleSendForSignature}
                disabled={signatureAttachmentIds.length === 0 || !signersList[0]?.email.trim() || sendingSignature || markingManualSignature}
              >
                {sendingSignature ? 'Sending…' : 'Send for signature'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <input
                type="text"
                className="agrd__input"
                placeholder="CC (optional): cc@company.com, another-cc@company.com"
                value={activateCc}
                onChange={(e) => setActivateCc(e.target.value)}
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
      {showChangesModal && activeReviewRequest && (
        <div className="agrd__modal-backdrop" onClick={closeChangesModal}>
          <div className="agrd__redline-modal" onClick={(e) => e.stopPropagation()}>
            <div className="agrd__redline-header">
              <div>
                <h3 className="agrd__modal-title">Review changes</h3>
                <p className="agrd__modal-subtitle">
                  From {activeReviewRequest.reviewerName || activeReviewRequest.reviewerEmail}
                </p>
              </div>
              <span
                className={`agrd__redline-counter ${
                  pendingChangeCount > 0 ? 'agrd__redline-counter--pending' : 'agrd__redline-counter--done'
                }`}
              >
                {pendingChangeCount > 0
                  ? `${pendingChangeCount} change${pendingChangeCount === 1 ? '' : 's'} pending`
                  : 'All changes decided'}
              </span>
            </div>

            <div className="agrd__redline-body">
              <div
                ref={redlineMainRef}
                className="agrd__redline-main"
                onClick={handleMainPanelClick}
                dangerouslySetInnerHTML={{
                  __html:
                    activeChangeIds.length > 0
                      ? renderChangeTokensToHtml(activeChangeTokens, changeDecisions, currentChangeId)
                      : '<p>No changes detected.</p>',
                }}
              />

              <div className="agrd__redline-sidebar">
                {activeChangeIds.length > 0 && (
                  <div className="agrd__redline-sidebar-actions">
                    <button type="button" className="agrd__attachment-btn" onClick={handleAcceptAllRemaining}>
                      Accept all
                    </button>
                    <button type="button" className="agrd__attachment-btn" onClick={handleRejectAllRemaining}>
                      Reject all
                    </button>
                  </div>
                )}
                <div className="agrd__redline-list">
                  {activeChangeIds.length === 0 ? (
                    <p className="agrd__modal-hint">No changes were made to this document.</p>
                  ) : (
                    activeChangeTokens
                      .filter((tok) => tok.type !== 'equal')
                      .map((tok) => {
                        const decision = changeDecisions[tok.id] || 'pending';
                        const cleanText = tok.text.replace(/\n+/g, ' ').trim();
                        return (
                          <button
                            type="button"
                            key={tok.id}
                            className={`agrd__redline-item agrd__redline-item--${decision} ${
                              currentChangeId === tok.id ? 'agrd__redline-item--current' : ''
                            }`}
                            onClick={() => goToChange(tok.id)}
                          >
                            <span className={`agrd__redline-tag agrd__redline-tag--${tok.type}`}>
                              {tok.type === 'insert' ? 'Added' : 'Deleted'}
                            </span>
                            <p className="agrd__redline-item-text">
                              {cleanText.length > 90 ? `${cleanText.slice(0, 90)}…` : cleanText}
                            </p>
                            <span className="agrd__redline-item-actions">
                              <span
                                role="button"
                                tabIndex={0}
                                className="agrd__redline-mini-btn agrd__redline-mini-btn--reject"
                                onClick={(e) => { e.stopPropagation(); decideChange(tok.id, 'rejected'); }}
                              >
                                ✕
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                className="agrd__redline-mini-btn agrd__redline-mini-btn--accept"
                                onClick={(e) => { e.stopPropagation(); decideChange(tok.id, 'accepted'); }}
                              >
                                ✓
                              </span>
                            </span>
                          </button>
                        );
                      })
                  )}
                </div>
              </div>
            </div>

            <div className="agrd__modal-actions">
              <button type="button" className="agrd__btn-secondary" onClick={closeChangesModal} disabled={!!processingReviewId}>
                Cancel
              </button>
              <button
                type="button"
                className="agrd__btn-primary"
                onClick={handleFinalizeReview}
                disabled={pendingChangeCount > 0 || !!processingReviewId}
              >
                {processingReviewId ? 'Finalizing…' : 'Finalize & apply'}
              </button>
            </div>
          </div>
        </div>
      )}
      <NoticeModal notice={sfNotice} onClose={() => setSfNotice(null)} />
    </div>
  );
}

export default AgreementDetailScreen;