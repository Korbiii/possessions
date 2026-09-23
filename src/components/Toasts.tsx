import type { ReactNode } from 'react';
import { useApp } from '../state/AppState';

/** Transient status messages (analysis errors, export results, …). */
export function Toasts(): ReactNode {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
    </div>
  );
}
