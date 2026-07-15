import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = 'service_vnyvtke';
const EMAILJS_TEMPLATE_ID = 'template_c0tjshe';
const EMAILJS_PUBLIC_KEY = 'XxhyAZmbDbStZ2m4E';
const ACTIVATION_TEMPLATE_ID = 'template_mh5uqob';

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
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );
};