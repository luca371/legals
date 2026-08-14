import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const loginWithEmail = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const registerWithEmail = (email, password) =>
  supabase.auth.signUp({ email, password });

export const loginWithGoogle = () =>
  supabase.auth.signInWithOAuth({ provider: 'google' });

export const loginWithMicrosoft = () =>
  supabase.auth.signInWithOAuth({ provider: 'azure' });

export const logout = () => supabase.auth.signOut();

export const sendPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

export const updatePassword = (newPassword) =>
  supabase.auth.updateUser({ password: newPassword });

export const getSession = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onAuthStateChange = (callback) => {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => listener.subscription.unsubscribe();
};

export const getUserStatus = async (user) => {
  if (!user) return { isAdmin: false, isActive: true };

  const { data, error } = await supabase
    .from('users')
    .select('is_admin, is_active, is_deleted')
    .eq('id', user.id)
    .single();

  if (error || !data) return { isAdmin: false, isActive: true };

  return {
    isAdmin: data.is_admin === true,
    isActive: data.is_active !== false && data.is_deleted !== true,
  };
};

export const getCurrentTenantId = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', session.user.id)
    .single();
  return data?.tenant_id ?? null;
};

export const listUsers = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((u) => ({
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    role: u.role,
    department: u.department,
    employeeId: u.employee_id,
    isActive: u.is_active,
    isDeleted: u.is_deleted,
  }));
};

export const createUserAsAdmin = async (userData) => {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error('Could not determine your tenant.');

  const response = await fetch('/api/admin-create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...userData, tenantId }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Failed to create user.');
  }
  return result.userId;
};

export const updateUserProfile = (uid, updates) =>
  supabase
    .from('users')
    .update({
      first_name: updates.firstName,
      last_name: updates.lastName,
      role: updates.role,
      department: updates.department || '',
      employee_id: updates.employeeId || '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', uid);

export const sendInviteEmail = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

export const setUserActive = (uid, isActive) =>
  supabase
    .from('users')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', uid);

export const softDeleteUser = (uid) =>
  supabase
    .from('users')
    .update({ is_active: false, is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', uid);

export const getCurrentUser = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
};

export const listAccounts = async () => {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    name: a.name,
    country: a.country,
    city: a.city,
    address: a.address,
    taxRegistrationNumber: a.tax_registration_number,
    abbreviation: a.abbreviation,
    registeredOffice: a.registered_office,
    status: a.status,
    customFields: a.custom_fields || {},
    createdBy: a.created_by,
    createdAt: a.created_at,
  }));
};

export const getAccount = async (id) => {
  const { data, error } = await supabase.from('accounts').select('*').eq('id', id).single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    country: data.country,
    city: data.city,
    address: data.address,
    taxRegistrationNumber: data.tax_registration_number,
    abbreviation: data.abbreviation,
    registeredOffice: data.registered_office,
    status: data.status,
    customFields: data.custom_fields || {},
    createdBy: data.created_by,
    createdAt: data.created_at,
  };
};

export const createAccount = async (account) => {
  const tenantId = await getCurrentTenantId();
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      tenant_id: tenantId,
      name: account.name,
      country: account.country,
      city: account.city,
      address: account.address,
      tax_registration_number: account.taxRegistrationNumber,
      abbreviation: account.abbreviation || '',
      registered_office: account.registeredOffice || '',
      status: account.status || 'Active',
      custom_fields: account.customFields || {},
      created_by: user?.email || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteAccount = async (id) => {
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) throw error;
};

export const updateAccount = (id, updates) =>
  supabase
    .from('accounts')
    .update({
      name: updates.name,
      country: updates.country,
      city: updates.city,
      address: updates.address,
      tax_registration_number: updates.taxRegistrationNumber,
      abbreviation: updates.abbreviation || '',
      registered_office: updates.registeredOffice || '',
      status: updates.status,
      custom_fields: updates.customFields || {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

export const listAgreementsByAccount = async (accountId) => {
  const { data, error } = await supabase
    .from('agreements')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    accountId: a.account_id,
    accountName: a.account_name,
    title: a.title,
    agreementType: a.agreement_type,
    agreementSubtype: a.agreement_subtype,
    language: a.language,
    status: a.status,
    effectiveDate: a.effective_date,
    endDate: a.end_date,
    templateId: a.template_id,
    contentHtml: a.content_html,
    customFields: a.custom_fields || {},
    createdBy: a.created_by,
    createdAt: a.created_at,
  }));
};

