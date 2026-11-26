import { invokeFunction } from './functionsClient';

// Emails are sent by the send-email Edge Function. The browser only says which
// request or agreement to notify about: the recipient of approval/review emails
// and the link inside every email are read and built on the server.

export const sendApprovalEmail = ({ approvalId, ccEmail }) =>
  invokeFunction('send-email', { kind: 'approval', requestId: approvalId, ccEmail });

export const sendReviewEmail = ({ reviewId, ccEmail }) =>
  invokeFunction('send-email', { kind: 'review', requestId: reviewId, ccEmail });

export const sendActivationEmail = ({ agreementId, toEmail, toName, message, ccEmail }) =>
  invokeFunction('send-email', { kind: 'activation', agreementId, toEmail, toName, message, ccEmail });
