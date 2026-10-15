import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, Input, Modal, Select, Spinner } from './ui';
import { faNumber } from '../lib/format';
import { useToast } from '../lib/toast';
import { ContentComposerTextarea } from './ContentComposerTextarea';

export type WebsiteDraftItem = {
  key: string;
  type: 'product' | 'content';
  contentType: 'post' | 'page' | null;
  sourceId: number;
  siteId: string;
  siteUrl: string;
  title: string;
  body: string;
  /** Full catalog source used only when the visible draft is still untouched. */
  sourceBody?: string;
  buttonLabel: string;
  buttonUrl: string;
  imageUrl: string;
  priceRial: number | null;
  regularPriceRial: number | null;
  salePriceRial: number | null;
  stockStatus: string;
  sku: string;
};

type SiteOption = { id: string; siteUrl: string; status?: string };
type Row = Record<string, unknown>;
type Category = { id: number; name: string; slug: string };
type MessageTemplate = { id: string; name: string; body: string; settingsJson?: Record<string, unknown> | null; category?: string };


function str(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function num(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function stockLabel(value: string): string {
  if (value === 'instock') return 'موجود';
  if (value === 'outofstock') return 'ناموجود';
  if (value === 'onbackorder') return 'در انتظار تأمین';
  return value || 'نامشخص';
}
function priceLabel(value: number | null): string { return value === null ? 'ثبت نشده' : `${faNumber(Math.floor(value))} ریال`; }
function safeBody(value: string): string { return value.replace(/\r\n/g, '\n').trim().slice(0, 4000); }

function imageProxyUrl(siteId: string, itemType: 'product' | 'content', sourceId: number): string {
  if (!siteId || !Number.isSafeInteger(sourceId) || sourceId < 1) return '';
  const params = new URLSearchParams({ siteId, itemType, sourceId: String(sourceId) });
  return `/api/v1/wordpress/featured-image-preview?${params.toString()}`;
}

function safeImageUrl(value: unknown, siteUrl: string): string {
  const raw = str(value).trim();
  if (!raw) return '';
  try {
    const baseRaw = siteUrl.trim();
    const base = baseRaw ? new URL(/^https?:\/\//i.test(baseRaw) ? baseRaw : `https://${baseRaw}`) : null;
    const resolved = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : base ? new URL(raw, `${base.origin}/`) : null;
    if (resolved && base?.protocol === 'https:' && resolved.protocol === 'http:' && resolved.hostname === base.hostname) {
      // WordPress setups sometimes emit same-site featured images with http URLs;
      // upgrade only same-host assets to prevent mixed-content failures safely.
      resolved.protocol = 'https:';
    }
    return resolved && (resolved.protocol === 'http:' || resolved.protocol === 'https:') ? resolved.href : '';
  } catch {
    return '';
  }
}

function ContentThumbnail({ src, siteUrl, proxySrc = '', size = 58, label = 'تصویر', fullWidth = false, maxHeight = 320 }: {
  src: string; siteUrl: string; proxySrc?: string; size?: number; label?: string; fullWidth?: boolean; maxHeight?: number;
}) {
  const url = safeImageUrl(src, siteUrl);
  const [failed, setFailed] = useState(!url && !proxySrc);
  const [useProxy, setUseProxy] = useState(!url && Boolean(proxySrc));
  useEffect(() => { setFailed(!url && !proxySrc); setUseProxy(!url && Boolean(proxySrc)); }, [url, proxySrc]);
  const fallbackStyle: CSSProperties = fullWidth
    ? { width: '100%', minHeight: 120, maxHeight, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 12 }
    : { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 10.5, overflow: 'hidden' as const };
  if (failed) return <span aria-label={label} title={label} style={fallbackStyle}>{label}</span>;
  const displayedUrl = useProxy ? proxySrc : url;
  return <img src={displayedUrl} alt={label === 'تصویر' ? '' : label} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => { if (!useProxy && proxySrc) setUseProxy(true); else setFailed(true); }} style={fullWidth
    ? { width: '100%', maxHeight, minHeight: 120, objectFit: 'contain', borderRadius: 12, background: 'var(--surface-2)', display: 'block' }
    : { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 9, objectFit: 'cover', background: 'var(--surface-2)', display: 'block' }} />;
}

function buildDraft(type: 'product' | 'content', row: Row, selectedContentType?: 'post' | 'page' | 'all'): WebsiteDraftItem {
  const siteId = str(row.siteId);
  const sourceId = Number(type === 'product' ? row.wcProductId : row.contentId);
  const originalTitle = str(row.customTitle).trim() || str(row.title).trim();
  const permalink = str(row.permalink).trim();
  const priceRial = num(row.priceRial);
  const regularPriceRial = num(row.regularPriceRial);
  const salePriceRial = num(row.salePriceRial);
  const stockStatus = str(row.stockStatus);
  const sku = str(row.sku);
  const siteUrl = str(row.siteUrl);
  const imageUrl = safeImageUrl(str(row.customImageUrl).trim() || str(row.imageUrl).trim(), siteUrl);
  const contentType = type === 'content' && (selectedContentType === 'page' || selectedContentType === 'post')
    ? selectedContentType
    : (str(row.contentType) === 'page' ? 'page' : 'post');
  const bodyOverride = str(row.customBody).trim();
  const originBody = str(row.body).trim() || str(row.excerpt).trim();
  let body = bodyOverride || originBody;
  if (type === 'product' && !bodyOverride) {
    const lines = [originalTitle];
    if (priceRial !== null) lines.push(`قیمت: ${priceLabel(priceRial)}`);
    if (stockStatus) lines.push(`وضعیت موجودی: ${stockLabel(stockStatus)}`);
    if (originBody) lines.push(originBody);
    if (permalink) lines.push(`مشاهده محصول: ${permalink}`);
    body = lines.join('\n\n');
  } else if (!body && permalink) {
    body = `${originalTitle}\n\n${permalink}`;
  }
  if (type === 'content' && permalink && !body.includes(permalink)) body = `${body}\n\n${permalink}`;
  const sourceBody = body.replace(/\r\n/g, '\n').trim().slice(0, 18000);
  return {
    key: `${type}:${siteId}:${sourceId}`,
    type,
    contentType: type === 'content' ? contentType : null,
    sourceId,
    siteId,
    siteUrl,
    title: originalTitle.slice(0, 190),
    body: safeBody(body),
    sourceBody,
    buttonLabel: permalink ? (type === 'product' ? 'مشاهده محصول' : (contentType === 'page' ? 'مشاهده برگه' : 'مطالعه مقاله')) : '',
    buttonUrl: permalink,
    imageUrl,
    priceRial,
    regularPriceRial,
    salePriceRial,
    stockStatus,
    sku,
  };
}

export function WebsiteContentPicker({ selectedItems, onChange, disabled = false }: {
  selectedItems: WebsiteDraftItem[];
  onChange: (items: WebsiteDraftItem[]) => void;
  disabled?: boolean;
}) {
  const [allowed, setAllowed] = useState(false);
  const [canSummarize, setCanSummarize] = useState(false);
  const [summarizingKey, setSummarizingKey] = useState<string | null>(null);
  const [checkedAccess, setCheckedAccess] = useState(false);
  const toast = useToast();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [type, setType] = useState<'product' | 'content'>('product');
  const [contentTypeFilter, setContentTypeFilter] = useState<'all' | 'post' | 'page'>('all');
  const [siteId, setSiteId] = useState('');
  const [query, setQuery] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [featured, setFeatured] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get<{ plan?: { limits?: { ai_monthly?: number }; features?: { woocommerce?: boolean; content_summarization?: boolean } } }>('/api/v1/subscriptions/current')
      .then(async (data) => {
        const hasFeature = data.plan?.features?.woocommerce === true;
        if (cancelled) return;
        setAllowed(hasFeature);
        setCanSummarize(data.plan?.features?.content_summarization === true && Number(data.plan?.limits?.ai_monthly ?? 0) > 0);
        if (!hasFeature) return;
        const [sitesData, templateData] = await Promise.all([
          api.get<{ sites?: SiteOption[] }>('/api/v1/wordpress/sites'),
          api.get<{ templates?: MessageTemplate[] }>('/api/v1/templates').catch(() => ({ templates: [] as MessageTemplate[] })),
        ]);
        if (!cancelled) setTemplates(templateData.templates ?? []);
        if (!cancelled) {
          const activeSites = (sitesData.sites ?? []).filter((site) => site.status === undefined || site.status === 'ACTIVE');
          setSites(activeSites);
          setSiteId((current) => current || activeSites[0]?.id || '');
        }
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      })
      .finally(() => { if (!cancelled) setCheckedAccess(true); });
    return () => { cancelled = true; };
  }, []);

  const params = useMemo(() => {
    const search = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (siteId) search.set('siteId', siteId);
    if (appliedQuery) search.set('q', appliedQuery);
    if (type === 'product' && stockStatus) search.set('stockStatus', stockStatus);
    if (type === 'product' && featured) search.set('featured', 'true');
    if (type === 'product' && onSale) search.set('onSale', 'true');
    if (categoryId) search.set('categoryId', categoryId);
    if (type === 'content' && contentTypeFilter !== 'all') search.set('contentType', contentTypeFilter);
    return search.toString();
  }, [page, siteId, appliedQuery, type, stockStatus, featured, onSale, categoryId, contentTypeFilter]);

  useEffect(() => {
    setCategories([]);
    setCategoryId('');
    if (!allowed || !siteId) return;
    let cancelled = false;
    const endpoint = type === 'product' ? '/api/v1/wordpress/products/categories' : '/api/v1/wordpress/contents/categories';
    const categoryParams = new URLSearchParams({ siteId });
    if (type === 'content' && contentTypeFilter !== 'all') categoryParams.set('contentType', contentTypeFilter);
    api.get<{ items?: Category[] }>(`${endpoint}?${categoryParams.toString()}`)
      .then((data) => { if (!cancelled) setCategories(data.items ?? []); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [allowed, siteId, type, contentTypeFilter]);

  useEffect(() => {
    if (!allowed || !showPicker || !siteId) { setRows([]); setTotal(0); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const endpoint = type === 'product' ? '/api/v1/wordpress/products' : '/api/v1/wordpress/contents';
    api.get<{ items?: Row[]; total?: number }>(`${endpoint}?${params}`)
      .then((data) => {
        if (cancelled) return;
        setRows(data.items ?? []);
        setTotal(Number(data.total ?? 0));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
          setLoadError(error instanceof Error ? error.message : 'دریافت محتوای وب‌سایت ناموفق بود.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, showPicker, siteId, type, params]);

  if (disabled || !checkedAccess || !allowed) return null;
  const selectedKeys = new Set(selectedItems.map((item) => item.key));
  const addRow = (row: Row) => {
    const draft = buildDraft(type, row, contentTypeFilter);
    if (selectedKeys.has(draft.key)) {
      onChange(selectedItems.filter((item) => item.key !== draft.key));
      return;
    }
    if (selectedItems.length >= 20) return;
    onChange([...selectedItems, draft]);
  };
  const addCurrentPage = () => {
    const current = [...selectedItems];
    const keys = new Set(current.map((item) => item.key));
    for (const row of rows) {
      if (current.length >= 20) break;
      const draft = buildDraft(type, row, contentTypeFilter);
      if (!keys.has(draft.key)) { current.push(draft); keys.add(draft.key); }
    }
    onChange(current);
  };
  const updateDraft = (key: string, patch: Partial<WebsiteDraftItem>) => onChange(selectedItems.map((item) => item.key === key ? { ...item, ...patch } : item));

  return (
    <>
    <Card pad="lg">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>انتخاب محصول، برگه یا مقاله از وب‌سایت</h3>
          <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.9 }}>هر مورد انتخاب‌شده یک پست مستقل می‌شود. عنوان، متن و دکمهٔ آن را جداگانه ویرایش کنید؛ دکمه‌های کانال‌محور پایین نیز برای همهٔ پست‌ها قابل افزودن هستند.</p>
        </div>
        <Button size="sm" variant={showPicker ? 'ghost' : 'soft'} onClick={() => setShowPicker((value) => !value)}>{showPicker ? 'بستن فهرست' : 'باز کردن فهرست'}</Button>
      </div>
      {sites.length === 0 ? (
        <div style={{ marginTop: 12, border: '1px dashed var(--border)', borderRadius: 12, padding: 14, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.9 }}>
          هنوز وب‌سایت فعالی متصل نشده است. ابتدا اتصال را در بخش <Link to="/dashboard/woocommerce" style={{ color: 'var(--brand)', fontWeight: 700 }}>مدیریت وب‌سایت</Link> کامل کنید.
        </div>
      ) : null}
      {showPicker && sites.length > 0 && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10 }}>
            <label className="field"><span className="field-label">چه چیزی می‌خواهید ارسال کنید؟</span><Select value={type === 'product' ? 'product' : contentTypeFilter} onChange={(e) => {
              const next = e.target.value as 'product' | 'post' | 'page';
              const nextType = next === 'product' ? 'product' : 'content';
              // Keep already selected drafts while changing the source filter;
              // the result list is refetched for the exact selected content type.
              setType(nextType);
              setContentTypeFilter(next === 'product' ? 'all' : next);
              setRows([]); setTotal(0); setLoadError(''); setCategoryId(''); setPage(1);
            }}><option value="product">محصولات ووکامرس</option><option value="post">نوشته‌ها و مقالات</option><option value="page">برگه‌های وردپرس</option></Select></label>
            <label className="field"><span className="field-label">وب‌سایت</span><Select value={siteId} onChange={(e) => { if (e.target.value !== siteId) onChange([]); setSiteId(e.target.value); setRows([]); setTotal(0); setPage(1); }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteUrl}</option>)}</Select></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8 }}>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={type === 'product' ? 'جستجو بر اساس نام محصول…' : 'جستجو بر اساس عنوان مقاله…'} />
            <Button size="sm" onClick={() => { setAppliedQuery(query.trim()); setPage(1); }}>جستجو</Button>
          </div>
          <label className="field"><span className="field-label">دسته‌بندی</span><Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}><option value="">همهٔ دسته‌های این سایت</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
          {type === 'product' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '9px 11px', borderRadius: 10, background: 'var(--surface-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><span>موجودی</span><Select value={stockStatus} onChange={(e) => { setStockStatus(e.target.value); setPage(1); }}><option value="">همه</option><option value="instock">موجود</option><option value="outofstock">ناموجود</option><option value="onbackorder">در انتظار تأمین</option></Select></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={featured} onChange={(e) => { setFeatured(e.target.checked); setPage(1); }} />ویژه</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={onSale} onChange={(e) => { setOnSale(e.target.checked); setPage(1); }} />حراج</label>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{faNumber(total)} مورد در نتیجه · حداکثر ۲۰ پست هم‌زمان</span>
            <Button size="sm" variant="soft" disabled={loading || !rows.length || selectedItems.length >= 20} onClick={addCurrentPage}>انتخاب موارد این صفحه</Button>
          </div>
          {loading ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-2)', padding: 12 }}><Spinner />در حال دریافت فهرست…</div> : loadError ? <div role="alert" style={{ padding: 12, borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12.5 }}>{loadError}<div style={{ marginTop: 8 }}><Button size="sm" variant="soft" onClick={() => setPage((value) => value)}>تلاش دوباره</Button></div></div> : rows.length === 0 ? <div style={{ padding: 16, border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-2)', fontSize: 13, textAlign: 'center' }}>موردی پیدا نشد. ابتدا از افزونهٔ اتصال وردپرس، مقالات و محصولات را همگام‌سازی کنید.</div> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map((row) => {
                const draft = buildDraft(type, row, contentTypeFilter);
                const checked = selectedKeys.has(draft.key);
                const price = num(row.salePriceRial) ?? num(row.priceRial);
                const regular = num(row.regularPriceRial);
                const onSaleRow = price !== null && regular !== null && price < regular;
                return (
                  <div key={draft.key} style={{ display: 'grid', gridTemplateColumns: '20px 58px minmax(0,1fr) auto', gap: 10, padding: 10, border: `1px solid ${checked ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 12, background: checked ? 'var(--brand-soft)' : 'var(--surface)', alignItems: 'start' }}>
                  <label style={{ display: 'contents', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} disabled={!checked && selectedItems.length >= 20} onChange={() => addRow(row)} style={{ marginTop: 4, accentColor: 'var(--brand)' }} />
                    <ContentThumbnail src={draft.imageUrl} siteUrl={draft.siteUrl || sites.find((site) => site.id === draft.siteId)?.siteUrl || ''} proxySrc={imageProxyUrl(draft.siteId, draft.type, draft.sourceId)} size={58} label={type === 'product' ? 'تصویر محصول' : (draft.contentType === 'page' ? 'تصویر برگه' : 'تصویر نوشته')} />
                    <span style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                      <strong style={{ fontSize: 13.5, lineHeight: 1.7 }}>{draft.title || 'بدون عنوان'}</strong>
                      <span style={{ color: 'var(--text-2)', fontSize: 11.5, overflowWrap: 'anywhere' }}>{draft.siteUrl || sites.find((site) => site.id === draft.siteId)?.siteUrl || 'وب‌سایت'}</span>
                      {type === 'product' ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11.5 }}><b>{priceLabel(price)}</b>{onSaleRow && regular !== null ? <del style={{ color: 'var(--text-2)' }}>{priceLabel(regular)}</del> : null}<span className="badge">{stockLabel(draft.stockStatus)}</span>{draft.sku ? <span dir="ltr">SKU: {draft.sku}</span> : null}{row.isFeatured ? <span className="badge">ویژه</span> : null}{Number(row.salesCount) > 0 ? <span>فروش: {faNumber(Number(row.salesCount))}</span> : null}</span> : <span style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.8 }}>{str(row.body || row.customBody).replace(/\s+/g, ' ').slice(0, 150)}</span>}
                    </span>
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setDetailRow({ ...row, __postyarType: type })}>مشاهده</Button>
                </div>
                );
              })}
            </div>
          )}
          {total > 50 && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Button size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>صفحهٔ قبل</Button><span style={{ color: 'var(--text-2)', fontSize: 12 }}>صفحه {faNumber(page)} از {faNumber(Math.ceil(total / 50))}</span><Button size="sm" variant="ghost" disabled={page >= Math.ceil(total / 50) || loading} onClick={() => setPage((value) => value + 1)}>صفحهٔ بعد</Button></div>}
        </div>
      )}
      {selectedItems.length > 0 && templates.length > 0 && (
        <div style={{ marginTop: 14, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
          <label className="field"><span className="field-label">قالب آماده یا اختصاصی برای موارد انتخاب‌شده</span><Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">انتخاب قالب…</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select></label>
          <div style={{ display: 'flex', alignItems: 'end' }}><Button size="sm" disabled={!templateId} onClick={() => {
            const template = templates.find((item) => item.id === templateId);
            if (!template) return;
            const rendered = selectedItems.map((item) => {
              const values: Record<string, string> = { title: item.title, description: item.body, content: item.body, excerpt: item.body.slice(0, 500), link: item.buttonUrl, site_name: item.siteUrl, site_url: item.siteUrl, post_type: item.type === 'product' ? 'محصول' : (item.contentType === 'page' ? 'برگه' : 'نوشته / مقاله'), featured_image: item.imageUrl, product_id: String(item.sourceId), price: item.priceRial === null ? '' : String(item.priceRial), regular_price: item.regularPriceRial === null ? '' : String(item.regularPriceRial), sale_price: item.salePriceRial === null ? '' : String(item.salePriceRial), sku: item.sku, stock_status: stockLabel(item.stockStatus) };
              let body = template.body;
              Object.entries(values).forEach(([key, value]) => { body = body.replaceAll(`{${key}}`, value); });
              body = body.replace(/\{(?:meta|acf|jet):[^}]+\}/g, '');
              const settings = template.settingsJson && typeof template.settingsJson === 'object' ? template.settingsJson : {};
              const cta = settings.cta && typeof settings.cta === 'object' ? settings.cta as Record<string, unknown> : {};
              const url = typeof cta.url === 'string' ? cta.url.replaceAll('{link}', item.buttonUrl) : item.buttonUrl;
              return { ...item, body: safeBody(body), buttonLabel: typeof cta.label === 'string' ? cta.label : item.buttonLabel, buttonUrl: url };
            });
            onChange(rendered);
          }}>اعمال قالب</Button></div>
        </div>
      )}
      {selectedItems.length > 0 && (
        <div style={{ marginTop: 16, display: 'grid', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13.5 }}>ویرایش جداگانهٔ محتوای انتخاب‌شده ({faNumber(selectedItems.length)})</strong>
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>پاک کردن انتخاب‌ها</Button>
          </div>
          {selectedItems.map((item, index) => (
            <section key={item.key} style={{ display: 'grid', gap: 9, border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}><ContentThumbnail src={item.imageUrl} siteUrl={item.siteUrl} proxySrc={imageProxyUrl(item.siteId, item.type, item.sourceId)} size={58} label="تصویر محتوا" /><strong style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{faNumber(index + 1)}. {item.type === 'product' ? 'محصول' : (item.contentType === 'page' ? 'برگه' : 'نوشته / مقاله')} · {item.title}</strong><Button size="sm" variant="ghost" onClick={() => onChange(selectedItems.filter((candidate) => candidate.key !== item.key))}>حذف</Button></div>
              <label className="field"><span className="field-label">عنوان این پست</span><Input value={item.title} maxLength={190} onChange={(e) => updateDraft(item.key, { title: e.target.value })} /></label>
              <div className="field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span className="field-label">متن این پست</span>
                  {canSummarize ? <Button size="sm" variant="soft" loading={summarizingKey === item.key} disabled={Boolean(summarizingKey) || !item.body.trim()} onClick={async () => {
                    if (!item.body.trim()) return;
                    setSummarizingKey(item.key);
                    try {
                      const untouchedSource = item.sourceBody && item.body === safeBody(item.sourceBody);
                      const summaryInput = untouchedSource ? item.sourceBody as string : item.body;
                      const result = await api.post<{ text?: string }>('/api/v1/wordpress/summarize', {
                        title: item.title,
                        body: summaryInput,
                        contentType: item.type === 'product' ? 'product' : item.contentType === 'page' ? 'page' : 'post',
                      });
                      const summary = typeof result.text === 'string' ? result.text.trim() : '';
                      if (!summary) throw new Error('خلاصهٔ قابل‌استفاده دریافت نشد.');
                      updateDraft(item.key, { body: safeBody(summary), sourceBody: summary });
                      toast.success('خلاصه آماده شد و جای متن قبلی قرار گرفت؛ پیش از ارسال آن را مرور کنید.');
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'خلاصه‌سازی انجام نشد.');
                    } finally {
                      setSummarizingKey(null);
                    }
                  }}>خلاصه‌سازی برای کانال‌ها</Button> : null}
                </div>
                <ContentComposerTextarea className="input" rows={4} maxLength={4000} value={item.body} onChange={(e) => updateDraft(item.key, { body: e.target.value })} style={{ resize: 'vertical', lineHeight: 1.9 }} toolsLabel="ایموجی و استیکر این پست" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,.7fr) minmax(0,1.3fr)', gap: 8 }}>
                <label className="field"><span className="field-label">عنوان دکمه</span><Input maxLength={64} value={item.buttonLabel} onChange={(e) => updateDraft(item.key, { buttonLabel: e.target.value })} placeholder="مشاهده / مطالعه" /></label>
                <label className="field"><span className="field-label">پیوند دکمه</span><Input dir="ltr" value={item.buttonUrl} onChange={(e) => updateDraft(item.key, { buttonUrl: e.target.value })} placeholder="https://…" /></label>
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
      <Modal open={Boolean(detailRow)} onClose={() => setDetailRow(null)} title={detailRow ? str(detailRow.title) || 'جزئیات محتوا' : 'جزئیات محتوا'} large>{detailRow ? <div style={{ display: 'grid', gap: 12 }}><ContentThumbnail src={str(detailRow.customImageUrl || detailRow.imageUrl)} siteUrl={str(detailRow.siteUrl)} proxySrc={imageProxyUrl(str(detailRow.siteId), str(detailRow.__postyarType) === 'product' ? 'product' : 'content', Number(str(detailRow.__postyarType) === 'product' ? detailRow.wcProductId : detailRow.contentId))} fullWidth maxHeight={320} label="تصویر شاخص" /><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className="badge">{str(detailRow.__postyarType) === 'product' ? 'محصول' : (str(detailRow.contentType) === 'page' ? 'برگه' : 'مقاله')}</span>{str(detailRow.siteUrl) ? <span className="badge">{str(detailRow.siteUrl)}</span> : null}</div><p style={{ whiteSpace: 'pre-wrap', lineHeight: 2, margin: 0 }}>{str(detailRow.body || detailRow.customBody || detailRow.excerpt)}</p>{str(detailRow.__postyarType) === 'product' ? <div style={{ display: 'grid', gap: 6, fontSize: 13 }}><div>قیمت: {priceLabel(num(detailRow.salePriceRial) ?? num(detailRow.priceRial))}</div><div>قیمت عادی: {priceLabel(num(detailRow.regularPriceRial))}</div><div>موجودی: {stockLabel(str(detailRow.stockStatus))}</div><div>شناسه SKU: {str(detailRow.sku) || 'ثبت نشده'}</div></div> : null}{Array.isArray(detailRow.categories) && detailRow.categories.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(detailRow.categories as Category[]).map((category) => <span key={category.id} className="badge">{category.name}</span>)}</div> : null}{str(detailRow.permalink) ? <a href={str(detailRow.permalink)} target="_blank" rel="noreferrer">مشاهده در وب‌سایت اصلی</a> : null}</div> : null}</Modal>
    </>
  );
}
