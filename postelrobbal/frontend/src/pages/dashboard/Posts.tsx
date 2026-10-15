import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiRequestError, type ChannelDto, type Page, type PostDto } from '../../lib/api';
import { Badge, Button, EmptyState, Input, Modal, PageLoading, Pagination, Select, StatusBadge } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDate, faDateTime, faLabel, POST_SOURCE_FA, POST_STATE_FA, DELIVERY_STATE_FA, PLATFORM_FA } from '../../lib/format';
const telegramLogo = new URL('../../assets/platforms/telegram.png', import.meta.url).href;
const baleLogo = new URL('../../assets/platforms/bale.png', import.meta.url).href;
const rubikaLogo = new URL('../../assets/platforms/rubika.png', import.meta.url).href;

const SOURCE_TONE: Record<string, 'brand' | 'warning' | 'info' | 'muted'> = {
  MANUAL: 'brand',
  GOLD: 'warning',
  WORDPRESS: 'info',
  WORKFLOW: 'muted',
};

const STATE_KEYS = Object.keys(POST_STATE_FA);

const PLATFORM_LOGO: Record<string, string> = { telegram: telegramLogo, bale: baleLogo, rubika: rubikaLogo };

function PlatformCounts({ items, channels }: {
  items: NonNullable<PostDto['channelSummary']>;
  channels: NonNullable<PostDto['channelDetails']>;
}) {
  if (!items.length && !channels.length) return <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>;
  return <div style={{ display: 'grid', gap: 6, minWidth: 125, maxWidth: 340 }}>
    {items.length > 0 && (
      <div aria-label="تعداد کانال‌ها به تفکیک پلتفرم" style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {items.map((item) => {
          const logo = PLATFORM_LOGO[item.platform];
          const label = PLATFORM_FA[item.platform] ?? item.platform;
          const title = label + ': ' + item.sentCount + ' ارسال موفق از ' + item.count + ' کانال' + (item.failedCount ? '، ' + item.failedCount + ' ناموفق' : '');
          return <span key={item.platform} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 20, background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>
            {logo ? <img src={logo} alt={label} width={19} height={19} loading="lazy" style={{ objectFit: 'contain', display: 'block' }} /> : <span style={{ fontSize: 10 }}>{label.slice(0, 2)}</span>}
            <strong style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{item.count}</strong>
          </span>;
        })}
      </div>
    )}
    {channels.length > 0 && (
      <div aria-label="نام کانال‌های مقصد" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {channels.map((channel) => {
          const logo = PLATFORM_LOGO[channel.platform];
          const platformLabel = PLATFORM_FA[channel.platform] ?? channel.platform;
          return <span key={channel.channelId} title={platformLabel + ' · ' + channel.state} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', maxWidth: '100%', minWidth: 0 }}>
            {logo ? <img src={logo} alt="" aria-hidden="true" width={15} height={15} loading="lazy" style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }} /> : null}
            <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{channel.title}</span>
          </span>;
        })}
      </div>
    )}
  </div>;
}

function postTime(post: PostDto): string {
  const date = post.state === 'SCHEDULED' || post.state === 'QUEUED'
    ? post.scheduledAt ?? post.publishedAt ?? post.latestSentAt ?? post.createdAt
    : post.publishedAt ?? post.latestSentAt ?? post.scheduledAt ?? post.createdAt;
  return faDateTime(date);
}


type PostDetailPayload = {
  post: { id: string; title: string | null; body: string; state: string; source: string; scheduledAt: string | null; publishedAt: string | null; createdAt: string; mediaId: string | null };
  targets: Array<{ id: string; state: string; attempts: number; providerMessageId: string | null; errorCode: string | null; errorMessage: string | null; sentAt: string | null; nextRetryAt: string | null; platform: string; channelTitle: string; channelRef: string }>;
};

