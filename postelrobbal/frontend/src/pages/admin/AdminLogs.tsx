import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, EmptyState, Input, PageLoading, Pagination } from '../../components/ui';
import { faDateTime, faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { PAGE_SIZE, errText, type AuditRow } from './shared';

function toneForAction(action: string): 'danger' | 'warning' | 'success' | 'info' | 'muted' {
  if (/حذف|رد|لغو|خطا|مسدود/.test(action)) return 'danger';
  if (/تغییر|ویرایش|به‌روزرسانی|بروزرسانی/.test(action)) return 'warning';
  if (/ایجاد|افزودن|اتصال|موفق|فعال/.test(action)) return 'success';
  if (/ورود|مشاهده|گزارش/.test(action)) return 'info';
  return 'muted';
}

function glyphForAction(action: string): string {
  if (/حذف|رد|لغو/.test(action)) return '×';
  if (/ورود/.test(action)) return '↪';
  if (/اتصال/.test(action)) return '⌁';
  if (/پرداخت|مالی/.test(action)) return '₺';
  if (/قالب/.test(action)) return '▤';
  if (/کانال|ربات/.test(action)) return '◉';
  if (/تنظیم|ویرایش|تغییر|به‌روزرسانی|بروزرسانی/.test(action)) return '✦';
  return '•';
}

export default function AdminLogs() {
  const toast = useToast();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = async (nextPage: number) => {
    setLoading(true);
    try {
      const data = await api.get<{ items?: AuditRow[]; total?: number; page?: number }>(`/api/v1/admin/audit-logs?page=${nextPage}&pageSize=${PAGE_SIZE}`);
      setItems(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
    } catch (error) {
      toast.error(errText(error, 'دریافت گزارش رویداد ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(page); }, [page]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((audit) =>
      `${audit.actionFa ?? ''} ${audit.actorLabel ?? ''} ${audit.subjectTypeFa ?? ''} ${audit.subjectLabel ?? ''}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const admins = visible.filter((row) => row.actorRoleFa === 'مدیر ارشد' || row.actorRoleFa === 'پشتیبانی').length;
  const systems = visible.filter((row) => row.actorRoleFa === 'سامانه').length;
  const failures = visible.filter((row) => /حذف|رد|لغو|خطا|مسدود/.test(row.actionFa ?? '')).length;
  const latest = visible[0]?.createdAt ? faDateTime(visible[0].createdAt) : '—';

  return (
    <div className="adm-logs-page">
      <header className="adm-page-head adm-logs-hero">
        <div>
          <span className="adm-logs-eyebrow">AUDIT &amp; SECURITY</span>
          <h2>گزارش رویداد</h2>
          <p>خط زمانی دقیق عملیات مدیریتی، فعالیت سامانه و تغییرات حساس برای ممیزی و رهگیری سریع.</p>
        </div>
        <div className="adm-logs-hero-status"><span className="adm-logs-live-dot" /><div><strong>ثبت رویداد فعال</strong><small>آخرین رویداد: {latest}</small></div></div>
      </header>

      <section className="adm-logs-kpis" aria-label="خلاصه گزارش رویداد">
        <Card className="adm-logs-kpi"><span>کل رویدادهای صفحه</span><strong>{faNumber(visible.length)}</strong><small>از {faNumber(total)} رویداد</small></Card>
        <Card className="adm-logs-kpi adm-logs-kpi--admin"><span>مدیر و پشتیبانی</span><strong>{faNumber(admins)}</strong><small>عملیات انسانی</small></Card>
        <Card className="adm-logs-kpi adm-logs-kpi--system"><span>سامانه</span><strong>{faNumber(systems)}</strong><small>رویداد خودکار</small></Card>
        <Card className="adm-logs-kpi adm-logs-kpi--danger"><span>رویداد حساس</span><strong>{faNumber(failures)}</strong><small>نیازمند توجه</small></Card>
      </section>

      <Card className="adm-logs-shell">
        <div className="adm-logs-toolbar">
          <div><strong>خط زمانی فعالیت</strong><span>آخرین رویدادها به‌ترتیب زمان ثبت می‌شوند.</span></div>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی اقدام، کاربر یا موضوع…" aria-label="جست‌وجوی گزارش رویداد" />
        </div>

        {loading ? <PageLoading /> : visible.length === 0 ? (
          <EmptyState icon="⌁" title="رویدادی پیدا نشد" description="عبارت جست‌وجو را تغییر دهید یا با ثبت فعالیت جدید، گزارش را بررسی کنید." />
        ) : (
          <div className="adm-logs-timeline">
            {visible.map((audit, index) => {
              const action = audit.actionFa || 'رویداد سامانه';
              const tone = toneForAction(action);
              const actor = audit.actorLabel || 'سامانه';
              const role = audit.actorRoleFa || 'سامانه';
              const subject = audit.subjectTypeFa || '—';
              const subjectLabel = audit.subjectLabel && audit.subjectLabel !== '—' ? audit.subjectLabel : '';
              return (
                <article key={audit.id} className={`adm-logs-event adm-logs-event--${tone}`}>
                  <div className="adm-logs-event__rail" aria-hidden="true"><span>{glyphForAction(action)}</span>{index < visible.length - 1 ? <i /> : null}</div>
                  <div className="adm-logs-event__body">
                    <div className="adm-logs-event__head">
                      <div><strong>{action}</strong><span>{subject}{subjectLabel ? ` · ${subjectLabel}` : ''}</span></div>
                      <time>{faDateTime(audit.createdAt)}</time>
                    </div>
                    <div className="adm-logs-event__meta">
                      <span className="adm-logs-actor">{actor}</span>
                      <Badge tone={role === 'مدیر ارشد' || role === 'پشتیبانی' ? 'brand' : role === 'سامانه' ? 'info' : 'muted'}>{role}</Badge>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </Card>
    </div>
  );
}
