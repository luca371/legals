// Firebase initialization and Auth exports
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  linkWithPopup,
  reauthenticateWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCCkloWmfcmr7SuPeZGX8ZDBZa0DpV96pU',
  authDomain: 'legals-64fcf.firebaseapp.com',
  projectId: 'legals-64fcf',
  storageBucket: 'legals-64fcf.firebasestorage.app',
  messagingSenderId: '269822718623',
  appId: '1:269822718623:web:cf5a1b147ee9b8e51ba8aa',
  measurementId: 'G-SE9T0WM86M',
};

const app = initializeApp(firebaseConfig);

let analytics;
try {
  analytics = getAnalytics(app);
} catch (err) {
  analytics = null;
}

const auth = getAuth(app);
auth.languageCode = 'en';

export const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

// NOTE: "microsoft.com" must be enabled as a provider in the Firebase Console
// (Authentication > Sign-in method > Microsoft), with Azure AD app credentials configured there.
const microsoftProvider = new OAuthProvider('microsoft.com');

// Separate provider, scoped for Microsoft Graph (OneDrive) access, used
// only by the "Send to review" / Office 365 Word Online feature — kept
// apart from the plain sign-in provider so normal login doesn't prompt for
// extra permissions it doesn't need.
const microsoftGraphProvider = new OAuthProvider('microsoft.com');
microsoftGraphProvider.addScope('Files.ReadWrite');
microsoftGraphProvider.addScope('User.Read');

export const loginWithEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);

export const loginWithMicrosoft = () => signInWithPopup(auth, microsoftProvider);

// Firebase does not persist or refresh the underlying OAuth provider's
// access token across sessions — it's only available on the sign-in
// result, right after the popup completes, and expires in about an hour.
// So this must be called fresh right before each Graph API call (right
// before uploading a file for review, and again right before fetching the
// reviewed copy back), not cached long-term.
export const connectMicrosoftGraph = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You need to be signed in to Legal Space first.');
  }

  // Using signInWithPopup here would try to start a brand new sign-in and
  // can collide with the already-signed-in account (auth/account-exists-
  // with-different-credential) if that account's email is linked to a
  // different provider (email/password, Google, etc). Instead, we attach
  // the Microsoft credential to the CURRENT user via linkWithPopup. If
  // Microsoft is already linked from a previous "Send to review" call, it
  // falls back to reauthenticateWithPopup to just get a fresh token.
  let result;
  try {
    result = await linkWithPopup(currentUser, microsoftGraphProvider);
  } catch (err) {
    if (err.code === 'auth/provider-already-linked' || err.code === 'auth/credential-already-in-use') {
      result = await reauthenticateWithPopup(currentUser, microsoftGraphProvider);
    } else {
      throw err;
    }
  }

  const credential = OAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Microsoft did not return a Graph access token.');
  }
  return { accessToken: credential.accessToken };
};

export const logout = () => signOut(auth);

// ---- Admin / Users feature ----

// Checks the Firestore profile doc for an `isAdmin: true` flag and whether
// the account is still active. (Temporary demo approach — will move to
// Custom Claims + Cloud Functions later, once VPN/CLI access is sorted.)
export const getUserStatus = async (user) => {
  if (!user) return { isAdmin: false, isActive: true };
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) return { isAdmin: false, isActive: true };
  const data = snap.data();
  return {
    isAdmin: data.isAdmin === true,
    isActive: data.isActive !== false && data.isDeleted !== true,
  };
};

// Sends Firebase's built-in "reset your password" email — used both as the
// invite email for newly created users, and for the "Reset password for
// this user" action in the admin menu. No backend needed.
export const sendInviteEmail = (email) => sendPasswordResetEmail(auth, email);

