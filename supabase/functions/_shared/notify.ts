import { sendEmailJs } from './emailjs.ts';

// All outgoing emails are sent from here, server-side. The browser never holds
// EmailJS keys and never chooses the link inside an email: links are built
// from APP_BASE_URL and the id of a row the server has just checked.

// Template ids are not secrets; the env vars win when set.
const APPROVAL_TEMPLATE_ID = Deno.env.get('EMAILJS_APPROVAL_TEMPLATE_ID') || 'template_rk4qeo4';
// Generic template (subject_line / intro_text / detail_line / cta_label / cta_link),
// shared by review emails, activation notices and expiry reminders.
const GENERIC_TEMPLATE_ID = Deno.env.get('EMAILJS_REVIEW_TEMPLATE_ID') || 'template_wxn3x0l';

export function appBaseUrl() {
  const url = (Deno.env.get('APP_BASE_URL') || Deno.env.get('APP_URL') || '').replace(/\/$/, '');
  if (!url) throw new Error('APP_BASE_URL is not set on the Edge Functions.');
  return url;
}

function send(templateId: string, templateParams: Record<string, unknown>) {
  return sendEmailJs({
    serviceId: Deno.env.get('EMAILJS_SERVICE_ID') ?? '',
    templateId,
    publicKey: Deno.env.get('EMAILJS_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('EMAILJS_PRIVATE_KEY') ?? undefined,
    templateParams,
  });
}

type Row = Record<string, any>;

export function approvalLink(id: string) {
  return `${appBaseUrl()}/approve/${id}`;
}

export function reviewLink(id: string) {
  return `${appBaseUrl()}/review/${id}`;
}

export function sendApprovalEmail(request: Row, ccEmail = '') {
  return send(APPROVAL_TEMPLATE_ID, {
    to_email: request.approver_email,
    to_name: request.approver_name || request.approver_email,
    from_name: request.requested_by || 'EsoVia',
    agreement_title: request.agreement_title || '',
    message: request.message || '',
    approval_link: approvalLink(request.id),
    cc_email: ccEmail,
  });
}

export function sendReviewEmail(request: Row, ccEmail = '') {
  const from = request.requested_by || 'Someone';
  const title = request.agreement_title || 'a document';
  return send(GENERIC_TEMPLATE_ID, {
    to_email: request.reviewer_email,
    to_name: request.reviewer_name || request.reviewer_email,
    from_name: request.requested_by || 'EsoVia',
    subject_line: `Review requested: ${title}`,
    intro_text: `${from} has asked you to review "${title}".`,
    detail_line: request.message || '',
    cta_label: 'Open for review',
    cta_link: reviewLink(request.id),
    cc_email: ccEmail,
  });
}

export function sendActivationEmail({
  toEmail,
  toName,
  fromName,
  agreement,
  message,
  ccEmail = '',
}: {
  toEmail: string;
  toName?: string;
  fromName?: string;
  agreement: Row;
  message?: string;
  ccEmail?: string;
}) {
  const title = agreement.title || 'An agreement';
  return send(GENERIC_TEMPLATE_ID, {
    to_email: toEmail,
    to_name: toName || toEmail,
    from_name: fromName || 'EsoVia',
    subject_line: `Agreement activated: ${title}`,
    intro_text: `"${title}" has been activated.`,
    detail_line: message || '',
    cta_label: 'View agreement',
    cta_link: `${appBaseUrl()}/dashboard/agreements/${agreement.id}`,
    cc_email: ccEmail,
  });
}

// Any other notice, on the generic template (reminders for notice deadlines,
// tasks and obligations).
export function sendGenericEmail({
  toEmail,
  subject,
  intro,
  detail = '',
  ctaLabel,
  ctaPath,
}: {
  toEmail: string;
  subject: string;
  intro: string;
  detail?: string;
  ctaLabel: string;
  ctaPath: string;
}) {
  return send(GENERIC_TEMPLATE_ID, {
    to_email: toEmail,
    to_name: toEmail,
    from_name: 'EsoVia',
    subject_line: subject,
    intro_text: intro,
    detail_line: detail,
    cta_label: ctaLabel,
    cta_link: `${appBaseUrl()}${ctaPath}`,
    cc_email: '',
  });
}
