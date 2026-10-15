import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { faDigits, faMoney, faRelative } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Admin bell (round 18-b): notification button for the admin topbar.  */
/* Polls GET /api/v1/admin/notifications/bell (on mount + every 60s +  */
/* on route change), renders a red unread pill, and opens a popup      */
/* listing pending payments / open support tickets / new users with    */
/* deep links. Opening the popup fires POST .../bell/seen — on success */
/* the badge zeroes immediately while the snapshot lists stay visible  */
/* (marked as seen), so seen items never badge again. The backend may  */
/* 404 until the parallel round-18 build lands: every error is         */
/* swallowed and the bell degrades to a badge-less button.             */
/* ------------------------------------------------------------------ */

interface BellEntry {
  id: string;
  title: string;
  sub: string;
  amountRial?: number;
  createdAt: string | null;
}

interface BellSection {
  count: number;
  unread: number;
  latest: BellEntry[];
}

/** Shape of GET /api/v1/admin/notifications/bell → { success, data }. */
interface AdminBellData {
  lastSeenAt: string | null;
  pendingPayments: BellSection;
  openTickets: BellSection;
  newUsers: BellSection;
  unreadTotal: number;
}

const BELL_PATH = '/api/v1/admin/notifications/bell';
const SEEN_PATH = '/api/v1/admin/notifications/bell/seen';

export function AdminBell() {
  const location = useLocation();
  const [data, setData] = useState<AdminBellData | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get<AdminBellData>(BELL_PATH)
      .then((d) => setData(d))
      .catch(() => undefined); // 404/until-backend: degrade silently
  }, []);

  // Poll: on mount + on every route change...
  useEffect(() => { load(); }, [load, location.pathname]);
  // ...and every 60s.
  useEffect(() => {
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, [load]);

  // Close automatically on route change (same discipline as the user shell).
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Outside mousedown + Escape close the popup (Layout.tsx popover rules).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.adm-bell-wrap')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening the popup marks everything seen server-side; on success the
  // badge is zeroed at once while the snapshot lists stay on screen. On
  // failure the badge stays (user requirement: seen items don't re-badge).
  const toggle = useCallback(() => {
    if (!open) {
      api.post<{ lastSeenAt: string }>(SEEN_PATH)
        .then(() => setData((prev) => (prev ? { ...prev, unreadTotal: 0 } : prev)))
        .catch(() => undefined);
    }
    setOpen((v) => !v);
  }, [open]);

  const unread = data?.unreadTotal ?? 0;
  const badge = unread > 99 ? faDigits('۹۹+') : faDigits(unread);
  const bellLabel = unread > 0
    ? `اعلان‌های مدیریتی، ${badge} مورد جدید`
    : 'اعلان‌های مدیریتی';

  const sections: Array<{ key: string; sec: BellSection; title: string; to: string }> = data
    ? [
      { key: 'payments', sec: data.pendingPayments, title: 'فیش‌های واریزی در انتظار تأیید', to: '/dashboard/admin/payments' },
      { key: 'tickets', sec: data.openTickets, title: 'تیکت‌های پشتیبانی باز', to: '/dashboard/admin/tickets' },
      { key: 'users', sec: data.newUsers, title: 'کاربران جدید (۷ روز اخیر)', to: '/dashboard/admin/users' },
    ]
    : [];

  const allSeen = Boolean(data)
    && unread === 0
    && sections.every(({ sec }) => sec.count === 0);

  return (
    <div className="adm-bell-wrap">
      <button
        type="button"
        className="adm-bell"
        onClick={toggle}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="adm-bell__badge">{badge}</span>}
      </button>

      {open && (
        <div className="adm-pop" role="dialog" aria-label="اعلان‌های مدیریتی">
          <div className="adm-pop__head">
            <strong>🔔 اعلان‌های مدیریتی</strong>
            <span>{data ? (unread > 0 ? `${faDigits(unread)} مورد جدید` : 'همه بررسی شده') : ''}</span>
          </div>

          {!data ? (
            <p className="adm-pop__empty">در حال دریافت…</p>
          ) : allSeen ? (
            <p className="adm-pop__empty">همه موارد بررسی شده است ✔</p>
          ) : (
            <>
              {sections.map(({ key, sec, title, to }) => (
                sec.count > 0 ? (
                  <div className="adm-pop__section" key={key}>
                    <div className="adm-pop__section-title">
                      <span>{title}</span>
                      <span className="adm-pop__count">{faDigits(sec.count)}</span>
                    </div>
                    {sec.latest.map((item) => (
                      <Link
                        key={item.id}
                        to={to}
                        className="adm-pop__item"
                        onClick={() => setOpen(false)}
                      >
                        <span className="adm-pop__row">
                          <strong>{item.title}</strong>
                          <span className="adm-pop__time">{faRelative(item.createdAt)}</span>
                        </span>
                        <span className="adm-pop__sub" dir="ltr">{item.sub}</span>
                        {typeof item.amountRial === 'number' && (
                          <span className="adm-pop__amount">{faMoney(item.amountRial)}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                ) : null
              ))}
              <Link to="/dashboard/admin" className="adm-pop__more" onClick={() => setOpen(false)}>
                مشاهده همه در پنل مدیریت
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
