import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ToastItem { id: number; kind: 'success' | 'error' | 'info'; message: string }
interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 1;
const recentMessages = new Map<string, number>();

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const key = `${kind}:${message}`;
    const now = Date.now();
    const previous = recentMessages.get(key) ?? 0;
    const cooldown = kind === 'error' ? 30000 : 8000;
    if (now - previous < cooldown) return;
    recentMessages.set(key, now);
    if (recentMessages.size > 200) {
      for (const [k, t] of recentMessages) if (now - t > 30000) recentMessages.delete(k);
    }
    const id = nextId++;
    setItems((prev) => [...prev.slice(-4), { id, kind, message }]);
    // Keep errors visible until explicitly dismissed so request IDs remain available.
    if (kind !== 'error') {
      window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500);
    }
  }, []);

  const success = useCallback((message: string) => push('success', message), [push]);
  const error = useCallback((message: string) => push('error', message), [push]);
  const info = useCallback((message: string) => push('info', message), [push]);
  const value = useMemo<ToastContextValue>(() => ({ success, error, info }), [success, error, info]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span aria-hidden="true">{t.kind === 'success' ? '✅' : t.kind === 'error' ? '⛔' : 'ℹ️'}</span>
            <span className="toast-message">{t.message}</span>
            {t.kind === 'error' ? (
              <button
                type="button"
                className="toast-dismiss"
                aria-label="بستن پیام خطا"
                onClick={() => setItems((prev) => prev.filter((item) => item.id !== t.id))}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside provider');
  return ctx;
}
