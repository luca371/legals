import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import './ConfirmProvider.css';

// In-app replacement for window.confirm:
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete agreement', message: '...', confirmLabel: 'Delete', danger: true }))) return;
const ConfirmContext = createContext(() => Promise.resolve(false));

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const cancelRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        // A second call while one is open dismisses the first.
        setRequest((prev) => {
          if (prev) prev.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const settle = useCallback(
    (answer) => {
      if (!request) return;
      request.resolve(answer);
      setRequest(null);
    },
    [request],
  );

  useEffect(() => {
    if (!request) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    // Focus the safe choice, so a stray Enter never confirms a destructive action.
    cancelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [request, settle]);

  const options = request?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="confirm__backdrop" onClick={() => settle(false)}>
          <div
            className="confirm__card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title" className="confirm__title">{options.title}</h3>
            {options.message && <p id="confirm-message" className="confirm__message">{options.message}</p>}
            <div className="confirm__actions">
              <button ref={cancelRef} type="button" className="confirm__btn confirm__btn--secondary" onClick={() => settle(false)}>
                {options.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className={`confirm__btn ${options.danger ? 'confirm__btn--danger' : 'confirm__btn--primary'}`}
                onClick={() => settle(true)}
              >
                {options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
