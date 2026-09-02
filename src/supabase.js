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
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body: userData,
  });

  if (error) {
    let message = error.message;
    if (error.context && typeof error.context.json === 'function') {
      try {
        const parsed = await error.context.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // response body wasn't JSON — keep the generic message
      }
    }
    throw new Error(message || 'Failed to create user.');
  }
  return data.userId;
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

// Playbooks live at the organization level (e.g. "Procurement rules", "GDPR
// rules") — each one gets assigned to whichever accounts it applies to, and
// the reviewer then picks a subset of the account's assigned playbooks when
// running Review AI on a specific agreement.
export const listPlaybooks = async () => {
  const { data, error } = await supabase.from('playbooks').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((p) => ({ id: p.id, title: p.title, body: p.body, createdAt: p.created_at }));
};

export const createPlaybook = async (playbook) => {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from('playbooks')
    .insert({ tenant_id: tenantId, title: playbook.title, body: playbook.body })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updatePlaybook = async (id, playbook) => {
  const { error } = await supabase
    .from('playbooks')
    .update({ title: playbook.title, body: playbook.body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

export const deletePlaybook = async (id) => {
  const { error } = await supabase.from('playbooks').delete().eq('id', id);
  if (error) throw error;
};

export const listAssignedPlaybookIds = async (accountId) => {
  const { data, error } = await supabase.from('account_playbooks').select('playbook_id').eq('account_id', accountId);
  if (error) throw error;
  return data.map((r) => r.playbook_id);
};

export const setAccountPlaybooks = async (accountId, playbookIds) => {
  const tenantId = await getCurrentTenantId();
  const { error: deleteError } = await supabase.from('account_playbooks').delete().eq('account_id', accountId);
  if (deleteError) throw deleteError;
  if (playbookIds.length === 0) return;
  const { error: insertError } = await supabase
    .from('account_playbooks')
    .insert(playbookIds.map((playbookId) => ({ tenant_id: tenantId, account_id: accountId, playbook_id: playbookId })));
  if (insertError) throw insertError;
};

// Full playbook objects assigned to one account — what Review AI's
// playbook picker is populated from.
export const listPlaybooksByAccount = async (accountId) => {
  const { data, error } = await supabase
    .from('account_playbooks')
    .select('playbook_id, playbooks(id, title, body, created_at)')
    .eq('account_id', accountId);
  if (error) throw error;
  return data.map((r) => ({ id: r.playbooks.id, title: r.playbooks.title, body: r.playbooks.body, createdAt: r.playbooks.created_at }));
};

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
    relatedAgreementId: a.related_agreement_id || null,
    relationType: a.relation_type || null,
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
    relatedAgreementId: data.related_agreement_id || null,
    relationType: data.relation_type || null,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
};

// Agreements that point AT this one (e.g. its renewals/amendments) — the
// reverse direction of relatedAgreementId, for showing "renewed by X".
export const listAgreementsRelatedTo = async (agreementId) => {
  const { data, error } = await supabase
    .from('agreements')
    .select('id, title, relation_type')
    .eq('related_agreement_id', agreementId);
  if (error) throw error;
  return data.map((a) => ({ id: a.id, title: a.title, relationType: a.relation_type }));
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
  if (updates.relatedAgreementId !== undefined) payload.related_agreement_id = updates.relatedAgreementId;
  if (updates.relationType !== undefined) payload.relation_type = updates.relationType;
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
    name: t.title,
    agreementType: t.agreement_type,
    agreementSubtype: t.agreement_subtype,
    language: t.language,
    contentHtml: t.content_html,
    fieldsUsed: t.fields || [],
    createdBy: t.created_by,
    createdAt: t.created_at,
  }));
};