export const listAgreements = async () => {
  const { data, error } = await supabase
    .from('agreements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    accountId: a.account_id,
    accountName: a.account_name,
    title: a.title,
    agreementType: a.agreement_type,
    agreementSubtype: a.agreement_subtype,
    language: a.language,
    status: a.status,
    effectiveDate: a.effective_date,
    endDate: a.end_date,
    templateId: a.template_id,
    contentHtml: a.content_html,
    customFields: a.custom_fields || {},
    attachments: a.attachments || [],
    reviewSessions: a.review_sessions || [],
    createdBy: a.created_by,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }));
};

export const getAgreement = async (id) => {
  const { data, error } = await supabase.from('agreements').select('*').eq('id', id).single();
  if (error) throw error;
  return {
    id: data.id,
    accountId: data.account_id,
    accountName: data.account_name,
    title: data.title,
    agreementType: data.agreement_type,
    agreementSubtype: data.agreement_subtype,
    language: data.language,
    status: data.status,
    effectiveDate: data.effective_date,
    endDate: data.end_date,
    templateId: data.template_id,
    contentHtml: data.content_html,
    customFields: data.custom_fields || {},
    attachments: data.attachments || [],
    reviewSessions: data.review_sessions || [],
    docusignEnvelopes: data.docusign_envelopes || [],
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
};

export const createAgreement = async (agreement) => {
  const tenantId = await getCurrentTenantId();
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('agreements')
    .insert({
      tenant_id: tenantId,
      account_id: agreement.accountId || null,
      account_name: agreement.accountName || '',
      title: agreement.title,
      agreement_type: agreement.agreementType || '',
      agreement_subtype: agreement.agreementSubtype || '',
      language: agreement.language || 'English',
      status: agreement.status || 'Draft',
      effective_date: agreement.effectiveDate || null,
      end_date: agreement.endDate || null,
      template_id: agreement.templateId || null,
      content_html: agreement.contentHtml || '',
      custom_fields: agreement.customFields || {},
      created_by: user?.email || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateAgreement = async (id, updates) => {
  const payload = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.contentHtml !== undefined) payload.content_html = updates.contentHtml;
  if (updates.effectiveDate !== undefined) payload.effective_date = updates.effectiveDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.customFields !== undefined) payload.custom_fields = updates.customFields;
  const { data, error } = await supabase.from('agreements').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
};

export const listTemplates = async () => {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    title: t.title,
    contentHtml: t.content_html,
    fields: t.fields || [],
    createdBy: t.created_by,
    createdAt: t.created_at,
  }));
};

export const OBJECT_TYPES = ['account', 'agreement', 'template'];

const ensureObjectSchemaRow = async (objectType) => {
  const { data, error } = await supabase
    .from('object_schemas')
    .select('*')
    .eq('object_type', objectType)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const tenantId = await getCurrentTenantId();
  const { data: created, error: insertError } = await supabase
    .from('object_schemas')
    .insert({ tenant_id: tenantId, object_type: objectType, custom_fields: [], built_in_configs: {} })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
};

export const getObjectSchema = async (objectType) => {
  const row = await ensureObjectSchemaRow(objectType);
  return row.custom_fields || [];
};

export const addCustomField = async (objectType, field) => {
  const row = await ensureObjectSchemaRow(objectType);
  const newField = { id: `fld_${Date.now()}`, ...field };
  const customFields = [...(row.custom_fields || []), newField];
  const { error } = await supabase
    .from('object_schemas')
    .update({ custom_fields: customFields })
    .eq('id', row.id);
  if (error) throw error;
  return newField;
};

export const removeCustomField = async (objectType, fieldId) => {
  const row = await ensureObjectSchemaRow(objectType);
  const customFields = (row.custom_fields || []).filter((f) => f.id !== fieldId);
  const { error } = await supabase
    .from('object_schemas')
    .update({ custom_fields: customFields })
    .eq('id', row.id);
  if (error) throw error;
};

export const getBuiltInFieldConfigs = async (objectType) => {
  const row = await ensureObjectSchemaRow(objectType);
  return row.built_in_configs || {};
};

export const updateBuiltInFieldConfig = async (objectType, fieldKey, options) => {
  const row = await ensureObjectSchemaRow(objectType);
  const builtInConfigs = { ...(row.built_in_configs || {}), [fieldKey]: options };
  const { error } = await supabase
    .from('object_schemas')
    .update({ built_in_configs: builtInConfigs })
    .eq('id', row.id);
  if (error) throw error;
};

