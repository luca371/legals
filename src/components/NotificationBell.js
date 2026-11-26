import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listNotifications, countUnreadNotifications, markNotificationsRead } from '../supabase';
import './NotificationBell.css';

const POLL_MS = 60_000;

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Bell in the top bar: tasks assigned or due, approvals and reviews answered,
// agreements signed, notice deadlines, the weekly digest. Checks every minute.
function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  const refreshCount = useCallback(() => {
    countUnreadNotifications().then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshCount();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    try {
      setItems(await listNotifications());
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = async (n) => {
    setOpen(false);
    if (!n.readAt) {
      markNotificationsRead([n.id]).then(refreshCount).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    if (n.link && n.link.startsWith('/')) navigate(n.link);
  };

  const handleReadAll = async () => {
    try {
      await markNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
      setUnread(0);
    } catch (err) {
      console.error('Failed to mark notifications read:', err);
    }
  };

  return (
    <div className="ntf" ref={boxRef}>
      <button type="button" className="ntf__bell" onClick={handleOpen} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 9.5a6 6 0 1 1 12 0c0 4.5 1.8 6 1.8 6H4.2S6 14 6 9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="ntf__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="ntf__panel" role="dialog" aria-label="Notifications">
          <div className="ntf__head">
            <span className="ntf__title">Notifications</span>
            {unread > 0 && (
              <button type="button" className="ntf__readall" onClick={handleReadAll}>Mark all read</button>
            )}
          </div>
          {loading && <p className="ntf__empty">Loading…</p>}
          {!loading && items.length === 0 && <p className="ntf__empty">Nothing yet.</p>}
          {!loading && items.length > 0 && (
            <ul className="ntf__list">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`ntf__item ${n.readAt ? '' : 'ntf__item--unread'}`} onClick={() => handleClick(n)}>
                    <span className="ntf__item-title">{n.title}</span>
                    {n.body && <span className="ntf__item-body">{n.body}</span>}
                    <span className="ntf__item-time">{timeAgo(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
