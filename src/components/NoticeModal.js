import { useEffect } from 'react';
import './NoticeModal.css';

// Centered popup for the outcome of an action. notice = { type: 'success' | 'error', title, message, stats? }
// stats is an optional list of { label, value } shown as big numbers (e.g. sync results).
function NoticeModal({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notice, onClose]);

  if (!notice) return null;
  const isSuccess = notice.type === 'success';

  return (
    <div className="notice__backdrop" onClick={onClose}>
      <div
        className={`notice__card notice__card--${isSuccess ? 'success' : 'error'}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="notice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="notice__icon">
          <svg viewBox="0 0 52 52" aria-hidden="true">
            <circle className="notice__circle" cx="26" cy="26" r="24" fill="none" />
            {isSuccess ? (
              <path className="notice__mark" fill="none" d="M14 27l8 8 16-17" />
            ) : (
              <path className="notice__mark" fill="none" d="M18 18l16 16M34 18L18 34" />
            )}
          </svg>
        </div>
        <h3 id="notice-title" className="notice__title">{notice.title}</h3>
        {notice.stats && notice.stats.length > 0 && (
          <div className="notice__stats">
            {notice.stats.map((s) => (
              <div key={s.label} className="notice__stat">
                <span className="notice__stat-value">{s.value}</span>
                <span className="notice__stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {notice.message && <p className="notice__message">{notice.message}</p>}
        <button type="button" className="notice__btn" onClick={onClose} autoFocus>
          {isSuccess ? 'Done' : 'Close'}
        </button>
      </div>
    </div>
  );
}

export default NoticeModal;
