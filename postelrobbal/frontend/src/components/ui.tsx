import { forwardRef, type ReactNode, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, useEffect, useRef } from 'react';
import { faDigits } from '../lib/format';

export function Button({ variant = 'primary', size, block, loading, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'soft';
  size?: 'sm' | 'lg';
  block?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''} ${className}`}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading && <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: 'currentColor', borderColor: 'rgba(255,255,255,0.35)' }} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', pad, style }: { children: ReactNode; className?: string; pad?: 'lg'; style?: CSSProperties }) {
  return <div className={`card${pad === 'lg' ? ' card-pad-lg' : ''} ${className}`} style={style}>{children}</div>;
}

export function Field({ label, error, hint, children, required }: { label: string; error?: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Input({ error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input className={`input${error ? ' input-error' : ''} ${className}`} {...rest} />;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`textarea ${className}`} rows={5} style={{ minHeight: 120, resize: 'vertical' }} {...rest} />;
});

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="select" {...rest}>
      {children}
    </select>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'success' | 'danger' | 'warning' | 'info' | 'brand' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner${large ? ' spinner-lg' : ''}`} role="status" aria-label="در حال بارگذاری" />;
}

export function PageLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <Spinner large />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatCard({ icon, bg, value, label }: { icon: string; bg: string; value: ReactNode; label: string }) {
  return (
    <Card className="stat-card">
      <div className="stat-icon" style={{ background: bg }} aria-hidden="true">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </Card>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const nums: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <nav className="pagination" aria-label="صفحه‌بندی">
      <button className="page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="صفحهٔ قبل">‹</button>
      {nums.map((n) => (
        <button key={n} className={`page-btn${n === page ? ' active' : ''}`} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>
          {faDigits(n)}
        </button>
      ))}
      <button className="page-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="صفحهٔ بعد">›</button>
    </nav>
  );
}

export function Modal({ open, onClose, title, children, large }: { open: boolean; onClose: () => void; title: string; children: ReactNode; large?: boolean }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className={`modal${large ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="بستن">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p style={{ color: 'var(--text-2)', marginBottom: 20 }}>{message}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>تأیید</Button>
        <Button variant="ghost" onClick={onClose}>انصراف</Button>
      </div>
    </Modal>
  );
}

export function StatusBadge({ state, labels }: { state: string; labels: Record<string, string> }) {
  const toneMap: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'brand' | 'muted'> = {
    SENT: 'success', PUBLISHED: 'success', ACTIVE: 'success', COMPLETED: 'success', VERIFIED: 'success', ANSWERED: 'success',
    FAILED: 'danger', ERROR: 'danger', CANCELLED: 'muted',
    RETRYING: 'warning', PUBLISHING: 'warning', PENDING: 'warning', QUEUED: 'warning', SCHEDULED: 'info', PROCESSING: 'info',
    PENDING_VERIFY: 'warning', OPEN: 'warning',
    DRAFT: 'muted', DISABLED: 'muted', CLOSED: 'muted', EXPIRED: 'muted',
    PARTIAL: 'warning',
  };
  return <Badge tone={toneMap[state] ?? 'muted'}>{labels[state] ?? 'وضعیت نامشخص'}</Badge>;
}
