import { useEffect, useState } from 'react';
import { faDateLong, faTime } from '../lib/format';


/**
 * Shared topbar clock chip (round 18-b) — rendered by the user dashboard
 * shell (Layout.tsx) AND the admin shell (AdminLayout.tsx) for parity.
 * Markup/classes (.dash-clock* from shell.css) and the 15s refresh interval
 * are unchanged from the original local definition in Layout.tsx; only the
 * date part differs: faDateLong() assembles the parts manually so the chip
 * reads «شنبه، ۲۸ شهریور ۱۴۰۵ - ۱۹:۱۱» (weekday، day month year) instead of
 * Intl's raw part order «۱۴۰۵ شهریور ۲۸, شنبه». Always 24-hour, never AM/PM.
 */
export function ClockChip() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="dash-clock" title="تاریخ و ساعت — تقویم شمسی، ساعت ۲۴ ساعته">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" />
        <path d="M12 7.6V12l3 2" />
      </svg>
      <span className="dash-clock__date">{faDateLong(now)}</span>
      <span className="dash-clock__sep" aria-hidden="true">-</span>
      <span className="dash-clock__time">{faTime(now)}</span>
    </span>
  );
}
