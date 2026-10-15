import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatusBadge } from '../../components/ui';
import { PLATFORM_FA, faDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { CHANNEL_STATUS_FA, PAGE_SIZE, PlatformIcon, errText, type AdminChannelRow } from './shared';

/* ------------------------------------------------------------------ */
/* کانال‌ها — platform filter, search, registry release (Task 16-b).   */
/* ------------------------------------------------------------------ */

const PLATFORM_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'همه' },
  { key: 'telegram', label: 'تلگرام' },
  { key: 'bale', label: 'بله' },
  { key: 'rubika', label: 'روبیکا' },
];

export default function AdminChannels() {
  const toast = useToast();

  const [items, setItems] = useState<AdminChannelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  // registry release modal
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releasePlatform, setReleasePlatform] = useState('telegram');
  const [releaseRef, setReleaseRef] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);

  const loadChannels = async (p: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (platform) q.set('platform', platform);
      if (search) q.set('search', search);
      const d = await api.get<{ items?: AdminChannelRow[]; total?: number; page?: number }>(`/api/v1/admin/channels?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت کانال‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void loadChannels(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, platform]);

  const openRelease = (pf?: string, ref?: string) => {
    setReleasePlatform(pf || 'telegram');
    setReleaseRef(ref || '');
    setReleaseOpen(true);
  };

  const submitRelease = async () => {
    const ref = releaseRef.trim();
    if (!ref) {
      toast.error('رفرنس کانال را وارد کنید.');
      return;
    }
    setReleaseBusy(true);
    try {
      await api.post('/api/v1/admin/channel-registry/release', { platform: releasePlatform, channelRef: ref });
      toast.success('کانال از رجیستری آزاد شد و امکان اتصال مجدد فراهم شد.');
      setReleaseOpen(false);
    } catch (err) {
      toast.error(errText(err, 'آزادسازی کانال از رجیستری ناموفق بود.'));
    } finally {
      setReleaseBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head adm-page-head--row">
        <div>
          <h2>کانال‌ها</h2>
          <p>همهٔ کانال‌های متصل کاربران در هر سه پلتفرم</p>
        </div>
        <Button variant="soft" onClick={() => openRelease()}>آزادسازی از رجیستری</Button>
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
              placeholder="جستجو: عنوان، رفرنس یا نام مالک…"
              aria-label="جستجوی کانال"
            />
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="📣" title="کانالی پیدا نشد" description="با تغییر پلتفرم یا عبارت جستجو دوباره بررسی کنید." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th>پلتفرم</th>
                    <th>عنوان</th>
                    <th>رفرنس</th>
                    <th>وضعیت</th>
                    <th>مالک</th>
                    <th>تاریخ اتصال</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ch) => (
                    <tr key={ch.id}>
                      <td data-label="پلتفرم"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlatformIcon platform={ch.platform} size={20} />{PLATFORM_FA[ch.platform] ?? 'پلتفرم نامشخص'}</span></td>
                      <td data-label="عنوان" style={{ fontWeight: 600 }}>{ch.title || '—'}</td>
                      <td data-label="رفرنس" dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{ch.channelRef || '—'}</td>
                      <td data-label="وضعیت"><StatusBadge state={ch.status ?? ''} labels={CHANNEL_STATUS_FA} /></td>
                      <td data-label="مالک">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ch.ownerName || '—'}</div>
                        {ch.ownerEmail && <div dir="ltr" style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--text-2)' }}>{ch.ownerEmail}</div>}
                      </td>
                      <td data-label="تاریخ اتصال">{faDate(ch.createdAt)}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => openRelease(ch.platform, ch.channelRef)}>
                          آزادسازی
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>

      <Modal open={releaseOpen} onClose={() => setReleaseOpen(false)} title="آزادسازی از رجیستری">
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
          اگر کانالی در رجیستری سامانه قفل شده و مالک آن نمی‌تواند دوباره متصل شود، با پلتفرم و رفرنس کانال آن را آزاد کنید.
        </p>
        <Field label="پلتفرم" required>
          <Select value={releasePlatform} onChange={(e) => setReleasePlatform(e.target.value)} aria-label="پلتفرم کانال">
            {PLATFORM_FILTERS.filter((f) => f.key).map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="رفرنس کانال" required hint="همان شناسه‌ای که در سامانه برای کانال ثبت شده است.">
          <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={releaseRef} onChange={(e) => setReleaseRef(e.target.value)} placeholder="مثلاً @my_channel" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="danger" loading={releaseBusy} onClick={() => void submitRelease()}>آزادسازی کانال</Button>
          <Button variant="ghost" onClick={() => setReleaseOpen(false)}>انصراف</Button>
        </div>
      </Modal>
    </>
  );
}