// Creates a new user from the Admin screen WITHOUT logging out the
// currently signed-in admin. Uses a second, throwaway Firebase App
// instance just for the create-user call, then tears it down.
export const createUserAsAdmin = async (userData) => {
  // Clean up any leftover "Secondary" app instance from a previous failed attempt
  const existingSecondary = getApps().find((a) => a.name === 'Secondary');
  if (existingSecondary) {
    await deleteApp(existingSecondary);
  }

  const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
  const secondaryAuth = getAuth(secondaryApp);

  const { user } = await createUserWithEmailAndPassword(
    secondaryAuth,
    userData.email,
    userData.password
  );

  await setDoc(doc(db, 'users', user.uid), {
    firstName: userData.firstName,
    lastName: userData.lastName,
    email: userData.email,
    role: userData.role,
    department: userData.department || '',
    employeeId: userData.employeeId || '',
    isAdmin: false,
    isActive: true,
    createdAt: serverTimestamp(),
  });

  await signOut(secondaryAuth);
  await deleteApp(secondaryApp);

  return user.uid;
};

// Updates the editable profile fields for an existing user.
// Email and password are intentionally excluded here — changing email
// requires re-authenticating that specific user's Auth account, and
// password changes go through the "Reset password" email flow instead.
export const updateUserProfile = (uid, updates) =>
  updateDoc(doc(db, 'users', uid), {
    firstName: updates.firstName,
    lastName: updates.lastName,
    role: updates.role,
    department: updates.department || '',
    employeeId: updates.employeeId || '',
  });

// Blocks/unblocks app access without touching the real Firebase Auth account
// (that needs Admin SDK / Cloud Functions — see notes).
export const setUserActive = (uid, isActive) =>
  updateDoc(doc(db, 'users', uid), { isActive });

// "Soft delete" — marks the user as deleted + inactive, hides them from the
// admin list, and blocks their login. The underlying Auth account still
// technically exists until Cloud Functions are wired up.
export const softDeleteUser = (uid) =>
  updateDoc(doc(db, 'users', uid), { isActive: false, isDeleted: true });

// ---- Object schemas (Admin > Objects) ----
// Each object type (account / agreement / template) has a Firestore doc
// under `objectSchemas/{type}` storing only the ADMIN-DEFINED custom fields.
// Built-in fields (Title, Status, the Account lookup on Agreement, etc.)
// are hardcoded in the UI/business logic — they're not part of this schema,
// since they're structural, not configurable.

export const OBJECT_TYPES = ['account', 'agreement', 'template'];

export const getObjectSchema = async (objectType) => {
  const snap = await getDoc(doc(db, 'objectSchemas', objectType));
  return snap.exists() ? snap.data().customFields || [] : [];
};