export const saveTemplate = async (template) => {
  const tenantId = await getCurrentTenantId();
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('templates')
    .insert({
      tenant_id: tenantId,
      title: template.name,
      agreement_type: template.agreementType,
      agreement_subtype: template.agreementSubtype,
      language: template.language || 'English',
      content_html: template.contentHtml || '',
      fields: template.fieldsUsed || [],
      created_by: user?.email || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateTemplate = async (id, template) => {
  const { data, error } = await supabase
    .from('templates')
    .update({
      title: template.name,
      agreement_type: template.agreementType,
      agreement_subtype: template.agreementSubtype,
      language: template.language || 'English',
      content_html: template.contentHtml || '',
      fields: template.fieldsUsed || [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteTemplate = async (id) => {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
};

export const createReviewRequest = async ({
  agreementId,
  agreementTitle,
  attachmentId,
  attachmentName,
  originalHtml,
  reviewerEmail,
  reviewerName,
  message,
  sequence,
  batchId,
  requestedBy,
}) => {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from('review_requests')
    .insert({
      tenant_id: tenantId,
      agreement_id: agreementId,
      agreement_title: agreementTitle,
      attachment_id: attachmentId,
      attachment_name: attachmentName,
      original_html: originalHtml,
      reviewer_email: reviewerEmail,
      reviewer_name: reviewerName || '',
      message: message || '',
      status: 'Pending',
      sequence: sequence || 1,
      batch_id: batchId,
      requested_by: requestedBy || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
};

const mapReviewRequest = (r) => ({
  id: r.id,
  agreementId: r.agreement_id,
  agreementTitle: r.agreement_title,
  attachmentId: r.attachment_id,
  attachmentName: r.attachment_name,
  originalHtml: r.original_html,
  reviewerEmail: r.reviewer_email,
  reviewerName: r.reviewer_name,
  message: r.message,
  status: r.status,
  submittedHtml: r.submitted_html,
  redlineTokens: r.redline_tokens,
  submittedAt: r.submitted_at,
  sequence: r.sequence || 1,
  batchId: r.batch_id,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
});

export const listReviewRequestsForAgreement = async (agreementId) => {
  const { data, error } = await supabase
    .from('review_requests')
    .select('*')
    .eq('agreement_id', agreementId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapReviewRequest);
};

export const getReviewRequestPublic = async (id) => {
  const { data, error } = await supabase
    .from('review_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return mapReviewRequest(data);
};

export const getNextReviewInBatch = async (batchId, sequence) => {
  if (!batchId) return null;
  const { data, error } = await supabase
    .from('review_requests')
    .select('*')
    .eq('batch_id', batchId)
    .eq('sequence', sequence + 1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapReviewRequest(data) : null;
};

export const submitReviewChanges = async (id, submittedHtml, changeTokens) => {
  const { error } = await supabase
    .from('review_requests')
    .update({
      submitted_html: submittedHtml,
      redline_tokens: changeTokens,
      status: 'Submitted',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
};

export const acceptReviewChanges = async (id) => {
  const { error } = await supabase
    .from('review_requests')
    .update({ status: 'Accepted', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

export const rejectReviewChanges = async (id) => {
  const { error } = await supabase
    .from('review_requests')
    .update({ status: 'Rejected', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
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

export const createApprovalRequest = async ({
  agreementId,
  agreementTitle,
  attachment,
  approverEmail,
  approverName,
  message,
  sequence,
  batchId,
  requestedBy,
}) => {
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
      sequence: sequence || 1,
      batch_id: batchId,
      requested_by: requestedBy || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
};

const mapApprovalRequest = (r) => ({
  id: r.id,
  agreementId: r.agreement_id,
  agreementTitle: r.agreement_title,
  attachmentName: r.attachment?.name,
  attachment: r.attachment,
  approverEmail: r.approver_email,
  approverName: r.approver_name,
  message: r.message,
  status: r.status,
  comment: r.comment,
  sequence: r.sequence || 1,
  batchId: r.batch_id,
  requestedBy: r.requested_by,
  createdAt: r.created_at ? { seconds: Math.floor(new Date(r.created_at).getTime() / 1000) } : null,
});

export const listApprovalRequestsForAgreement = async (agreementId) => {
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('agreement_id', agreementId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapApprovalRequest);
};

export const getApprovalRequest = async (id) => {
  const { data, error } = await supabase.from('approval_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapApprovalRequest(data) : null;
};

export const getNextApprovalInBatch = async (batchId, sequence) => {
  if (!batchId) return null;
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('batch_id', batchId)
    .eq('sequence', sequence + 1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapApprovalRequest(data) : null;
};

// Only persists this approver's decision — does not touch the agreement's
// status. Advancing the agreement (and notifying the next approver in a
// sequential chain) is the caller's job, since only the caller knows
// whether this was the last approver in the batch.
export const decideApprovalRequest = async (id, decision, comment) => {
  const { error } = await supabase
    .from('approval_requests')
    .update({ status: decision, comment: (comment || '').trim(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

export const listAllApprovalRequests = async () => {
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
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

export const DEFAULT_REMINDER_DAYS = [30, 14, 7, 1];

// How many days before an agreement's end date the expiry-reminders cron
// job emails its creator — one row per tenant, defaults applied client-side
// when the tenant hasn't customized it yet.
export const getReminderSettings = async () => {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from('tenant_settings')
    .select('reminder_days')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.reminder_days) && data.reminder_days.length > 0 ? data.reminder_days : DEFAULT_REMINDER_DAYS;
};

export const updateReminderSettings = async (reminderDays) => {
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from('tenant_settings')
    .upsert({ tenant_id: tenantId, reminder_days: reminderDays, updated_at: new Date().toISOString() });
  if (error) throw error;
};

export const SIGNATURES_INCLUDED_PER_USER = 10;
export const SIGNATURE_OVERAGE_PRICE = 2;

export const getSignatureUsageThisMonth = async () => {
  const [agreements, users] = await Promise.all([listAgreements(), listUsers()]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let used = 0;
  agreements.forEach((a) => {
    (a.docusignEnvelopes || []).forEach((env) => {
      const sentAt = env.sentAt ? new Date(env.sentAt) : null;
      if (sentAt && sentAt >= monthStart) used += 1;
    });
  });

  const activeUsers = users.filter((u) => u.isActive).length;
  const included = activeUsers * SIGNATURES_INCLUDED_PER_USER;
  const over = Math.max(0, used - included);

  return {
    used,
    included,
    activeUsers,
    over,
    overageCost: over * SIGNATURE_OVERAGE_PRICE,
  };
};

export const listClauseLibrary = async () => {
  const { data, error } = await supabase
    .from('clause_library')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category || '',
    body: c.body,
    language: c.language || 'English',
    createdBy: c.created_by,
    createdAt: c.created_at,
  }));
};

export const createClause = async (clause) => {
  const tenantId = await getCurrentTenantId();
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('clause_library')
    .insert({
      tenant_id: tenantId,
      title: clause.title,
      category: clause.category || '',
      body: clause.body,
      language: clause.language || 'English',
      created_by: user?.email || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteClause = async (id) => {
  const { error } = await supabase.from('clause_library').delete().eq('id', id);
  if (error) throw error;
};