function snippet(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

function canEditScheduledPost(post: PostDto): boolean {
  if (post.state !== 'SCHEDULED' || !post.scheduledAt) return false;
  const scheduledAt = new Date(post.scheduledAt).getTime();
  if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) return false;
  const activeTargets = (post.targetSummary ?? []).filter((target) => target.state !== 'CANCELLED' && target.count > 0);
  return activeTargets.length > 0 && activeTargets.every((target) => target.state === 'PENDING');
}

export default function Posts() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<PostDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState<PostDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const pageSize = 10;

  useEffect(() => {
    let cancelled = false;
    api.get<{ channels: ChannelDto[] }>('/api/v1/channels')
      .then((data) => { if (!cancelled) setChannels(data.channels ?? []); })
      .catch((error: unknown) => { if (!cancelled) toast.error(errText(error)); });
    return () => { cancelled = true; };
  }, [toast]);

  // Debounced search (§ input latency): typing updates the query 350ms after the last keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (stateFilter) params.set('state', stateFilter);
      if (search) params.set('search', search);
      if (channelFilter) params.set('channelId', channelFilter);
      const data = await api.get<Page<PostDto>>(`/api/v1/posts?${params.toString()}`);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [page, stateFilter, channelFilter, search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailError(''); setDetailLoading(false); return; }
    let active = true;
    setDetail(null); setDetailError(''); setDetailLoading(true);
    api.get<PostDetailPayload>(`/api/v1/posts/${encodeURIComponent(detailId)}`)
      .then((data) => { if (active) setDetail(data); })
      .catch((error: unknown) => { if (active) setDetailError(errText(error)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailId]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>پست‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>مدیریت و پیگیری پست‌های ساخته‌شده</p>
        </div>
        <Link to="/dashboard/posts/new" className="btn btn-primary">+ پست جدید</Link>
      </div>

      <div className="posts-filter-row">
        <div className="post-search"><Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="جست‌وجو در عنوان یا متن پست…"
          aria-label="جست‌وجوی پست"
          style={{ width: '100%' }}
        /></div>
        <Select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            setPage(1);
          }}
          aria-label="فیلتر وضعیت"
          style={{ minWidth: 180 }}
        >
          <option value="">همهٔ وضعیت‌ها</option>
          {STATE_KEYS.map((k) => (
            <option key={k} value={k}>{POST_STATE_FA[k]}</option>
          ))}
        </Select>
        <Select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
          aria-label="فیلتر کانال مقصد"
          style={{ minWidth: 210 }}
        >
          <option value="">همهٔ کانال‌ها</option>
          {channels.filter((channel) => channel.status === 'ACTIVE').map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.title} — {channel.platform === 'telegram' ? 'تلگرام' : channel.platform === 'bale' ? 'بله' : 'روبیکا'}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="✉️"
          title={search || stateFilter || channelFilter ? 'پستی یافت نشد' : 'هنوز پستی نساخته‌اید'}
          description={
            search || stateFilter || channelFilter
              ? 'با این شرایط جست‌وجو، پستی پیدا نشد. عبارت یا فیلتر دیگری را امتحان کنید.'
              : 'اولین پست خود را بسازید و در کانال‌هایتان منتشر کنید.'
          }
          action={
            search || stateFilter || channelFilter ? (
              <Button variant="ghost" onClick={() => { setSearchInput(''); setStateFilter(''); setChannelFilter(''); setPage(1); }}>
                پاک کردن فیلترها
              </Button>
            ) : (
              <Link to="/dashboard/posts/new" className="btn btn-primary">ساخت پست جدید</Link>
            )
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پست</th>
                  <th>وضعیت</th>
                  <th>منبع</th>
                  <th>کانال‌ها</th>
                  <th>زمان انتشار/ارسال</th>
                  <th>تاریخ ایجاد</th>
                  <th>اقدامات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setDetailId(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(p.id); }
                    }}
                    style={{ cursor: 'pointer' }}
                    tabIndex={0}
                    aria-label={`مشاهده جزئیات پست ${p.title ?? 'بدون عنوان'}`}
                  >
                    <td style={{ maxWidth: 340 }}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetailId(p.id); }} style={{ padding: 0, border: 0, background: 'transparent', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: 'pointer', textAlign: 'right' }}>
                        {p.title?.trim() || 'بدون عنوان'}
                      </button>
                      <div style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 2 }}>{snippet(p.body)}</div>
                    </td>
                    <td><StatusBadge state={p.state} labels={POST_STATE_FA} /></td>
                    <td><Badge tone={SOURCE_TONE[p.source] ?? 'muted'}>{faLabel(p.source, POST_SOURCE_FA)}</Badge></td>
                    <td><PlatformCounts items={p.channelSummary ?? []} channels={p.channelDetails ?? []} /></td>
                    <td style={{ whiteSpace: 'nowrap' }} title={p.scheduledAt ? `زمان‌بندی: ${faDateTime(p.scheduledAt)}` : undefined}>{postTime(p)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{faDate(p.createdAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEditScheduledPost(p) && (
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/dashboard/posts/${p.id}/edit`)}>
                          ویرایش پست
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
      <Modal open={Boolean(detailId)} onClose={() => setDetailId('')} title={detail?.post.title?.trim() || 'جزئیات پست'} large>
        {detailLoading ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)' }}>در حال دریافت جزئیات پست…</div> : detailError ? <div role="alert" style={{ padding: 14, borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)' }}>{detailError}</div> : detail ? <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><StatusBadge state={detail.post.state} labels={POST_STATE_FA} /><Badge tone={SOURCE_TONE[detail.post.source] ?? 'muted'}>{faLabel(detail.post.source, POST_SOURCE_FA)}</Badge><span style={{ color: 'var(--text-2)', fontSize: 12 }}>تاریخ ایجاد: {faDateTime(detail.post.createdAt)}</span>{detail.post.scheduledAt ? <span style={{ color: 'var(--text-2)', fontSize: 12 }}>زمان‌بندی: {faDateTime(detail.post.scheduledAt)}</span> : null}{detail.post.publishedAt ? <span style={{ color: 'var(--text-2)', fontSize: 12 }}>انتشار: {faDateTime(detail.post.publishedAt)}</span> : null}</div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 2, padding: 14, background: 'var(--surface-2)', borderRadius: 12 }}>{detail.post.body || 'متن خالی است.'}</div>
          <div><strong style={{ fontSize: 13 }}>نتیجهٔ ارسال به کانال‌ها ({detail.targets.length})</strong>{detail.targets.length ? <div style={{ display: 'grid', gap: 8, marginTop: 9 }}>{detail.targets.map((target) => <div key={target.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'start', padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}><div><strong style={{ fontSize: 12.5 }}>{target.channelTitle || target.channelRef || 'کانال'}</strong><div style={{ color: 'var(--text-2)', fontSize: 11.5, marginTop: 3 }}>{PLATFORM_FA[target.platform] ?? target.platform} · تلاش: {target.attempts}</div>{target.errorMessage ? <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 5 }}>{target.errorMessage}</div> : null}{target.sentAt ? <div style={{ color: 'var(--text-2)', fontSize: 11.5, marginTop: 3 }}>ارسال: {faDateTime(target.sentAt)}</div> : null}</div><Badge tone={target.state === 'SENT' || target.state === 'DELIVERED' ? 'success' : target.state === 'FAILED' ? 'danger' : 'muted'}>{DELIVERY_STATE_FA[target.state] ?? target.state}</Badge></div>)}</div> : <p style={{ color: 'var(--text-2)', fontSize: 12.5 }}>برای این پست مقصدی ثبت نشده است.</p>}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button size="sm" onClick={() => { const id = detailId; setDetailId(''); navigate(`/dashboard/posts/${id}`); }}>نمایش صفحهٔ کامل</Button><Button size="sm" variant="ghost" onClick={() => setDetailId('')}>بستن</Button></div>
        </div> : null}
      </Modal>
    </div>
  );
}
