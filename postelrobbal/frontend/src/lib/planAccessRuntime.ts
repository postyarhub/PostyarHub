import { onRouteChange } from './routeEvents';
/**
 * Runtime entitlement guard.
 *
 * This is deliberately dependency-free so it can be loaded from the existing
 * production SPA bundle without another build artifact. The backend remains
 * authoritative; this layer controls navigation and gives a clear upgrade
 * path before restricted pages are used.
 */

type PlanData = {
  code?: string;
  nameFa?: string;
  limits?: { max_bots?: number; ai_monthly?: number };
  features?: { auto_responder?: boolean; woocommerce?: boolean; gold_ticker?: boolean; wordpress_campaigns?: boolean; content_summarization?: boolean };
};

type Rule = { test: (path: string) => boolean; allowed: (plan: PlanData) => boolean; label: string };

const RULES: Rule[] = [
  { test: (p) => p === '/dashboard/bots' || p.startsWith('/dashboard/bots/'), allowed: (x) => Number(x.limits?.max_bots ?? 0) > 0, label: 'ربات‌ها' },
  { test: (p) => p === '/dashboard/workflows' || p.startsWith('/dashboard/workflows/'), allowed: (x) => x.features?.auto_responder === true, label: 'گردش‌کار و پاسخ‌گوی خودکار' },
  { test: (p) => p === '/dashboard/ai' || p.startsWith('/dashboard/ai/'), allowed: (x) => Number(x.limits?.ai_monthly ?? 0) > 0, label: 'هوش مصنوعی' },
  { test: (p) => p === '/dashboard/woocommerce' || p.startsWith('/dashboard/woocommerce/'), allowed: (x) => x.features?.woocommerce === true, label: 'وب‌سایت' },
  { test: (p) => p === '/dashboard/campaigns' || p.startsWith('/dashboard/campaigns/'), allowed: (x) => x.features?.woocommerce === true && (x.features?.wordpress_campaigns === true || x.features?.wordpress_campaigns === undefined), label: 'کمپین‌ها' },
  { test: (p) => p === '/dashboard/gold' || p.startsWith('/dashboard/gold/'), allowed: (x) => x.features?.gold_ticker === true, label: 'ربات نرخ طلا و سکه' },
];

let cachedPlan: PlanData | null = null;
let checking = false;

function dashboardPath(): boolean {
  const p = window.location.pathname;
  return /^\/dashboard(?:\/|$)/.test(p) && !/^\/dashboard\/admin(?:\/|$)/.test(p);
}

function ruleFor(path: string): Rule | null {
  return RULES.find((r) => r.test(path)) ?? null;
}

function ensureStyle(): void {
  if (document.getElementById('postyar-plan-guard-style')) return;
  const style = document.createElement('style');
  style.id = 'postyar-plan-guard-style';
  style.textContent = `
#postyar-plan-guard{position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;padding:18px;background:rgba(20,16,28,.38);backdrop-filter:blur(5px)}
#postyar-plan-guard .pg-card{width:min(460px,100%);background:#fff;border:1px solid rgba(94,72,130,.14);border-radius:22px;padding:24px;box-shadow:0 30px 110px rgba(20,12,34,.26);direction:rtl;text-align:right}
#postyar-plan-guard .pg-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;background:#f3edff;font-size:24px;margin-bottom:12px}
#postyar-plan-guard h2{margin:0 0 8px;font-size:18px;color:#251d30}
#postyar-plan-guard p{margin:0;color:#695e72;font-size:13px;line-height:2}
#postyar-plan-guard .pg-actions{display:flex;gap:8px;margin-top:18px}
#postyar-plan-guard a{flex:1;text-decoration:none;text-align:center;border-radius:11px;padding:10px 12px;font:inherit;font-size:13px;font-weight:800}
#postyar-plan-guard .pg-up{background:#6d28d9;color:#fff}.pg-back{border:1px solid #e4deea;color:#51465c;background:#fff}
.postyar-plan-hidden{display:none!important}
`;
  document.head.appendChild(style);
}

/* POSTYAR-SECURITY-FRONTEND-SINK-HARDENING-R1-20261014: dynamic plan text is inserted with textContent, never HTML parsing. */
function showGuard(title: string, body: string, canUpgrade = true): void {
  ensureStyle();
  const existing = document.getElementById('postyar-plan-guard');
  if (existing) return;
  const root = document.createElement('div');
  root.id = 'postyar-plan-guard';
  const card = document.createElement('div');
  card.className = 'pg-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'postyar-plan-guard-title');
  const icon = document.createElement('div');
  icon.className = 'pg-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔒';
  const heading = document.createElement('h2');
  heading.id = 'postyar-plan-guard-title';
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = body;
  const actions = document.createElement('div');
  actions.className = 'pg-actions';
  if (canUpgrade) {
    const upgrade = document.createElement('a');
    upgrade.className = 'pg-up';
    upgrade.href = '/dashboard/subscription';
    upgrade.textContent = 'ارتقای اشتراک';
    actions.appendChild(upgrade);
  }
  const back = document.createElement('a');
  back.className = 'pg-back';
  back.href = '/dashboard';
  back.textContent = 'بازگشت به داشبورد';
  actions.appendChild(back);
  card.append(icon, heading, paragraph, actions);
  root.appendChild(card);
  document.body.appendChild(root);
}
function clearGuard(): void {
  document.getElementById('postyar-plan-guard')?.remove();
}

