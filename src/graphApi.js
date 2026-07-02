// Thin wrapper around the Microsoft Graph REST API (v1.0), used only by the
// "Send to review" (Office 365 / Word Online) feature. No SDK dependency —
// plain fetch calls, authorized with the access token obtained from
// connectMicrosoftGraph() in firebase.js.
//
// Files are uploaded to the signed-in reviewer-sender's own OneDrive, under
// a dedicated /LegalSpaceReviews folder (created implicitly by the path-based
// upload call), and are meant to be transient: Firestore/Firebase remains
// the system of record, OneDrive is just the live workbench Word Online
// needs while a document is actually being reviewed.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphRequest(accessToken, path, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Microsoft Graph error ${res.status}: ${bodyText || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Uploads a file (must be under ~4MB — Graph's simple upload limit) to
// /LegalSpaceReviews/<fileName> in the signed-in user's OneDrive. Returns
// the created DriveItem, which includes `id` (needed for sharing/fetching
// later) and `webUrl` (opens directly in Word Online).
export async function uploadFileToOneDrive(accessToken, fileName, blob) {
  const path = `/LegalSpaceReviews/${encodeURIComponent(fileName)}`;
  return graphRequest(accessToken, `/me/drive/root:${path}:/content`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    body: blob,
  });
}

// Shares the uploaded file with the reviewer(s), granting edit access and
// (optionally) sending them an email invite with a direct Word Online link.
export async function shareFileForReview(accessToken, itemId, recipientEmails, message) {
  return graphRequest(accessToken, `/me/drive/items/${itemId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipients: recipientEmails.map((email) => ({ email })),
      message: message || 'Please review this document in Word Online.',
      requireSignIn: true,
      sendInvitation: true,
      roles: ['write'],
    }),
  });
}

// Downloads the file's current content — used for "Fetch reviewed version",
// after the reviewer has (hopefully) finished their track-changes edits.
export async function downloadFileFromOneDrive(accessToken, itemId) {
  const res = await fetch(`${GRAPH_BASE}/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Microsoft Graph error ${res.status}: ${res.statusText}`);
  return res.blob();
}

// Optional cleanup once the redlined copy has been pulled back into
// Firebase — keeps OneDrive as a transient workbench rather than a second
// permanent copy of every reviewed document.
export async function deleteFileFromOneDrive(accessToken, itemId) {
  return graphRequest(accessToken, `/me/drive/items/${itemId}`, { method: 'DELETE' });
}