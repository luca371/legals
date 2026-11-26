import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { TASK_TYPES } from '../aiFeatures';
import { listTasks, createTasks, updateTask, deleteTask, listAgreements, getCurrentUser, getCalendarFeedUrl } from '../supabase';
import './TasksScreen.css';

const TYPE_LABELS = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t.label]));
const EMPTY_FORM = { title: '', taskType: 'other', dueDate: '', assigneeEmail: '', agreementId: '', details: '' };

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function groupOf(task, today) {
  if (!task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= addDays(today, 7)) return 'week';
  return 'later';
}

const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
];

// Reviews, approvals, signatures, renewals and obligation follow-ups, with due
// dates. Open tasks due by tomorrow are emailed to the assignee (or the
// creator) by the daily reminder job.
function TasksScreen() {
  const { canWrite } = useAuth();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState('open');
  const [onlyMine, setOnlyMine] = useState(false);
  const [me, setMe] = useState('');
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [calendarUrl, setCalendarUrl] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setMe((u?.email || '').toLowerCase())).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listTasks({ status })
      .then((rows) => { if (!cancelled) setTasks(rows); })
      .catch((err) => {
        console.error('Failed to load tasks:', err);
        if (!cancelled) setError('Could not load the tasks.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  useEffect(() => {
    if (!showForm || agreements.length) return;
    listAgreements()
      .then((rows) => setAgreements(rows.map((a) => ({ id: a.id, title: a.title, accountId: a.accountId }))))
      .catch((err) => console.error('Failed to load agreements:', err));
  }, [showForm, agreements.length]);

  const visible = useMemo(
    () =>
      tasks.filter(
        (t) => !onlyMine || (t.assigneeEmail || '').toLowerCase() === me || (!t.assigneeEmail && (t.createdBy || '').toLowerCase() === me)
      ),
    [tasks, onlyMine, me]
  );

  const today = todayIso();
  const grouped = useMemo(() => {
    const map = {};
    visible.forEach((t) => {
      const g = status === 'open' ? groupOf(t, today) : 'all';
      (map[g] = map[g] || []).push(t);
    });
    return map;
  }, [visible, status, today]);

  const loadCalendarUrl = async (regenerate) => {
    if (regenerate && !(await confirm({
      title: 'Get a new calendar link',
      message: 'The old link stops working, so calendars subscribed to it stop updating. Subscribe again with the new one.',
      confirmLabel: 'Get new link',
    }))) return;
    setCalendarBusy(true);
    setCopied(false);
    try {
      setCalendarUrl(await getCalendarFeedUrl(regenerate));
    } catch (err) {
      console.error('Failed to get calendar link:', err);
      setError('Could not get your calendar link.');
    } finally {
      setCalendarBusy(false);
    }
  };

  const handleToggleCalendar = () => {
    const next = !showCalendar;
    setShowCalendar(next);
    if (next && !calendarUrl) loadCalendarUrl(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(calendarUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const openNew = () => {
    if (showForm && !editingId) {
      setShowForm(false);
      return;
    }
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  };

  const openEdit = (task) => {
    setEditingId(task.id);
    setForm({
      title: task.title,
      taskType: task.taskType || 'other',
      dueDate: task.dueDate || '',
      assigneeEmail: task.assigneeEmail || '',
      agreementId: task.agreementId || '',
      details: task.details || '',
    });
    setError('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (form.assigneeEmail.trim() && !/^\S+@\S+\.\S+$/.test(form.assigneeEmail.trim())) {
      setError('Enter a valid email for the assignee, or leave it empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const agreement = agreements.find((a) => a.id === form.agreementId);
      if (editingId) {
        const original = tasks.find((t) => t.id === editingId);
        const agreementChanged = (original?.agreementId || '') !== form.agreementId;
        const updates = {
          title: form.title.trim(),
          taskType: form.taskType,
          dueDate: form.dueDate,
          assigneeEmail: form.assigneeEmail,
          details: form.details,
          ...(agreementChanged ? { agreementId: form.agreementId, accountId: agreement?.accountId || null } : {}),
        };
        await updateTask(editingId, updates);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === editingId
              ? {
                  ...t,
                  ...updates,
                  assigneeEmail: form.assigneeEmail.trim(),
                  dueDate: form.dueDate || null,
                  ...(agreementChanged ? { agreementTitle: agreement?.title || '' } : {}),
                }
              : t
          )
        );
      } else {
        const [created] = await createTasks([{ ...form, title: form.title.trim(), accountId: agreement?.accountId || null }]);
        if (status !== 'done') setTasks((prev) => [created, ...prev]);
      }
      closeForm();
    } catch (err) {
      console.error('Failed to save task:', err);
      setError(editingId ? 'Could not save the task.' : 'Could not create the task.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDone = async (task) => {
    const next = task.status === 'done' ? 'open' : 'done';
    try {
      await updateTask(task.id, { status: next });
      setTasks((prev) =>
        status === 'all'
          ? prev.map((t) => (t.id === task.id ? { ...t, status: next } : t))
          : prev.filter((t) => t.id !== task.id)
      );
    } catch (err) {
      console.error('Failed to update task:', err);
      setError('Could not update the task.');
    }
  };

  const handleDelete = async (task) => {
    if (!(await confirm({ title: 'Delete task', message: `Delete "${task.title}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      console.error('Failed to delete task:', err);
      setError('Could not delete the task.');
    }
  };

  const renderTask = (t) => (
    <li key={t.id} className={`tsk__item ${t.status === 'done' ? 'tsk__item--done' : ''}`}>
      <input
        type="checkbox"
        className="tsk__check"
        checked={t.status === 'done'}
        onChange={() => handleToggleDone(t)}
        disabled={!canWrite}
        aria-label={t.status === 'done' ? 'Mark as open' : 'Mark as done'}
      />
      <div className="tsk__body">
        <div className="tsk__row">
          <span className="tsk__title">{t.title}</span>
          <span className={`tsk__type tsk__type--${t.taskType}`}>{TYPE_LABELS[t.taskType] || t.taskType}</span>
          {t.source === 'agent' && <span className="tsk__badge">From AI brief</span>}
        </div>
        {t.details && <p className="tsk__details">{t.details}</p>}
        <div className="tsk__meta">
          {t.dueDate && <span className={groupOf(t, today) === 'overdue' && t.status === 'open' ? 'tsk__overdue' : ''}>Due {t.dueDate}</span>}
          {t.assigneeEmail && <span>Assigned to {t.assigneeEmail}</span>}
          {t.agreementId && (
            <Link to={`/dashboard/agreements/${t.agreementId}`} className="tsk__link">
              {t.agreementTitle || 'Agreement'}
            </Link>
          )}
        </div>
      </div>
      {canWrite && (
        <div className="tsk__item-actions">
          <button type="button" className="tsk__edit" onClick={() => openEdit(t)}>
            Edit
          </button>
          <button type="button" className="tsk__delete" onClick={() => handleDelete(t)} aria-label="Delete task">
            ×
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="tsk">
      <div className="tsk__header">
        <div>
          <h2 className="tsk__heading">Tasks</h2>
          <p className="tsk__sub">Reviews, approvals, signatures, renewals and obligation follow-ups. Open tasks due by tomorrow are emailed to their assignee.</p>
        </div>
        <div className="tsk__header-actions">
          <button type="button" className="tsk__btn-secondary" onClick={handleToggleCalendar}>
            {showCalendar ? 'Hide calendar link' : 'Add to my calendar'}
          </button>
          {canWrite && (
            <button type="button" className="tsk__btn-primary" onClick={openNew}>
              {showForm && !editingId ? 'Cancel' : 'New task'}
            </button>
          )}
        </div>
      </div>

      {showCalendar && (
        <div className="tsk__form">
          <p className="tsk__cal-text">
            Subscribe to this link in Outlook (Add calendar &gt; Subscribe from web), Google Calendar (Other calendars &gt;
            From URL) or Apple Calendar. It shows your open tasks and the notice deadlines and end dates of your
            organization's agreements, and refreshes on its own. The link is personal: anyone who has it can see these
            dates, so do not share it.
          </p>
          <div className="tsk__cal-row">
            <input className="tsk__input tsk__cal-url" readOnly value={calendarBusy ? 'Loading…' : calendarUrl} onFocus={(e) => e.target.select()} />
            <button type="button" className="tsk__btn-primary" onClick={handleCopy} disabled={!calendarUrl || calendarBusy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="tsk__btn-secondary" onClick={() => loadCalendarUrl(true)} disabled={calendarBusy}>
              New link
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form className="tsk__form" onSubmit={handleSubmit}>
          {editingId && <h3 className="tsk__form-title">Edit task</h3>}
          <label className="tsk__label">
            Title
            <input className="tsk__input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          </label>
          <div className="tsk__grid">
            <label className="tsk__label">
              Type
              <select className="tsk__input" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="tsk__label">
              Due date
              <input type="date" className="tsk__input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </label>
            <label className="tsk__label">
              Assignee email
              <input className="tsk__input" placeholder="Leave empty for yourself" value={form.assigneeEmail} onChange={(e) => setForm({ ...form, assigneeEmail: e.target.value })} />
            </label>
            <label className="tsk__label">
              Agreement
              <select className="tsk__input" value={form.agreementId} onChange={(e) => setForm({ ...form, agreementId: e.target.value })}>
                <option value="">None</option>
                {agreements.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </label>
          </div>
          <label className="tsk__label">
            Details
            <textarea className="tsk__input tsk__textarea" rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
          </label>
          <div className="tsk__form-actions">
            {editingId && (
              <button type="button" className="tsk__btn-secondary" onClick={closeForm}>Cancel</button>
            )}
            <button type="submit" className="tsk__btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      )}

      <div className="tsk__filters">
        {['open', 'done', 'all'].map((s) => (
          <button key={s} type="button" className={`tsk__filter ${status === s ? 'tsk__filter--active' : ''}`} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : s === 'done' ? 'Done' : 'All'}
          </button>
        ))}
        <label className="tsk__mine">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only mine
        </label>
      </div>

      {error && <p className="tsk__error">{error}</p>}
      {loading && <p className="tsk__empty">Loading…</p>}
      {!loading && visible.length === 0 && <p className="tsk__empty">No tasks here.</p>}

      {!loading && status === 'open' &&
        GROUPS.filter((g) => grouped[g.key]?.length).map((g) => (
          <section key={g.key} className="tsk__group">
            <h3 className={`tsk__group-title ${g.key === 'overdue' ? 'tsk__overdue' : ''}`}>{g.label} · {grouped[g.key].length}</h3>
            <ul className="tsk__list">{grouped[g.key].map(renderTask)}</ul>
          </section>
        ))}
      {!loading && status !== 'open' && visible.length > 0 && <ul className="tsk__list">{visible.map(renderTask)}</ul>}
    </div>
  );
}

export default TasksScreen;
