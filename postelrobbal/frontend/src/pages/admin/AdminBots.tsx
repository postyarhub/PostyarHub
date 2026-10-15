import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, EmptyState, Input, PageLoading, Pagination, StatusBadge } from '../../components/ui';
import { PLATFORM_FA, faDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { BOT_MODE_FA, BOT_STATUS_FA, PAGE_SIZE, PlatformIcon, errText, type AdminBotRow } from './shared';

/* ------------------------------------------------------------------ */
/* ربات‌ها — platform filter + search across all user bots.            */
/* No token is ever displayed here (Task 16-b).                        */
/* ------------------------------------------------------------------ */

const PLATFORM_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'همه' },
  { key: 'telegram', label: 'تلگرام' },
  { key: 'bale', label: 'بله' },
  { key: 'rubika', label: 'روبیکا' },
];

export default function AdminBots() {
  const toast = useToast();

  const [items, setItems] = useState<AdminBotRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  const loadBots = async (p: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (platform) q.set('platform', platform);
      if (search) q.set('search', search);
      const d = await api.get<{ items?: AdminBotRow[]; total?: number; page?: number }>(`/api/v1/admin/bots?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت ربات‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void loadBots(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, platform]);

  return (
    <>
      <div className="adm-page-head">
        <h2>ربات‌ها</h2>
        <p>همهٔ ربات‌های متصل کاربران در هر سه پلتفرم</p>
      </div>

      <Card>
        <div className="adm-filters">
          <div className="adm-filters__chips" role="group" aria-label="فیلتر پلتفرم">
            {PLATFORM_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`adm-chip${platform === f.key ? ' is-active' : ''}`}
                onClick={() => { setPlatform(f.key); setPage(1); }}
              >
                {f.key && <PlatformIcon platform={f.key} size={17} />}
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جستجو: نام کاربری، عنوان یا مالک…"
              aria-label="جستجوی ربات"
            />
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="🤖" title="رباتی پیدا نشد" description="با تغییر پلتفرم یا عبارت جستجو دوباره بررسی کنید." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th>پلتفرم</th>
                    <th>شناسهٔ کاربری</th>
                    <th>عنوان</th>
                    <th>حالت اتصال</th>
                    <th>هوش مصنوعی</th>
                    <th>وضعیت</th>
                    <th>مالک</th>
                    <th>تاریخ اتصال</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id}>
                      <td data-label="پلتفرم"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlatformIcon platform={b.platform} size={20} />{PLATFORM_FA[b.platform] ?? 'پلتفرم نامشخص'}</span></td>
                      <td data-label="شناسهٔ کاربری" dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{b.username || '—'}</td>
                      <td data-label="عنوان" style={{ fontWeight: 600 }}>{b.title || '—'}</td>
                      <td data-label="حالت اتصال"><Badge tone={b.mode === 'WEBHOOK' ? 'info' : 'brand'}>{BOT_MODE_FA[b.mode ?? ''] ?? b.mode}</Badge></td>
                      <td data-label="هوش مصنوعی">{b.aiEnabled ? <Badge tone="success">فعال</Badge> : <Badge tone="muted">غیرفعال</Badge>}</td>
                      <td data-label="وضعیت"><StatusBadge state={b.status ?? ''} labels={BOT_STATUS_FA} /></td>
                      <td data-label="مالک" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{b.ownerEmail || '—'}</td>
                      <td data-label="تاریخ اتصال">{faDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>
    </>
  );
}