function navTarget(el: Element): string {
  const href = el.getAttribute('href') ?? (el.querySelector('a')?.getAttribute('href') ?? '');
  try { return new URL(href, window.location.origin).pathname; } catch { return href; }
}

function applyNavigation(): void {
  document.querySelectorAll<HTMLElement>('.dash-nav__item,.dash-sheet__item').forEach((item) => {
    const target = navTarget(item);
    const rule = ruleFor(target);
    item.classList.remove('postyar-plan-hidden');
    // Fail closed while the plan is unknown; ordinary destinations remain visible.
    if (rule && (!cachedPlan || !rule.allowed(cachedPlan))) item.classList.add('postyar-plan-hidden');
  });
}

function enforceRoute(): void {
  if (!dashboardPath() || !cachedPlan) return;
  const rule = ruleFor(window.location.pathname);
  if (!rule) { clearGuard(); return; }
  if (rule.allowed(cachedPlan)) clearGuard();
  else showGuard(`این قابلیت در پلن «${cachedPlan.nameFa ?? 'فعلی'}» فعال نیست`, `برای دسترسی به «${rule.label}»، اشتراک خود را ارتقا دهید.`);
}

function enforceUnknownRoute(): void {
  if (!dashboardPath() || cachedPlan) return;
  const path = window.location.pathname;
  if (!ruleFor(path)) return;
  showGuard('بررسی دسترسی انجام نشد', 'امکان بررسی پلن فعلی وجود ندارد. برای حفظ امنیت، دسترسی این قابلیت موقتاً مسدود شده است.');
}

async function fetchPlan(): Promise<PlanData | null> {
  try {
    const res = await fetch('/api/v1/subscriptions/current', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (res.status === 401) {
      window.location.assign('/?auth=login');
      return null;
    }
    if (!res.ok) return null;
    const payload = await res.json() as { data?: { plan?: PlanData } };
    return payload.data?.plan ?? null;
  } catch {
    return null;
  }
}

async function check(): Promise<void> {
  if (checking || !dashboardPath()) return;
  checking = true;
  try {
    cachedPlan = await fetchPlan();
    // Navigation is fail-closed for restricted capabilities until a valid plan is known.
    applyNavigation();
    if (cachedPlan) {
      enforceRoute();
      watchNavigation();
    } else {
      enforceUnknownRoute();
    }
  } finally {
    checking = false;
  }
}

function watchNavigation(): void {
  onRouteChange(() => {
    if (!dashboardPath()) {
      clearGuard();
      return;
    }
    applyNavigation();
    enforceRoute();
  });
}

/** Also corrects stale lazy chunks that still contain the old Zarinpal label. */
async function repairGatewayLabel(): Promise<void> {
  if (window.location.pathname !== '/dashboard/subscription') return;
  try {
    const res = await fetch('/api/v1/payments/methods', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const payload = await res.json() as { data?: { provider?: string } };
    const labels: Record<string, string> = { zibal: 'زیبال', zarinpal: 'زرین‌پال', idpay: 'آیدی‌پی', winapay: 'ویناپی' };
    const label = labels[payload.data?.provider ?? ''] ?? 'درگاه آنلاین';
    const rewrite = () => {
      document.querySelectorAll<HTMLElement>('.pay-option__desc').forEach((el) => {
        const text = el.textContent ?? '';
        if (!text.includes('انتقال امن به درگاه')) return;
        el.textContent = `انتقال امن به درگاه ${label}؛ فعال‌سازی بلافاصله پس از پرداخت`;
      });
    };
    rewrite();
    [250, 750, 1500, 3000].forEach((delay) => {
      window.setTimeout(rewrite, delay);
    });
  } catch {
    // Cosmetic repair only; the authoritative payment provider is server-side.
  }
}

function start(): void {
  if (!dashboardPath() || window.location.pathname.startsWith('/dashboard/admin')) return;
  if ((window as Window & { __POSTYAR_PLAN_RUNTIME_V2?: boolean }).__POSTYAR_PLAN_RUNTIME_V2) return;
  (window as Window & { __POSTYAR_PLAN_RUNTIME_V2?: boolean }).__POSTYAR_PLAN_RUNTIME_V2 = true;
  void check();
  void repairGatewayLabel();
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
