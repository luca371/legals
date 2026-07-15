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

const microsoftProvider = new OAuthProvider('microsoft.com');

const microsoftGraphProvider = new OAuthProvider('microsoft.com');
microsoftGraphProvider.addScope('Files.ReadWrite');
microsoftGraphProvider.addScope('User.Read');

export const loginWithEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);

export const loginWithMicrosoft = () => signInWithPopup(auth, microsoftProvider);

export const connectMicrosoftGraph = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You need to be signed in to Legal Space first.');
  }

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

export const sendInviteEmail = (email) => sendPasswordResetEmail(auth, email);

export const createUserAsAdmin = async (userData) => {
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

export const updateUserProfile = (uid, updates) =>
  updateDoc(doc(db, 'users', uid), {
    firstName: updates.firstName,
    lastName: updates.lastName,
    role: updates.role,
    department: updates.department || '',
    employeeId: updates.employeeId || '',
  });

export const setUserActive = (uid, isActive) =>
  updateDoc(doc(db, 'users', uid), { isActive });

export const softDeleteUser = (uid) =>
  updateDoc(doc(db, 'users', uid), { isActive: false, isDeleted: true });

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
    type: field.type, 
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

export const addDocusignEnvelope = async (agreementId, envelope) => {
  const agr = await getAgreement(agreementId);
  const docusignEnvelopes = [...(agr?.docusignEnvelopes || []), envelope];
  await updateDoc(doc(db, 'agreements', agreementId), {
    docusignEnvelopes,
    updatedAt: serverTimestamp(),
  });
  return docusignEnvelopes;
};

export const updateDocusignEnvelope = async (agreementId, envelopeId, patch) => {
  const agr = await getAgreement(agreementId);
  const docusignEnvelopes = (agr?.docusignEnvelopes || []).map((e) =>
    e.envelopeId === envelopeId ? { ...e, ...patch } : e
  );
  await updateDoc(doc(db, 'agreements', agreementId), {
    docusignEnvelopes,
    updatedAt: serverTimestamp(),
  });
  return docusignEnvelopes;
};

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

export const getApprovalRequest = async (approvalId) => {
  const snap = await getDoc(doc(db, 'approvalRequests', approvalId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const listApprovalRequestsForAgreement = async (agreementId) => {
  const snap = await getDocs(collection(db, 'approvalRequests'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.agreementId === agreementId)
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
};

export const decideApprovalRequest = async (approvalId, decision, comment) => {
  await updateDoc(doc(db, 'approvalRequests', approvalId), {
    status: decision,
    comment: (comment || '').trim(),
    decidedAt: serverTimestamp(),
  });

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

export const listAllApprovalRequests = async () => {
  const snap = await getDocs(collection(db, 'approvalRequests'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

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