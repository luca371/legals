import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = 'service_fkxyweh';
const EMAILJS_TEMPLATE_ID = 'template_rk4qeo4';
const EMAILJS_PUBLIC_KEY = 'gQPPeWWJNRodsCFds';
// Not created in the new EmailJS account yet — activation emails will fail
// with "template not found" until this is set to a real template id there.
const ACTIVATION_TEMPLATE_ID = 'YOUR_ACTIVATION_TEMPLATE_ID';
const REVIEW_TEMPLATE_ID = 'template_wxn3x0l';

export const sendApprovalEmail = async ({
  toEmail,
  toName,
  fromName,
  agreementTitle,
  message,
  approvalLink,
  ccEmail,
}) => {
  if (
    EMAILJS_SERVICE_ID === 'YOUR_SERVICE_ID' ||
    EMAILJS_TEMPLATE_ID === 'YOUR_TEMPLATE_ID' ||
    EMAILJS_PUBLIC_KEY === 'YOUR_PUBLIC_KEY'
  ) {
    throw new Error('EmailJS is not configured yet — set the IDs in src/emailApi.js.');
  }

  return emailjs.send(
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    {
      to_email: toEmail,
      to_name: toName || toEmail,
      from_name: fromName || 'Legal Space',
      agreement_title: agreementTitle || '',
      message: message || '',
      approval_link: approvalLink,
      cc_email: ccEmail || '',
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );
};

export const sendActivationEmail = async ({
  toEmail,
  toName,
  fromName,
  agreementTitle,
  message,
  recordLink,
  ccEmail,
}) => {
  if (ACTIVATION_TEMPLATE_ID === 'YOUR_ACTIVATION_TEMPLATE_ID') {
    throw new Error('The activation email template is not configured yet — set ACTIVATION_TEMPLATE_ID in src/emailApi.js.');
  }

  return emailjs.send(
    EMAILJS_SERVICE_ID,
    ACTIVATION_TEMPLATE_ID,
    {
      to_email: toEmail,
      to_name: toName || toEmail,
      from_name: fromName || 'Legal Space',
      agreement_title: agreementTitle || '',
      message: message || '',
      record_link: recordLink,
      cc_email: ccEmail || '',
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );
};

// REVIEW_TEMPLATE_ID is a generic template (EmailJS free plan only allows 2)
// — also reused for expiry reminders on the server side. Its placeholders
// are subject_line/intro_text/detail_line/cta_label/cta_link, not
// review-specific fields, so any future email type can reuse it too by
// just filling those in differently, no new template needed.
export const sendReviewEmail = async ({
  toEmail,
  toName,
  fromName,
  agreementTitle,
  message,
  reviewLink,
  ccEmail,
}) => {
  if (REVIEW_TEMPLATE_ID === 'YOUR_REVIEW_TEMPLATE_ID') {
    throw new Error('The review email template is not configured yet — set REVIEW_TEMPLATE_ID in src/emailApi.js.');
  }

  return emailjs.send(
    EMAILJS_SERVICE_ID,
    REVIEW_TEMPLATE_ID,
    {
      to_email: toEmail,
      to_name: toName || toEmail,
      from_name: fromName || 'Legal Space',
      subject_line: `Review requested: ${agreementTitle || 'a document'}`,
      intro_text: `${fromName || 'Someone'} has asked you to review "${agreementTitle || 'a document'}".`,
      detail_line: message || '',
      cta_label: 'Open for review',
      cta_link: reviewLink,
      cc_email: ccEmail || '',
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );
};