export const addCustomField = async (objectType, field) => {
  const ref = doc(db, 'objectSchemas', objectType);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data().customFields || [] : [];

  const newField = {
    id: `f_${Date.now()}`,
    label: field.label,
    type: field.type, // 'text' | 'number' | 'date' | 'dropdown' | 'lookup'
    options: field.type === 'dropdown' ? field.options : null,
    lookupTarget: field.type === 'lookup' ? field.lookupTarget : null,
  };

  await setDoc(
    ref,
    {
      customFields: [...existing, newField],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return newField;
};

export const removeCustomField = async (objectType, fieldId) => {
  const ref = doc(db, 'objectSchemas', objectType);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const existing = snap.data().customFields || [];
  await updateDoc(ref, {
    customFields: existing.filter((f) => f.id !== fieldId),
    updatedAt: serverTimestamp(),
  });
};

// ---- Template Builder ----
// Templates are matched later (at Agreement generation time) by
// agreementType + agreementSubtype + language, so those three fields
// are what the generation screen will filter/search on.

export const saveTemplate = (templateData) =>
  addDoc(collection(db, 'templates'), {
    name: templateData.name,
    agreementType: templateData.agreementType,
    agreementSubtype: templateData.agreementSubtype,
    language: templateData.language,
    contentHtml: templateData.contentHtml,
    fieldsUsed: templateData.fieldsUsed || [],
    status: 'active',
    createdAt: serverTimestamp(),
  });

export const updateTemplate = (templateId, templateData) =>
  updateDoc(doc(db, 'templates', templateId), {
    name: templateData.name,
    agreementType: templateData.agreementType,
    agreementSubtype: templateData.agreementSubtype,
    language: templateData.language,
    contentHtml: templateData.contentHtml,
    fieldsUsed: templateData.fieldsUsed || [],
    updatedAt: serverTimestamp(),
  });

export const listTemplates = async () => {
  const snap = await getDocs(query(collection(db, 'templates'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const getTemplate = async (templateId) => {
  const snap = await getDoc(doc(db, 'templates', templateId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const deleteTemplate = (templateId) => deleteDoc(doc(db, 'templates', templateId));

// ---- Accounts ----

export const createAccount = async (accountData) => {
  const currentUser = auth.currentUser;
  const createdByName = currentUser?.displayName || currentUser?.email || 'Unknown';

  return addDoc(collection(db, 'accounts'), {
    name: accountData.name,
    country: accountData.country,
    city: accountData.city,
    address: accountData.address,
    taxRegistrationNumber: accountData.taxRegistrationNumber,
    abbreviation: accountData.abbreviation || '',
    registeredOffice: accountData.registeredOffice || '',
    status: accountData.status || 'Active',
    customFields: accountData.customFields || {},
    createdBy: createdByName,
    createdAt: serverTimestamp(),
  });
};

export const updateAccount = (accountId, accountData) =>
  updateDoc(doc(db, 'accounts', accountId), {
    name: accountData.name,
    country: accountData.country,
    city: accountData.city,
    address: accountData.address,
    taxRegistrationNumber: accountData.taxRegistrationNumber,
    abbreviation: accountData.abbreviation || '',
    registeredOffice: accountData.registeredOffice || '',
    status: accountData.status || 'Active',
    customFields: accountData.customFields || {},
    updatedAt: serverTimestamp(),
  });

export const listAccounts = async () => {
  const snap = await getDocs(query(collection(db, 'accounts'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const getAccount = async (accountId) => {
  const snap = await getDoc(doc(db, 'accounts', accountId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const deleteAccount = (accountId) => deleteDoc(doc(db, 'accounts', accountId));

// ---- Agreements ----

export const createAgreement = async (agreementData) => {
  const currentUser = auth.currentUser;
  const createdByName = currentUser?.displayName || currentUser?.email || 'Unknown';
  const initialStatus = agreementData.status || 'Draft';

  return addDoc(collection(db, 'agreements'), {
    title: agreementData.title,
    accountId: agreementData.accountId || null,
    accountName: agreementData.accountName || '',
    agreementType: agreementData.agreementType || '',
    agreementSubtype: agreementData.agreementSubtype || '',
    language: agreementData.language || 'English',
    status: initialStatus,
    effectiveDate: agreementData.effectiveDate || '',
    endDate: agreementData.endDate || '',
    templateId: agreementData.templateId || null,
    contentHtml: agreementData.contentHtml || '',
    customFields: agreementData.customFields || {},
    createdBy: createdByName,
    createdAt: serverTimestamp(),
    // Powers the "Time to contract" dashboard metric (time between the
    // Draft and Activated entries). Uses a client-side ISO timestamp
    // rather than serverTimestamp(), since Firestore doesn't allow the
    // serverTimestamp() sentinel value inside array elements.
    statusHistory: [{ status: initialStatus, changedAt: new Date().toISOString() }],
  });
};

export const updateAgreement = (agreementId, agreementData) =>
  updateDoc(doc(db, 'agreements', agreementId), {
    title: agreementData.title,
    accountId: agreementData.accountId || null,
    accountName: agreementData.accountName || '',
    agreementType: agreementData.agreementType || '',
    agreementSubtype: agreementData.agreementSubtype || '',
    language: agreementData.language || 'English',
    status: agreementData.status || 'Draft',
    effectiveDate: agreementData.effectiveDate || '',
    endDate: agreementData.endDate || '',
    customFields: agreementData.customFields || {},
    updatedAt: serverTimestamp(),
  });

export const listAgreements = async () => {
  const snap = await getDocs(query(collection(db, 'agreements'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const listAgreementsByAccount = async (accountId) => {
  const snap = await getDocs(
    query(collection(db, 'agreements'), orderBy('createdAt', 'desc'))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.accountId === accountId);
};

export const getAgreement = async (agreementId) => {
  const snap = await getDoc(doc(db, 'agreements', agreementId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const deleteAgreement = (agreementId) =>
  deleteDoc(doc(db, 'agreements', agreementId));

// Marks which template was used and bumps status after a successful
// "Generate agreement" — the actual .docx file itself is stored as a
// base64 attachment directly on the agreement doc (see below), since
// Firebase Storage requires the Blaze plan.
export const generateAgreementDocument = async (agreementId, data) => {
  const agr = await getAgreement(agreementId);
  const nextStatus = data.status || 'Generated';
  const statusHistory = [...(agr?.statusHistory || [])];
  if (statusHistory[statusHistory.length - 1]?.status !== nextStatus) {
    statusHistory.push({ status: nextStatus, changedAt: new Date().toISOString() });
  }
  return updateDoc(doc(db, 'agreements', agreementId), {
    templateId: data.templateId || null,
    status: nextStatus,
    statusHistory,
    updatedAt: serverTimestamp(),
  });
};

// Lightweight status-only update — unlike updateAgreement (which writes the
// full form and would blank out fields if called partially), this only
// touches `status`. Used when an action (send to review, etc.) should move
// the pipeline forward without the user editing the record themselves.
// Also appends to `statusHistory`, which the Dashboards screen uses to
// compute "Time to contract" and time-in-stage metrics.
export const updateAgreementStatus = async (agreementId, status) => {
  const agr = await getAgreement(agreementId);
  const statusHistory = [...(agr?.statusHistory || [])];
  if (statusHistory[statusHistory.length - 1]?.status !== status) {
    statusHistory.push({ status, changedAt: new Date().toISOString() });
  }
  return updateDoc(doc(db, 'agreements', agreementId), {
    status,
    statusHistory,
    updatedAt: serverTimestamp(),
  });
};

// ---- Agreement attachments (stored inline in Firestore, base64) ----
// No Firebase Storage (that needs the Blaze plan) — attachments are kept
// as a plain array field on the agreement doc, with the file content
// base64-encoded. Firestore documents cap at 1MB total, so this is fine
// for typical generated contracts but not for large/many files.

export const addAgreementAttachment = async (agreementId, attachment) => {
  const agr = await getAgreement(agreementId);
  const attachments = [...(agr?.attachments || []), attachment];
  await updateDoc(doc(db, 'agreements', agreementId), {
    attachments,
    updatedAt: serverTimestamp(),
  });
  return attachments;
};

export const deleteAgreementAttachment = async (agreementId, attachmentId) => {
  const agr = await getAgreement(agreementId);
  const attachments = (agr?.attachments || []).filter((a) => a.id !== attachmentId);
  await updateDoc(doc(db, 'agreements', agreementId), {
    attachments,
    updatedAt: serverTimestamp(),
  });
  return attachments;
};

// ---- Review sessions ("Send to review" via Office 365 / Word Online) ----
// Tracks which attachment was sent out, to whom, and whether the redlined
// copy has been fetched back yet. Kept as a plain array field on the
// agreement doc, same pattern as attachments.

export const addReviewSession = async (agreementId, session) => {
  const agr = await getAgreement(agreementId);
  const reviewSessions = [...(agr?.reviewSessions || []), session];
  await updateDoc(doc(db, 'agreements', agreementId), {
    reviewSessions,
    updatedAt: serverTimestamp(),
  });
  return reviewSessions;
};

export const updateReviewSession = async (agreementId, sessionId, patch) => {
  const agr = await getAgreement(agreementId);
  const reviewSessions = (agr?.reviewSessions || []).map((s) =>
    s.id === sessionId ? { ...s, ...patch } : s
  );
  await updateDoc(doc(db, 'agreements', agreementId), {
    reviewSessions,
    updatedAt: serverTimestamp(),
  });
  return reviewSessions;
};

export const deleteReviewSession = async (agreementId, sessionId) => {
  const agr = await getAgreement(agreementId);
  const reviewSessions = (agr?.reviewSessions || []).filter((s) => s.id !== sessionId);
  await updateDoc(doc(db, 'agreements', agreementId), {
    reviewSessions,
    updatedAt: serverTimestamp(),
  });
  return reviewSessions;
};

// ---- Approval requests ("Send for approval") ----
// Kept as their OWN top-level collection — unlike reviewSessions, which
// live as an array field on the agreement doc — because the approver who
// opens this link has NO Legal Space account. The doc ID itself acts as
// the secret "magic link" token (same demo-phase trade-off already made
// elsewhere, e.g. isAdmin as a Firestore flag instead of Custom Claims).
// Isolating approvals into their own collection means public/unauthenticated
// access only ever touches this one narrow collection, never the rest of
// the agreement's data or other agreements. See firestore.rules.
//
// Each request is a self-contained snapshot: the document being approved
// is copied into the request itself (attachmentDataBase64 / sourceHtml),
// so the public approval screen never needs read access to the
// `agreements` collection at all.

export const createApprovalRequest = async ({
  agreementId,
  agreementTitle,
  attachment,
  approverEmail,
  approverName,
  message,
}) => {
  const currentUser = auth.currentUser;
  const requestedBy = currentUser?.displayName || currentUser?.email || 'Unknown';

  const ref = await addDoc(collection(db, 'approvalRequests'), {
    agreementId,
    agreementTitle: agreementTitle || '',
    attachmentId: attachment?.id || null,
    attachmentName: attachment?.name || '',
    attachmentMimeType: attachment?.mimeType || '',
    attachmentDataBase64: attachment?.dataBase64 || '',
    sourceHtml: attachment?.sourceHtml || '',
    approverEmail: (approverEmail || '').trim(),
    approverName: (approverName || '').trim(),
    message: (message || '').trim(),
    requestedBy,
    status: 'Pending',
    comment: '',
    createdAt: serverTimestamp(),
    decidedAt: null,
  });
  return ref.id;
};

// Public read — no auth required. The approval ID in the URL IS the access
// token, so anyone who has the link (and only them) can look this up.
// See firestore.rules: `allow read: if true` on this collection.
export const getApprovalRequest = async (approvalId) => {
  const snap = await getDoc(doc(db, 'approvalRequests', approvalId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Used by AgreementDetailScreen to show every approval sent for a given
// agreement. Filtered client-side (rather than a Firestore `where` query)
// to avoid needing a composite index just for this list.
export const listApprovalRequestsForAgreement = async (agreementId) => {
  const snap = await getDocs(collection(db, 'approvalRequests'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.agreementId === agreementId)
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
};

// Called from the PUBLIC approval screen — the approver has no account, so
// this must work while fully signed out. Firestore rules only allow this
// update while status is still "Pending", and only for these three fields.
export const decideApprovalRequest = async (approvalId, decision, comment) => {
  await updateDoc(doc(db, 'approvalRequests', approvalId), {
    status: decision,
    comment: (comment || '').trim(),
    decidedAt: serverTimestamp(),
  });

  // Best-effort: also advance the underlying agreement's own status once
  // approved. This is a SEPARATE write against the `agreements` collection,
  // guarded by its own narrow public rule (see firestore.rules) — if that
  // rule isn't in place, this just fails silently and the agreement's
  // status stays as-is until an admin updates it manually.
  if (decision === 'Approved') {
    try {
      const approval = await getApprovalRequest(approvalId);
      if (approval?.agreementId) {
        await updateDoc(doc(db, 'agreements', approval.agreementId), {
          status: 'Approved',
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Could not auto-advance the agreement status (check firestore.rules):', err);
    }
  }
};

// Used by the Dashboards screen (approval funnel chart) — every approval
// request across every agreement, not scoped to one.
export const listAllApprovalRequests = async () => {
  const snap = await getDocs(collection(db, 'approvalRequests'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// ---- Built-in field configs (configurable dropdowns on built-in fields) ----

export const getBuiltInFieldConfigs = async (objectType) => {
  const snap = await getDoc(doc(db, 'objectSchemas', objectType));
  return snap.exists() ? snap.data().builtInConfigs || {} : {};
};

export const updateBuiltInFieldConfig = async (objectType, fieldKey, options) => {
  const ref = doc(db, 'objectSchemas', objectType);
  await setDoc(ref, {
    builtInConfigs: { [fieldKey]: options },
  }, { merge: true });
};

// ---- Type → Subtype mapping ----
export const getTypeSubtypeMap = async () => {
  const configs = await getBuiltInFieldConfigs('agreement');
  return configs.agreementTypeSubtypeMap || {};
};

export const updateTypeSubtypeMap = async (map) => {
  const ref = doc(db, 'objectSchemas', 'agreement');
  await setDoc(ref, {
    builtInConfigs: { agreementTypeSubtypeMap: map },
  }, { merge: true });
};

export { app, analytics, auth, onAuthStateChanged };