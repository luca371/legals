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

export async function downloadFileFromOneDrive(accessToken, itemId) {
  const res = await fetch(`${GRAPH_BASE}/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Microsoft Graph error ${res.status}: ${res.statusText}`);
  return res.blob();
}

export async function deleteFileFromOneDrive(accessToken, itemId) {
  return graphRequest(accessToken, `/me/drive/items/${itemId}`, { method: 'DELETE' });
}