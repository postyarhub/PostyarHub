import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PageLoading } from '../components/ui';
import { NavIcon } from '../components/icons';
import { ADMIN_SECTIONS } from '../pages/admin/shared';
import { useToast } from '../lib/toast';
import { ClockChip } from '../components/ClockChip';
import { AdminBell } from '../components/AdminBell';
import '../styles/admin.css';

/* ------------------------------------------------------------------ */
/* Admin shell (Tasks 16-b + 17-b): a COMPLETE standalone RTL app      */
/* shell mounted at /dashboard/admin (top-level route — no longer      */
/* nested inside DashboardLayout, so the user sidebar never renders    */
/* alongside it). Own topbar, own grouped sidebar (≥1024px), own       */
/* off-canvas drawer (<1024px), own footer.                            */
/* ------------------------------------------------------------------ */

function AdminNav() {
  return (
    <>
      {ADMIN_SECTIONS.map((g) => (
        <div className="adm-group" key={g.group}>
          <div className="adm-group__title">{g.group}</div>
          {g.items.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.end}
              className={({ isActive }) => `adm-nav__item${isActive ? ' is-active' : ''}`}
              title={s.label}
            >
              <NavIcon name={s.icon} size={19} />
              <span className="adm-nav__label">{s.label}</span>
              <span className="adm-nav__short">{s.short}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

export default function AdminLayout() {
  const { loading, me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the drawer on route change (nav inside the drawer included).
  useEffect(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
      setDrawerClosing(true);
      window.setTimeout(() => setDrawerClosing(false), 280);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const closeDrawer = useCallback(() => {
    if (!drawerOpen) return;
    setDrawerOpen(false);
    setDrawerClosing(true);
    window.setTimeout(() => setDrawerClosing(false), 280);
  }, [drawerOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  // Lock body scroll while the drawer is open + focus its first nav item.
  useEffect(() => {
    if (!drawerOpen) return;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLAnchorElement>('a, button')?.focus();
    }, 80);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(t);
    };
  }, [drawerOpen]);

  if (loading) return <PageLoading />;
  if (!me) return <Navigate to="/?auth=login" replace />;

  const role = me.user.role;
  if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT') {
    return <Navigate to="/dashboard" replace />;
  }

  const drawerVisible = drawerOpen || drawerClosing;

  return (
    <div className="adm-root">
      <header className="adm-topbar">
        <div className="adm-topbar__id">
          <button
            type="button"
            className="adm-burger"
            aria-label="منوی مدیریت"
            aria-expanded={drawerOpen}
            aria-controls="adm-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <span className="adm-topbar__badge" aria-hidden="true">
            <NavIcon name="admin" size={22} />
          </span>
          <div className="adm-topbar__head">
            <h1 className="adm-topbar__title">پنل مدیریت پُست‌یار</h1>
            <p className="adm-topbar__sub">
              {role === 'SUPER_ADMIN' ? 'دسترسی کامل مدیریتی' : 'دسترسی پشتیبانی'} — {me.user.firstName} {me.user.lastName}
            </p>
          </div>
        </div>
        <div className="adm-topbar__actions">
          {/* Topbar clock chip (round 18-b) — parity with the user dashboard. */}
          <ClockChip />
          {/* Switch between admin panel and the user dashboard, both ways. */}
          <Link to="/dashboard" className="btn btn-soft btn-sm adm-topbar__back" aria-label="بازگشت به پیشخوان کاربری">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 10.5 12 3.5l8.5 7" />
              <path d="M5.5 9.6V20h13V9.6" />
              <path d="M9.5 20v-6h5v6" />
            </svg>
            <span className="adm-topbar__back-text">بازگشت به پیشخوان</span>
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm adm-topbar__logout"
            onClick={() => void logout().then(() => { toast.success('با موفقیت خارج شدید.'); navigate('/'); })}
          >
            خروج
          </button>
          {/* Admin bell (round 18-b): pending payments / open tickets / new
              users — leftmost action in the RTL row, so its popup anchors
              inline-start (left:0) without overflowing the viewport. */}
          <AdminBell />
        </div>
      </header>

      <div className="adm-body">
        <aside className="adm-sidebar">
          <nav className="adm-nav" aria-label="بخش‌های پنل مدیریت">
            <AdminNav />
          </nav>
        </aside>

        <main className="adm-main">
          <Outlet />
        </main>
      </div>

      <footer className="adm-footer">پُست‌یار — پنل مدیریت</footer>

      {/* Off-canvas navigation drawer (<1024px): slides in from the right (RTL) */}
      {drawerVisible && (
        <div className={`adm-drawer${drawerOpen ? ' is-open' : ''}`}>
          <div className="adm-drawer__backdrop" onClick={closeDrawer} aria-hidden="true" />
          <div
            className="adm-drawer__panel"
            id="adm-drawer"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="منوی مدیریت"
          >
            <div className="adm-drawer__head">
              <strong>منوی مدیریت</strong>
              <button type="button" className="adm-drawer__close" onClick={closeDrawer} aria-label="بستن منو">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav className="adm-drawer__nav" aria-label="بخش‌های پنل مدیریت">
              <AdminNav />
            </nav>
            <div className="adm-drawer__foot">
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => { closeDrawer(); void logout().then(() => { toast.success('با موفقیت خارج شدید.'); navigate('/'); }); }}
              >
                خروج از حساب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
