// EmailJS integration — sends real emails straight from the browser, no
// backend/Cloud Functions needed (those are blocked by the corporate VPN
// anyway). Used by the "Send for approval" flow, and the "Activate"
// notification (with the signed/final document attached).
//
// ---- One-time setup (emailjs.com, free tier) ----
// 1. Create an account at https://www.emailjs.com and add an Email Service
//    (Gmail, Outlook, or SMTP) under Email Services -> copy its Service ID.
// 2. Create an Email Template under Email Templates with these variables
//    available to use in the subject/body: {{to_email}}, {{to_name}},
//    {{from_name}}, {{agreement_title}}, {{message}}, {{approval_link}}
//    -> copy its Template ID.
//    Example body:
//      Hi {{to_name}},
//      {{from_name}} sent you "{{agreement_title}}" for approval on Legal Space.
//      {{message}}
//      Review and approve/reject it here: {{approval_link}}
// 3. Account -> General -> Public Key -> copy it.
// 4. Paste all three values below.
//
// ---- Second template, for "Activate" ----
// 5. Create a SECOND template (e.g. "Agreement Activated"), with variables
//    {{to_email}}, {{to_name}}, {{from_name}}, {{agreement_title}},
//    {{message}}, {{record_link}}. No attachment needed — EmailJS gates
//    attachments behind a paid plan, so this links back to the record in
//    Legal Space instead (the recipient needs a Legal Space account and to
//    be signed in to view it).
// 6. Copy that template's Template ID into ACTIVATION_TEMPLATE_ID below.

import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = 'service_vnyvtke';
const EMAILJS_TEMPLATE_ID = 'template_c0tjshe';
const EMAILJS_PUBLIC_KEY = 'XxhyAZmbDbStZ2m4E';
const ACTIVATION_TEMPLATE_ID = 'YOUR_ACTIVATION_TEMPLATE_ID';

export const sendApprovalEmail = async ({
  toEmail,
  toName,
  fromName,
  agreementTitle,
  message,
  approvalLink,
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
}) => {
  if (ACTIVATION_TEMPLATE_ID === 'template_mh5uqob') {
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
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );
};