export const getTypeSubtypeMap = async () => {
  const row = await ensureObjectSchemaRow('agreement');
  return (row.built_in_configs || {}).agreementTypeSubtypeMap || {};
};

export const updateTypeSubtypeMap = async (map) => {
  const row = await ensureObjectSchemaRow('agreement');
  const builtInConfigs = { ...(row.built_in_configs || {}), agreementTypeSubtypeMap: map };
  const { error } = await supabase
    .from('object_schemas')
    .update({ built_in_configs: builtInConfigs })
    .eq('id', row.id);
  if (error) throw error;
};

export const generateAgreementFromTemplate = (templateHtml, formValues) => {
  let result = templateHtml || '';
  Object.entries(formValues).forEach(([key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    result = result.replace(pattern, value ?? '');
  });
  return result;
};

export const deleteAgreement = async (id) => {
  const { error } = await supabase.from('agreements').delete().eq('id', id);
  if (error) throw error;
};

export const updateAgreementStatus = (id, status) =>
  updateAgreement(id, { status });

export const generateAgreementDocument = (id, { templateId, status }) =>
  supabase
    .from('agreements')
    .update({ template_id: templateId, status, updated_at: new Date().toISOString() })
    .eq('id', id);

export const addAgreementAttachment = async (agreementId, attachment) => {
  const agreement = await getAgreement(agreementId);
  const attachments = [...(agreement.attachments || []), attachment];
  const { error } = await supabase
    .from('agreements')
    .update({ attachments, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};

export const deleteAgreementAttachment = async (agreementId, attachmentId) => {
  const agreement = await getAgreement(agreementId);
  const attachments = (agreement.attachments || []).filter((a) => a.id !== attachmentId);
  const { error } = await supabase
    .from('agreements')
    .update({ attachments, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};

export const addReviewSession = async (agreementId, session) => {
  const agreement = await getAgreement(agreementId);
  const reviewSessions = [...(agreement.reviewSessions || []), session];
  const { error } = await supabase
    .from('agreements')
    .update({ review_sessions: reviewSessions, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};

export const updateReviewSession = async (agreementId, sessionId, patch) => {
  const agreement = await getAgreement(agreementId);
  const reviewSessions = (agreement.reviewSessions || []).map((s) =>
    s.id === sessionId ? { ...s, ...patch } : s
  );
  const { error } = await supabase
    .from('agreements')
    .update({ review_sessions: reviewSessions, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};

export const createApprovalRequest = async ({ agreementId, agreementTitle, attachment, approverEmail, approverName, message }) => {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from('approval_requests')
    .insert({
      tenant_id: tenantId,
      agreement_id: agreementId,
      agreement_title: agreementTitle,
      attachment: attachment || null,
      approver_email: approverEmail,
      approver_name: approverName || '',
      message: message || '',
      status: 'Pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
};

export const listApprovalRequestsForAgreement = async (agreementId) => {
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('agreement_id', agreementId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    agreementId: r.agreement_id,
    agreementTitle: r.agreement_title,
    attachmentName: r.attachment?.name,
    approverEmail: r.approver_email,
    approverName: r.approver_name,
    message: r.message,
    status: r.status,
    comment: r.comment,
    createdAt: r.created_at ? { seconds: Math.floor(new Date(r.created_at).getTime() / 1000) } : null,
  }));
};

export const addDocusignEnvelope = async (agreementId, envelope) => {
  const agreement = await getAgreement(agreementId);
  const currentEnvelopes = agreement.docusignEnvelopes || [];
  const docusignEnvelopes = [...currentEnvelopes, envelope];
  const { error } = await supabase
    .from('agreements')
    .update({ docusign_envelopes: docusignEnvelopes, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};

export const updateDocusignEnvelope = async (agreementId, envelopeId, patch) => {
  const agreement = await getAgreement(agreementId);
  const currentEnvelopes = agreement.docusignEnvelopes || [];
  const docusignEnvelopes = currentEnvelopes.map((e) =>
    e.envelopeId === envelopeId ? { ...e, ...patch } : e
  );
  const { error } = await supabase
    .from('agreements')
    .update({ docusign_envelopes: docusignEnvelopes, updated_at: new Date().toISOString() })
    .eq('id', agreementId);
  if (error) throw error;
};