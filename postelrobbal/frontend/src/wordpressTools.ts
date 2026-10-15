/*
 * Postyar V26 additive runtime: WordPress/WooCommerce templates, shortcodes,
 * campaigns and the account referral-code fallback. This runtime is isolated
 * from the React tree so existing V19 visual/layout assets remain untouched.
 */

import { faDateTime, faDigits, toLatinDigits } from './lib/format';
import { onRouteChange } from './lib/routeEvents';

type AnyRecord = Record<string, any>;

type TemplateRow = {
  id: string;
  name: string;
  description?: string | null;
  body: string;
  category: string;
  isDefault: number | boolean;
  settingsJson?: Record<string, unknown> | null;
};

type WordPressAnalytics = { sites?: { total: number; active: number }; products?: { synced: number; published: number; failed: number }; contents?: { synced: number; published: number; failed: number }; campaigns?: { total: number; active: number; runs: number; failedRuns: number; queued: number; items: AnyRecord[] }; };

type CampaignRow = AnyRecord & {
  id: string;
  name: string;
  siteId: string;
  itemType: 'product' | 'content';
  selectionType: string;
  templateId?: string | null;
  channelIdsJson?: string[] | null;
  frequency: 'daily' | 'weekly';
  sendTime: string;
  daysJson?: string[] | null;
  itemCount: number;
  selectionIdsJson?: number[] | string[] | null;
  isEnabled: number | boolean;
  lastRunAt?: string | null;
  lastResultJson?: AnyRecord | null;
};

const ROOT_MARK = 'data-postyar-wordpress-tools';
const SETTINGS_MARK = 'data-postyar-referral-settings';
const PLATFORM_LABEL: Record<string, string> = { telegram: 'تلگرام', bale: 'بله', rubika: 'روبیکا' };
const DAY_LABEL: Record<string, string> = { sun: 'یکشنبه', mon: 'دوشنبه', tue: 'سه‌شنبه', wed: 'چهارشنبه', thu: 'پنجشنبه', fri: 'جمعه', sat: 'شنبه' };

let currentPath = '';
let syncScheduled = false;
let stateCache: {
  templates: TemplateRow[];
  tags: AnyRecord[];
  sites: AnyRecord[];
  channels: AnyRecord[];
  campaigns: CampaignRow[];
  analytics: WordPressAnalytics | null;
  issues: string[];
} | null = null;
let editingTemplateId: string | null = null;
let templateEditorOpen = false;
let editingCampaignId: string | null = null;
let campaignPickerIds: number[] = [];
let campaignPickerSiteId = '';

function csrf(): string | null {
  try { return sessionStorage.getItem('py_csrf'); } catch { return null; }
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrf();
    if (token) headers['x-csrf-token'] = token;
  }
  const response = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    const message = String(error?.message ?? 'درخواست به سرور ناموفق بود.');
    const requestId = typeof error?.requestId === 'string' ? error.requestId : '';
    throw new Error(requestId ? `${message} (شناسهٔ پیگیری: ${requestId})` : message);
  }
  return (payload?.data !== undefined ? payload.data : payload) as T;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function faNum(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('fa-IR') : String(value ?? '');
}

function findDashboardMain(): HTMLElement | null {
  return document.querySelector('.dash-main');
}

function hasHeading(main: HTMLElement, text: string): boolean {
  return Array.from(main.querySelectorAll('h1')).some((node) => (node.textContent ?? '').trim() === text);
}

async function loadPart<T>(label: string, operation: Promise<T>, fallback: T, issues: string[]): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'خطای نامشخص';
    issues.push(`${label}: ${reason}`);
    return fallback;
  }
}

async function loadState(force = false) {
  if (stateCache && !force) return stateCache;
  const issues: string[] = [];
  const [templates, tags, sites, channels, campaigns, analytics] = await Promise.all([
    loadPart('قالب‌های پیام', request<{ templates?: TemplateRow[] }>('/api/v1/templates').then((d) => d.templates ?? []), [] as TemplateRow[], issues),
    loadPart('فهرست برچسب‌های قالب', request<{ tags?: AnyRecord[] }>('/api/v1/templates/tags').then((d) => d.tags ?? []), [] as AnyRecord[], issues),
    loadPart('اتصال‌های وب‌سایت', request<{ sites?: AnyRecord[] }>('/api/v1/wordpress/sites').then((d) => d.sites ?? []), [] as AnyRecord[], issues),
    loadPart('کانال‌های مقصد', request<{ channels?: AnyRecord[] }>('/api/v1/channels').then((d) => d.channels ?? []), [] as AnyRecord[], issues),
    loadPart('کمپین‌های خودکار', request<{ campaigns?: CampaignRow[] }>('/api/v1/wordpress/campaigns').then((d) => d.campaigns ?? []), [] as CampaignRow[], issues),
    request<WordPressAnalytics>('/api/v1/analytics/wordpress?days=30').catch(() => null),
  ]);
  stateCache = { templates, tags, sites, channels, campaigns, analytics, issues };
  return stateCache;
}

function showMessage(root: HTMLElement, message: string, kind: 'error' | 'ok' = 'error') {
  const existing = root.querySelector('[data-wp-tools-message]');
  existing?.remove();
  const box = document.createElement('div');
  box.dataset.wpToolsMessage = '1';
  box.style.cssText = `margin:0 0 12px;padding:10px 12px;border-radius:11px;font-size:12.5px;line-height:1.8;background:${kind === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)'};color:${kind === 'ok' ? 'var(--success)' : 'var(--danger)'}`;
  box.textContent = message;
  root.prepend(box);
  window.setTimeout(() => box.remove(), 4500);
}

function templateDataToForm(root: HTMLElement, item: TemplateRow) {
  const set = (selector: string, value: string) => { const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); if (el) el.value = value; };
  set('[data-template-name]', item.name);
  set('[data-template-category]', item.category);
  set('[data-template-description]', item.description ?? '');
  set('[data-template-body]', item.body);
}

function campaignSelections(itemType: 'product' | 'content', selected: string): string {
  const common = [
    ['latest', 'جدیدترین محتوا'], ['recently_updated', 'به‌روزرسانی‌شده‌ها'], ['random', 'انتخاب تصادفی'], ['manual', 'انتخاب دستی'], ['category', 'بر اساس دسته‌بندی'],
  ];
  const product = [
    ['featured_products', 'محصولات ویژه'], ['sale_products', 'محصولات حراج'], ['in_stock_products', 'موجودها'],
    ['out_of_stock_products', 'ناموجودها'], ['best_selling_products', 'پرفروش‌ها'],
  ];
  const opts = itemType === 'product' ? common.concat(product) : common;
  return opts.map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
}

function renderCampaignPickerPlaceholder(type: 'product' | 'content' = 'product'): string {
  const kindFilter = type === 'content' ? `<label class="field" style="min-width:180px"><span class="field-label">نوع محتوای وردپرس</span><select class="input" data-campaign-content-kind><option value="all">نوشته‌ها و برگه‌ها</option><option value="post">نوشته‌ها / مقالات</option><option value="page">برگه‌ها</option></select></label>` : '';
  return `<div class="wp-template-setting-box" style="margin-top:12px" data-campaign-picker-area><div class="wp-card-head"><div><strong>انتخاب دستی محتوا</strong><p>از محصولات، نوشته‌ها یا برگه‌های همین وب‌سایت موارد مشخص را برای اجرای کمپین انتخاب کنید.</p></div><span class="badge" data-campaign-selected-count>${faNum(campaignPickerIds.length)} انتخاب</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">${kindFilter}<input class="input" data-campaign-picker-search placeholder="جستجوی عنوان…" style="min-width:220px;flex:1" /><button type="button" class="btn btn-soft" data-campaign-picker-search-btn>جستجو</button></div><div style="margin-top:10px" data-campaign-picker-list><div class="wp-template-preview">برای بارگذاری فهرست، جستجو یا انتخاب کمپین را انجام دهید.</div></div></div>`;
}

function renderCampaignCategoryPickerPlaceholder(type: 'product' | 'content' = 'product'): string {
  const kindFilter = type === 'content' ? `<label class="field" style="max-width:320px"><span class="field-label">نوع محتوای وردپرس</span><select class="input" data-campaign-content-kind><option value="all">نوشته‌ها و برگه‌ها</option><option value="post">نوشته‌ها / مقالات</option><option value="page">برگه‌ها</option></select></label>` : '';
  return `<div class="wp-template-setting-box" style="margin-top:12px" data-campaign-picker-area data-mode="category"><div class="wp-card-head"><div><strong>انتخاب دسته‌بندی محتوا</strong><p>فقط موارد دسته‌های انتخاب‌شده از همین وب‌سایت برای کمپین در نظر گرفته می‌شوند.</p></div><span class="badge" data-campaign-selected-count>${faNum(campaignPickerIds.length)} دسته</span></div>${kindFilter}<div style="margin-top:10px" data-campaign-picker-list><div class="wp-template-preview">در حال دریافت دسته‌بندی‌ها…</div></div></div>`;
}

/* POSTYAR-SECURITY-FRONTEND-SINK-HARDENING-R1-20261014: external WordPress links must use credential-free HTTP(S). */
function safePostyarExternalHttpUrl(value: unknown): string {
  const candidate = String(value ?? '').trim();
  if (!candidate || candidate.length > 2048 || /[\u0000-\u001f\u007f]/.test(candidate)) return '';
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function showCampaignPickerDetail(item: AnyRecord, type: 'product' | 'content') {
  const title = esc(item.title ?? 'بدون عنوان');
  const image = String(item.customImageUrl ?? item.imageUrl ?? '').trim();
  const categories = Array.isArray(item.categories)
    ? item.categories.map((entry) => esc(typeof entry === 'object' && entry !== null ? (entry as AnyRecord).name ?? '' : entry)).filter(Boolean).join('، ')
    : '';
  const permalink = safePostyarExternalHttpUrl(item.permalink);
  const description = String(item.customBody ?? item.body ?? item.excerpt ?? '').trim();
  const imageMarkup = image
    ? `<img src="${esc(image)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;max-height:280px;object-fit:contain;border-radius:12px;background:var(--surface-2);margin-bottom:14px">`
    : '<div style="padding:22px;border-radius:12px;background:var(--surface-2);color:var(--text-2);text-align:center;margin-bottom:14px">تصویری برای این محتوا ثبت نشده است.</div>';
  const details: string[] = [];
  if (type === 'product') {
    if (item.sku) details.push(`<div><b>شناسه کالا:</b> ${esc(item.sku)}</div>`);
    if (item.priceRial !== null && item.priceRial !== undefined) details.push(`<div><b>قیمت:</b> ${esc(faNum(item.priceRial))} ریال</div>`);
    if (item.regularPriceRial !== null && item.regularPriceRial !== undefined) details.push(`<div><b>قیمت اصلی:</b> ${esc(faNum(item.regularPriceRial))} ریال</div>`);
    if (item.salePriceRial !== null && item.salePriceRial !== undefined) details.push(`<div><b>قیمت فروش ویژه:</b> ${esc(faNum(item.salePriceRial))} ریال</div>`);
    if (item.stockStatus) details.push(`<div><b>موجودی:</b> ${esc(item.stockStatus)}</div>`);
    if (item.isFeatured !== undefined) details.push(`<div><b>محصول ویژه:</b> ${bool(item.isFeatured) ? 'بله' : 'خیر'}</div>`);
  } else {
    details.push(`<div><b>نوع محتوا:</b> ${item.contentType === 'page' ? 'برگه' : 'مقاله'}</div>`);
    if (item.excerpt) details.push(`<div><b>خلاصه:</b> ${esc(item.excerpt)}</div>`);
  }
  if (categories) details.push(`<div><b>دسته‌بندی:</b> ${categories}</div>`);
  if (permalink) details.push(`<div><b>نشانی:</b> <a href="${esc(permalink)}" target="_blank" rel="noopener noreferrer" dir="ltr">مشاهده در سایت مبدأ</a></div>`);

  const overlay = document.createElement('div');
  overlay.setAttribute('data-postyar-campaign-detail', '');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(8,14,30,.66);display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-label="مشاهده محتوا" style="width:min(700px,100%);max-height:90vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#1e293b);border:1px solid var(--border,#ddd);border-radius:16px;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.28)"><header style="display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:14px"><strong style="font-size:16px;line-height:1.8">${title}</strong><button type="button" data-campaign-detail-close class="btn btn-soft">بستن</button></header>${imageMarkup}<div style="display:grid;gap:8px;font-size:12.5px;line-height:1.9">${details.join('') || '<div>اطلاعات تکمیلی ثبت نشده است.</div>'}</div><div style="margin-top:14px;padding:12px;border-radius:12px;background:var(--surface-2);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.9">${esc(description || 'متنی برای نمایش ثبت نشده است.')}</div></section>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  };
  const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || (event.target instanceof Element && event.target.closest('[data-campaign-detail-close]'))) close();
  });
  document.addEventListener('keydown', onKeydown);
  document.body.append(overlay);
  overlay.querySelector<HTMLButtonElement>('[data-campaign-detail-close]')?.focus();
}

async function loadCampaignPicker(root: HTMLElement) {
  const type = root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product';
  const area = root.querySelector<HTMLElement>('[data-campaign-picker-area]');
  if (!area) return;
  const siteId = root.querySelector<HTMLSelectElement>('[data-campaign-site]')?.value ?? campaignPickerSiteId;
  
  const query = root.querySelector<HTMLInputElement>('[data-campaign-picker-search]')?.value.trim() ?? '';
  campaignPickerSiteId = siteId;
  if (!siteId) { const list = area.querySelector<HTMLElement>('[data-campaign-picker-list]'); if (list) list.innerHTML = '<div class="wp-template-preview">ابتدا یک وب‌سایت را انتخاب کنید.</div>'; return; }
  const list = area.querySelector<HTMLElement>('[data-campaign-picker-list]');
  if (!list) return;
  list.innerHTML = '<div class="wp-template-preview">در حال دریافت فهرست…</div>';
  try {
    const endpoint = type === 'product' ? '/api/v1/wordpress/products' : '/api/v1/wordpress/contents';
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    params.set('siteId', siteId);
    if (query) params.set('q', query);
    const contentKind = root.querySelector<HTMLSelectElement>('[data-campaign-content-kind]')?.value ?? 'all';
    if (type === 'content' && (contentKind === 'post' || contentKind === 'page')) params.set('contentType', contentKind);
    const data = await request<{ items?: AnyRecord[]; total?: number }>(`${endpoint}?${params.toString()}`);
    const items = data.items ?? [];
    if (!items.length) {
      list.innerHTML = '<div class="wp-template-preview">موردی پیدا نشد.</div>';
      return;
    }
    list.innerHTML = `<div style="display:grid;gap:8px">${items.map((item) => {
      const numericId = Number(type === 'product' ? item.wcProductId : item.contentId);
      const checked = campaignPickerIds.includes(numericId);
      const sub = type === 'product'
        ? `${esc(faNum(item.priceRial ?? ''))} · ${esc(item.permalink ?? '')}`
        : esc(String(item.excerpt ?? item.body ?? '').replace(/\s+/g, ' ').slice(0, 120));
      const image = String(item.customImageUrl ?? item.imageUrl ?? '').trim();
      const contentLabel = item.contentType === 'page' ? 'برگه' : 'نوشته / مقاله';
      return `<div style="display:grid;grid-template-columns:18px 54px minmax(0,1fr) auto;gap:9px;align-items:center;padding:10px 11px;border:1px solid var(--border);border-radius:11px;background:var(--surface)"><input type="checkbox" aria-label="انتخاب ${esc(item.title)}" data-campaign-picker-id="${esc(numericId)}"${checked ? ' checked' : ''}>${image ? `<img src="${esc(image)}" alt="" loading="lazy" style="width:54px;height:54px;object-fit:cover;border-radius:8px;background:var(--surface-2)">` : `<span style="width:54px;height:54px;display:grid;place-items:center;border-radius:8px;background:var(--surface-2);font-size:10px;color:var(--text-2)">${type === 'product' ? 'محصول' : contentLabel}</span>`}<span style="min-width:0"><strong style="display:block;font-size:12.5px">${esc(item.title)}</strong><small style="display:block;color:var(--text-2);margin-top:4px;line-height:1.7">${sub}</small></span><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="badge">${type === 'product' ? 'محصول' : contentLabel}</span><button type="button" class="btn btn-soft" data-campaign-view-id="${esc(numericId)}">مشاهده</button></div></div>`;
    }).join('')}</div>`;
    list.querySelectorAll<HTMLButtonElement>('[data-campaign-view-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.campaignViewId);
        const item = items.find((entry) => Number(type === 'product' ? entry.wcProductId : entry.contentId) === id);
        if (item) showCampaignPickerDetail(item, type);
      });
    });
    list.querySelectorAll<HTMLInputElement>('[data-campaign-picker-id]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = Number(input.dataset.campaignPickerId);
        if (!Number.isFinite(id)) return;
        if (input.checked) {
          if (!campaignPickerIds.includes(id) && campaignPickerIds.length < 20) campaignPickerIds.push(id);
          else if (campaignPickerIds.length >= 20) input.checked = false;
        } else {
          campaignPickerIds = campaignPickerIds.filter((x) => x !== id);
        }
        const countEl = area.querySelector<HTMLElement>('[data-campaign-selected-count]');
        if (countEl) countEl.textContent = `${faNum(campaignPickerIds.length)} انتخاب`;
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="wp-template-preview">${esc(error instanceof Error ? error.message : 'دریافت فهرست ناموفق بود.')}</div>`;
  }
}

async function loadCampaignCategories(root: HTMLElement) {
  const type = root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product';
  const area = root.querySelector<HTMLElement>('[data-campaign-picker-area]');
  const siteId = root.querySelector<HTMLSelectElement>('[data-campaign-site]')?.value ?? '';
  const list = area?.querySelector<HTMLElement>('[data-campaign-picker-list]');
  if (!area || !list) return;
  if (!siteId) { list.innerHTML = '<div class="wp-template-preview">ابتدا یک وب‌سایت را انتخاب کنید.</div>'; return; }
  list.innerHTML = '<div class="wp-template-preview">در حال دریافت دسته‌بندی‌ها…</div>';
  try {
    const endpoint = type === 'product' ? '/api/v1/wordpress/products/categories' : '/api/v1/wordpress/contents/categories';
    const params = new URLSearchParams({ siteId });
    const contentKind = root.querySelector<HTMLSelectElement>('[data-campaign-content-kind]')?.value ?? 'all';
    if (type === 'content' && (contentKind === 'post' || contentKind === 'page')) params.set('contentType', contentKind);
    const data = await request<{ items?: Array<{ id: number; name: string; slug?: string }> }>(`${endpoint}?${params.toString()}`);
    const items = data.items ?? [];
    if (!items.length) { list.innerHTML = '<div class="wp-template-preview">برای این سایت دسته‌بندی همگام‌شده‌ای پیدا نشد. ابتدا محتوا را از افزونه وردپرس همگام‌سازی کنید.</div>'; return; }
    list.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">${items.map((item) => `<label style="display:flex;gap:8px;align-items:center;border:1px solid var(--border);padding:9px 10px;border-radius:10px"><input type="checkbox" data-campaign-category-id="${Number(item.id)}"${campaignPickerIds.includes(Number(item.id)) ? ' checked' : ''}><span>${esc(item.name)}</span></label>`).join('')}</div>`;
    list.querySelectorAll<HTMLInputElement>('[data-campaign-category-id]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = Number(input.dataset.campaignCategoryId);
        if (!Number.isInteger(id) || id < 1) return;
        if (input.checked) {
          if (!campaignPickerIds.includes(id) && campaignPickerIds.length < 20) campaignPickerIds.push(id);
          else if (campaignPickerIds.length >= 20) input.checked = false;
        } else campaignPickerIds = campaignPickerIds.filter((x) => x !== id);
        const countEl = area.querySelector<HTMLElement>('[data-campaign-selected-count]');
        if (countEl) countEl.textContent = `${faNum(campaignPickerIds.length)} دسته`;
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="wp-template-preview">${esc(error instanceof Error ? error.message : 'دریافت دسته‌بندی‌ها ناموفق بود.')}</div>`;
  }
}

function syncCampaignPickerFromForm(_root: HTMLElement, state: NonNullable<typeof stateCache>) {
  const item = editingCampaignId ? state.campaigns.find((x) => x.id === editingCampaignId) : null;
  campaignPickerIds = (item?.selectionIdsJson ?? []).map((x) => Number(x)).filter(Number.isFinite).slice(0, 20);
  campaignPickerSiteId = item?.siteId ?? state.sites[0]?.id ?? '';
}

function renderCampaignForm(state: NonNullable<typeof stateCache>): string {
  const item = editingCampaignId ? state.campaigns.find((x) => x.id === editingCampaignId) : null;
  const itemType = item?.itemType ?? 'product';
  const days = new Set((item?.daysJson ?? []).map(String));
  const selectedChannels = new Set((item?.channelIdsJson ?? []).map(String));
  const templateId = item?.templateId ?? '';
  return `<div class="wp-template-setting-box"><strong>${editingCampaignId ? 'ویرایش کمپین' : 'ساخت کمپین خودکار'}</strong><div class="wp-campaign-form"><div class="wp-form-two"><label class="field"><span class="field-label">نام کمپین</span><input class="input" data-campaign-name maxlength="120" value="${esc(item?.name ?? '')}" placeholder="مثلاً فروش ویژه روزانه"></label><label class="field"><span class="field-label">فروشگاه</span><select class="input" data-campaign-site>${state.sites.map((site) => `<option value="${esc(site.id)}"${site.id === item?.siteId ? ' selected' : ''}>${esc(site.siteUrl)}</option>`).join('')}</select></label></div><div class="wp-form-two"><label class="field"><span class="field-label">نوع محتوا</span><select class="input" data-campaign-type><option value="product"${itemType === 'product' ? ' selected' : ''}>محصول فروشگاه</option><option value="content"${itemType === 'content' ? ' selected' : ''}>محتوای وردپرس</option></select></label><label class="field"><span class="field-label">نحوه انتخاب</span><select class="input" data-campaign-selection>${campaignSelections(itemType, item?.selectionType ?? 'latest')}</select></label></div><div class="wp-form-two"><label class="field"><span class="field-label">قالب پیام (آماده یا اختصاصی)</span><select class="input" data-campaign-template><option value="">قالب پیش‌فرض</option>${state.templates.map((tpl) => `<option value="${esc(tpl.id)}"${tpl.id === templateId ? ' selected' : ''}>${esc(tpl.name)}</option>`).join('')}</select><button type="button" class="btn btn-ghost" data-campaign-open-templates style="margin-top:6px">مدیریت و ساخت قالب‌ها</button></label><label class="field"><span class="field-label">تعداد هر اجرا (۱ تا ۲۰)</span><input class="input" data-campaign-count type="text" inputmode="numeric" pattern="[۰-۹0-9]*" value="${faNum(item?.itemCount ?? 3).replace(/٬/g, '')}" aria-label="تعداد هر اجرا" maxlength="2"></label></div><div class="wp-form-two"><label class="field"><span class="field-label">تکرار</span><select class="input" data-campaign-frequency><option value="daily"${item?.frequency !== 'weekly' ? ' selected' : ''}>روزانه</option><option value="weekly"${item?.frequency === 'weekly' ? ' selected' : ''}>هفتگی</option></select></label><label class="field"><span class="field-label">ساعت ارسال</span><input class="input" data-campaign-time type="text" inputmode="numeric" pattern="[۰-۹0-9:]*" value="${esc(item?.sendTime ?? '12:00')}"></label></div><div class="wp-campaign-channels"><span class="field-label">کانال‌های مقصد</span><div class="wp-check-grid">${state.channels.filter((ch) => ch.status === 'ACTIVE').map((ch) => `<label><input type="checkbox" data-campaign-channel value="${esc(ch.id)}"${selectedChannels.has(ch.id) ? ' checked' : ''}><span>${esc(ch.title)}</span><small style="color:var(--text-2)">${esc(PLATFORM_LABEL[ch.platform] ?? ch.platform)}</small></label>`).join('')}</div></div><div class="wp-campaign-channels"><span class="field-label">روزهای هفته برای کمپین هفتگی</span><div class="wp-check-grid">${Object.entries(DAY_LABEL).map(([key, label]) => `<label><input type="checkbox" data-campaign-day value="${key}"${days.has(key) ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></div>${(item?.selectionType ?? 'latest') === 'manual' ? renderCampaignPickerPlaceholder(itemType) : (item?.selectionType ?? 'latest') === 'category' ? renderCampaignCategoryPickerPlaceholder(itemType) : ''}<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px"><button type="button" class="btn btn-soft" data-campaign-preview>پیش‌نمایش ترکیب کمپین</button><span class="badge">قالب + نوع محتوا</span></div><div class="wp-template-preview" data-campaign-preview-box style="display:none;margin-top:10px;white-space:pre-wrap"></div></div><label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" data-campaign-enabled${item?.isEnabled === undefined || bool(item?.isEnabled) ? ' checked' : ''}>فعال بودن کمپین</label><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary" data-campaign-save>${editingCampaignId ? 'ذخیره تغییرات' : 'ساخت کمپین'}</button>${editingCampaignId ? '<button type="button" class="btn btn-ghost" data-campaign-cancel>انصراف</button>' : ''}</div></div></div>`;
}

function renderWordPressAnalytics(analytics: WordPressAnalytics | null): string {
  if (!analytics) return '';
  const products = analytics.products ?? { synced: 0, published: 0, failed: 0 };
  const contents = analytics.contents ?? { synced: 0, published: 0, failed: 0 };
  const campaigns = analytics.campaigns ?? { total: 0, active: 0, runs: 0, failedRuns: 0, queued: 0, items: [] };
  const stat = (label: string, value: unknown) => `<div class="wp-template-preview" style="padding:10px 12px;min-width:120px"><strong style="display:block;font-size:16px">${faNum(value)}</strong><span style="font-size:11.5px;color:var(--text-2)">${label}</span></div>`;
  return `<div class="wp-card-head" style="margin-top:10px"><div><h3 style="font-size:15px;margin:0">نمای تحلیلی ۳۰ روز اخیر</h3><p>آمار فروشگاه، محتوا و کمپین‌ها از همان موتور تحلیل مرکزی.</p></div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${stat('محصول منتشرشده', products.published)}${stat('محتوای منتشرشده', contents.published)}${stat('اجرای موفق کمپین', campaigns.runs)}${stat('اجرای ناموفق کمپین', campaigns.failedRuns)}${stat('مورد وارد صف', campaigns.queued)}</div>`;
}

async function renderCampaignAnalyticsDetails(root: HTMLElement, campaignId: string, name: string, siteName: string) {
  type CampaignEvent = { eventType: string; platform?: string | null; count: number; value: number };
  type RecentEvent = {
    id: string;
    occurredAt: string | Date;
    eventType: string;
    platform?: string | null;
    postTitle?: string | null;
    channelTitle?: string | null;
    targetState?: string | null;
    attempts?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    sentAt?: string | Date | null;
    metadata?: AnyRecord | null;
  };
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const existing = document.querySelector<HTMLElement>('[data-campaign-analytics-modal="1"]');
  existing?.remove();
  const previousOverflow = document.body.style.overflow;
  const overlay = document.createElement('div');
  overlay.className = 'wp-campaign-report-backdrop';
  overlay.dataset.campaignAnalyticsModal = '1';
  overlay.innerHTML = `<section class="wp-campaign-report" role="dialog" aria-modal="true" aria-labelledby="wp-campaign-report-title" tabindex="-1"><header class="wp-campaign-report__head"><div class="wp-campaign-report__identity"><span class="wp-campaign-report__eyebrow">گزارش تحلیلی کمپین</span><h2 id="wp-campaign-report-title">${esc(name)}</h2><div class="wp-campaign-report__context"><span>${esc(siteName || 'وب‌سایت متصل')}</span><span>بازهٔ ۳۰ روز اخیر</span><span>جزئیات بر پایهٔ رویدادهای ثبت‌شده</span></div></div><button type="button" class="wp-campaign-report__close" data-campaign-report-close aria-label="بستن گزارش">بستن <span aria-hidden="true">×</span></button></header><div class="wp-campaign-report__body"><div class="wp-campaign-report__loading" role="status"><span class="wp-campaign-report__spinner" aria-hidden="true"></span><strong>در حال آماده‌سازی گزارش کمپین</strong><span>آمار تحویل و آخرین رویدادها دریافت می‌شود.</span></div></div><footer class="wp-campaign-report__footer"><span>پُست‌یار · گزارش کمپین</span><button type="button" class="btn btn-soft" data-campaign-report-close>بستن گزارش</button></footer></section>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const closeReport = () => {
    document.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = previousOverflow;
    overlay.remove();
    previousFocus?.focus();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeReport(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); overlay.querySelector<HTMLElement>('.wp-campaign-report')?.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  overlay.addEventListener('click', (event) => {
    const target = event.target;
    if (target === overlay || (target instanceof Element && target.closest('[data-campaign-report-close]'))) closeReport();
  });
  document.addEventListener('keydown', onKeydown);
  overlay.querySelector<HTMLButtonElement>('[data-campaign-report-close]')?.focus();

  const body = overlay.querySelector<HTMLElement>('.wp-campaign-report__body');
  if (!body) return;
  try {
    const data = await request<{ days: number; campaignId: string; campaign?: AnyRecord; events: CampaignEvent[]; recent?: RecentEvent[] }>(`/api/v1/analytics/campaigns/${encodeURIComponent(campaignId)}?days=30`);
    const eventRows = Array.isArray(data.events) ? data.events : [];
    const total = eventRows.reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);
    const sumEvent = (kind: string) => eventRows.filter((row) => row.eventType === kind).reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);
    const delivered = sumEvent('post.delivery.sent');
    const failed = sumEvent('post.delivery.failed');
    const queued = sumEvent('post.delivery.queued') + sumEvent('wordpress.campaign.queued');
    const runs = sumEvent('wordpress.campaign.run');
    const attempts = delivered + failed;
    const successRate = attempts > 0 ? `${faNum(Math.round((delivered / attempts) * 100))}٪` : '—';
    const labelEvent = (kind: string) => ({
      'post.delivery.sent': 'تحویل موفق',
      'post.delivery.failed': 'تحویل ناموفق',
      'post.delivery.queued': 'ورود به صف ارسال',
      'post.delivery.retrying': 'تلاش مجدد ارسال',
      'wordpress.product.synced': 'همگام‌سازی محصول',
      'wordpress.content.synced': 'همگام‌سازی نوشته یا برگه',
      'wordpress.campaign.run': 'اجرای کمپین',
      'wordpress.campaign.queued': 'آیتم کمپین در صف',
    } as Record<string, string>)[kind] ?? 'سایر رویدادها';
    const labelState = (value: string | null | undefined) => ({ SENT: 'ارسال‌شده', FAILED: 'ناموفق', PENDING: 'در انتظار', QUEUED: 'در صف', PUBLISHING: 'در حال ارسال', RETRYING: 'تلاش مجدد', CANCELLED: 'لغوشده', PARTIAL: 'ناقص', SCHEDULED: 'زمان‌بندی‌شده' } as Record<string, string>)[String(value ?? '').toUpperCase()] ?? (value || 'ثبت نشده');
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const groups = new Map<string, { label: string; count: number; platform: string }>();
    for (const row of eventRows) {
      const platform = row.platform ? String(PLATFORM_LABEL[row.platform] ?? '') : '';
      const label = labelEvent(row.eventType);
      const key = `${label}|${platform}`;
      const previous = groups.get(key);
      groups.set(key, { label, platform, count: (previous?.count ?? 0) + Math.max(0, Number(row.count || 0)) });
    }
    const rows = Array.from(groups.values()).sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...rows.map((row) => row.count));
    const breakdown = rows.length ? `<div class="wp-campaign-report__breakdown">${rows.map((row) => {
      const width = Math.max(3, Math.min(100, Math.round((row.count / maxCount) * 100)));
      return `<div class="wp-campaign-report__breakdown-row"><div class="wp-campaign-report__breakdown-label"><span>${esc(row.label)}${row.platform ? `<small>${esc(row.platform)}</small>` : ''}</span><strong>${faNum(row.count)}</strong></div><div class="wp-campaign-report__track" aria-label="${esc(row.label)}: ${faNum(row.count)}"><span style="width:${width}%"></span></div></div>`;
    }).join('')}</div>` : '<div class="wp-campaign-report__empty"><strong>هنوز رویدادی ثبت نشده است</strong><span>پس از اجرای کمپین، آمار به‌محض ثبت رویدادهای واقعی در این گزارش نمایش داده می‌شود.</span></div>';
    const errorText = (event: RecentEvent) => [event.errorCode, event.errorMessage].filter(Boolean).join(' — ');
    const eventTitle = (event: RecentEvent) => String(event.postTitle || event.metadata?.title || event.metadata?.productTitle || event.metadata?.contentTitle || 'محتوای بدون عنوان');
    const safeMetadata = (event: RecentEvent) => event.metadata ? Object.entries(event.metadata)
      .filter(([key, val]) => !/secret|token|password|credential|api[_-]?key/i.test(key) && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'))
      .map(([key, val]) => `${key}: ${String(val)}`).slice(0, 3).join(' · ') : '';
    const recentCards = recent.length ? `<div class="wp-campaign-report__event-cards">${recent.map((event) => {
      const error = errorText(event);
      return `<article class="wp-campaign-report__event-card"><div class="wp-campaign-report__event-card-head"><strong>${esc(labelEvent(event.eventType))}</strong><span class="wp-campaign-report__state ${String(event.targetState ?? '').toUpperCase() === 'FAILED' ? 'is-failed' : String(event.targetState ?? '').toUpperCase() === 'SENT' ? 'is-success' : ''}">${esc(labelState(event.targetState))}</span></div><div class="wp-campaign-report__event-title">${esc(eventTitle(event))}</div><div class="wp-campaign-report__event-meta"><span>${esc(faDateTime(event.occurredAt))}</span><span>${esc(event.channelTitle || 'بدون کانال')}</span>${event.platform ? `<span>${esc(PLATFORM_LABEL[event.platform] ?? 'پلتفرم')}</span>` : ''}</div><div class="wp-campaign-report__event-foot"><span>تلاش: ${faNum(event.attempts ?? 0)}</span>${error ? `<span class="is-error">${esc(error)}</span>` : `<span>${esc(safeMetadata(event) || 'بدون خطای ثبت‌شده')}</span>`}</div></article>`;
    }).join('')}</div>` : '<div class="wp-campaign-report__empty"><strong>رخداد جزئی برای این کمپین موجود نیست</strong><span>این مورد به‌تنهایی نشان‌دهندهٔ موفقیت ارسال نیست؛ وضعیت صف و تحویل را نیز بررسی کنید.</span></div>';
    const recentTable = recent.length ? `<div class="wp-campaign-report__table-wrap"><table class="wp-campaign-report__table"><thead><tr><th>زمان</th><th>رویداد</th><th>محتوا</th><th>کانال</th><th>وضعیت</th><th>تلاش</th><th>جزئیات</th></tr></thead><tbody>${recent.map((event) => {
      const error = errorText(event);
      return `<tr><td>${esc(faDateTime(event.occurredAt))}</td><td>${esc(labelEvent(event.eventType))}${event.platform ? `<small>${esc(PLATFORM_LABEL[event.platform] ?? 'پلتفرم')}</small>` : ''}</td><td>${esc(eventTitle(event))}</td><td>${esc(event.channelTitle || '—')}</td><td><span class="wp-campaign-report__state ${String(event.targetState ?? '').toUpperCase() === 'FAILED' ? 'is-failed' : String(event.targetState ?? '').toUpperCase() === 'SENT' ? 'is-success' : ''}">${esc(labelState(event.targetState))}</span></td><td>${faNum(event.attempts ?? 0)}</td><td class="wp-campaign-report__error-cell">${error ? `<span class="is-error">${esc(error)}</span>` : esc(safeMetadata(event) || '—')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';
    const days = Number(data.days) > 0 ? Number(data.days) : 30;
    body.innerHTML = `<div class="wp-campaign-report__intro"><div><span class="wp-campaign-report__eyebrow">خلاصهٔ عملکرد</span><h3>عملکرد کمپین در ${faNum(days)} روز گذشته</h3><p>آمار از رویدادهای ثبت‌شده استخراج شده است؛ نرخ تحویل بر پایهٔ تحویل موفق و ناموفق محاسبه می‌شود.</p></div><span class="wp-campaign-report__live"><i aria-hidden="true"></i> گزارش داده‌های ثبت‌شده</span></div><div class="wp-campaign-report__kpis"><article class="wp-campaign-report__kpi"><span>کل رویدادها</span><strong>${faNum(total)}</strong><small>همهٔ رخدادهای ثبت‌شده</small></article><article class="wp-campaign-report__kpi is-success"><span>تحویل موفق</span><strong>${faNum(delivered)}</strong><small>پیام‌های تأییدشده</small></article><article class="wp-campaign-report__kpi is-failed"><span>تحویل ناموفق</span><strong>${faNum(failed)}</strong><small>موارد دارای شکست ثبت‌شده</small></article><article class="wp-campaign-report__kpi is-rate"><span>نرخ موفقیت تحویل</span><strong>${successRate}</strong><small>${attempts ? `از ${faNum(attempts)} تلاش موفق یا ناموفق` : 'با ثبت تحویل قابل محاسبه است'}</small></article></div><div class="wp-campaign-report__secondary"><div><span>اجرای ثبت‌شدهٔ کمپین</span><strong>${faNum(runs)}</strong></div><div><span>موارد موجود در صف</span><strong>${faNum(queued)}</strong></div><div><span>آخرین رخداد دریافت‌شده</span><strong>${recent[0] ? esc(faDateTime(recent[0].occurredAt)) : '—'}</strong></div></div><div class="wp-campaign-report__section"><div class="wp-campaign-report__section-head"><div><h3>توزیع رویدادها</h3><p>مقایسهٔ تعداد رخدادهای هر نوع و پلتفرم</p></div><span class="wp-campaign-report__section-count">${faNum(rows.length)} گروه</span></div>${breakdown}</div><div class="wp-campaign-report__section"><div class="wp-campaign-report__section-head"><div><h3>آخرین رویدادها و وضعیت تحویل</h3><p>حداکثر ۱۰۰ رخداد اخیر مرتبط با این کمپین</p></div><span class="wp-campaign-report__section-count">${faNum(recent.length)} رخداد</span></div><div class="wp-campaign-report__desktop-events">${recentTable}</div>${recentCards}</div>`;
    body.scrollTop = 0;
  } catch (error) {
    body.innerHTML = `<div class="wp-campaign-report__error" role="alert"><strong>دریافت گزارش کمپین انجام نشد</strong><p>${esc(error instanceof Error ? error.message : 'خطای ناشناخته')}</p><button type="button" class="btn btn-soft" data-campaign-report-retry>تلاش مجدد</button></div>`;
    body.querySelector<HTMLButtonElement>('[data-campaign-report-retry]')?.addEventListener('click', () => {
      closeReport();
      const site = siteName || 'وب‌سایت متصل';
      void renderCampaignAnalyticsDetails(root, campaignId, name, site);
    });
  }
}
function renderCampaignCards(campaigns: CampaignRow[], sites: AnyRecord[]): string {
  if (!campaigns.length) return '<div class="wp-template-preview">هنوز کمپینی ساخته نشده است.</div>';
  const siteName = (id: string) => String(sites.find((site) => site.id === id)?.siteUrl ?? id);
  return `<div class="wp-campaign-list">${campaigns.map((item) => {
    const result = item.lastResultJson ? `آخرین اجرا: ${faNum(item.lastResultJson.queued ?? 0)} صف، ${faNum(item.lastResultJson.items ?? 0)} آیتم` : 'هنوز اجرا نشده است.';
    const state = bool(item.isEnabled) ? 'فعال' : 'خاموش';
    const metric = stateCache?.analytics?.campaigns?.items?.find((entry) => String(entry.id) === String(item.id));
    const metricText = metric ? ` | ۳۰ روز: ${faNum(metric.runs ?? 0)} اجرای موفق، ${faNum(metric.failedRuns ?? 0)} خطا، ${faNum(metric.delivered ?? 0)} تحویل` : '';
    return `<article class="wp-campaign-card" data-campaign-id="${esc(item.id)}"><div class="wp-campaign-main"><div class="wp-item-top"><strong>${esc(item.name)}</strong><span class="badge">${state}</span></div><div class="wp-item-sub"><span>${esc(siteName(item.siteId))}</span><span>${item.itemType === 'product' ? 'محصول' : 'محتوا'}</span><span>${item.frequency === 'weekly' ? 'هفتگی' : 'روزانه'} ساعت ${esc(item.sendTime)}</span><span>هر اجرا: ${faNum(item.itemCount)}</span></div><div class="wp-campaign-result">${esc(result + metricText)}${item.lastRunAt ? ` — آخرین اجرا ${esc(faDateTime(item.lastRunAt))}` : ''}</div></div><div class="wp-campaign-actions"><button type="button" class="btn btn-soft" data-campaign-run="${esc(item.id)}">اجرای فوری</button><button type="button" class="btn btn-ghost" data-campaign-analytics="${esc(item.id)}">تحلیل</button><button type="button" class="btn btn-ghost" data-campaign-edit="${esc(item.id)}">ویرایش</button><button type="button" class="btn btn-ghost" data-campaign-toggle="${esc(item.id)}">${bool(item.isEnabled) ? 'خاموش کردن' : 'فعال کردن'}</button><button type="button" class="btn btn-danger" data-campaign-delete="${esc(item.id)}">حذف</button></div></article>`;
  }).join('')}</div>`;
}

function renderCampaignTemplateManager(state: NonNullable<typeof stateCache>): string {
  const item = editingTemplateId ? state.templates.find((template) => template.id === editingTemplateId) : null;
  const list = state.templates.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:10px;margin-top:12px">${state.templates.map((template) => `<article style="min-width:0;border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><strong style="font-size:13px;overflow-wrap:anywhere">${esc(template.name)}</strong>${bool(template.isDefault) ? '<span class="badge">آماده</span>' : ''}</div><div style="color:var(--text-2);font-size:11.5px;margin-top:4px">${esc(template.category || 'عمومی')}${template.description ? ` · ${esc(template.description)}` : ''}</div><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;line-height:1.9;max-height:130px;overflow:auto;padding:9px;border-radius:9px;background:var(--surface-2);margin:10px 0">${esc(template.body)}</pre><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn btn-soft" data-template-edit="${esc(template.id)}">ویرایش</button><button type="button" class="btn btn-ghost" data-template-copy="${esc(template.id)}">کپی متن</button>${bool(template.isDefault) ? '' : `<button type="button" class="btn btn-danger" data-template-delete="${esc(template.id)}">حذف</button>`}</div></article>`).join('')}</div>`
    : '<div class="wp-template-preview" style="margin-top:12px">هنوز قالبی ساخته نشده است. می‌توانید قالب اختصاصی بسازید یا قالب‌های فعلی را از همین بخش مدیریت کنید.</div>';
  const tags = state.tags.map((tag) => ({ code: String(tag.code ?? ''), label: String(tag.label ?? tag.code ?? '') })).filter((tag) => tag.code).slice(0, 48);
  const editor = templateEditorOpen ? `<div class="wp-template-setting-box" data-template-editor style="margin-top:14px;border:1px solid var(--brand);background:var(--surface-2)"><div class="wp-card-head"><div><strong>${item ? 'ویرایش قالب' : 'ساخت قالب جدید'}</strong><p>قالب‌ها در فرم ساخت کمپین نیز قابل انتخاب هستند. نشانگرها را می‌توانید از فهرست زیر وارد متن کنید.</p></div></div><div class="wp-campaign-form"><div class="wp-form-two"><label class="field"><span class="field-label">نام قالب</span><input class="input" data-template-name maxlength="120" value="${esc(item?.name ?? '')}" placeholder="مثلاً قالب معرفی مقاله"></label><label class="field"><span class="field-label">دسته‌بندی</span><input class="input" data-template-category maxlength="40" value="${esc(item?.category ?? 'عمومی')}" placeholder="عمومی، فروش یا محتوا"></label></div><label class="field"><span class="field-label">توضیح کوتاه</span><input class="input" data-template-description maxlength="255" value="${esc(item?.description ?? '')}" placeholder="کاربرد قالب"></label><label class="field"><span class="field-label">متن قالب</span><textarea class="input" data-template-body rows="9" maxlength="12000" style="width:100%;box-sizing:border-box;line-height:2;resize:vertical" placeholder="متن پیام و نشانگرهای موردنیاز را وارد کنید">${esc(item?.body ?? '')}</textarea></label><div><span class="field-label">نشانگرهای قابل درج</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${tags.map((tag) => `<button type="button" class="btn btn-ghost" data-template-tag="${esc(tag.code)}" title="${esc(tag.label)}" style="font-size:11px">${esc(tag.code)}</button>`).join('')}</div></div><div style="display:flex;gap:7px;flex-wrap:wrap"><button type="button" class="btn btn-soft" data-template-preview>پیش‌نمایش</button><button type="button" class="btn btn-primary" data-template-save>ذخیره قالب</button><button type="button" class="btn btn-ghost" data-template-cancel>انصراف</button></div><div class="wp-template-preview" data-template-preview-box style="display:none;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin-top:8px"></div></div></div>` : '';
  return `<section class="wp-template-setting-box" data-campaign-template-manager style="margin-top:18px"><div class="wp-card-head"><div><h2 style="font-size:17px;margin:0">قالب‌های پیام کمپین</h2><p>قالب‌های آماده و اختصاصی را در همین بخش مدیریت کنید؛ قالب ذخیره‌شده در فهرست انتخاب کمپین در دسترس است.</p></div><button type="button" class="btn btn-primary" data-template-new>+ قالب جدید</button></div>${list}${editor}</section>`;
}

function hydrateStateIntoRoot(root: HTMLElement, state: NonNullable<typeof stateCache>) {
  syncCampaignPickerFromForm(root, state);
  const warning = state.issues.length
    ? `<div class="wp-tools-warning" role="status"><strong>بخشی از اطلاعات بارگذاری نشد؛ سایر امکانات در دسترس هستند.</strong><ul>${state.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul><button type="button" class="btn btn-ghost" data-wp-tools-retry style="margin-top:8px">دریافت دوباره اطلاعات</button></div>`
    : '';
  root.innerHTML = `${warning}<div class="wp-card-head"><div><h1 style="font-size:21px;margin:0">کمپین‌ها</h1><p>ساخت، زمان‌بندی، اجرای دستی و پایش دقیق کمپین‌های متصل به وب‌سایت.</p></div><span class="badge">${faNum(state.campaigns.length)} کمپین</span></div>${renderWordPressAnalytics(state.analytics)}${renderCampaignCards(state.campaigns, state.sites)}<div style="margin-top:13px">${renderCampaignForm(state)}</div>${renderCampaignTemplateManager(state)}`;
  root.querySelector<HTMLElement>('[data-wp-tools-retry]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      stateCache = await loadState(true);
      hydrateStateIntoRoot(root, stateCache);
    } catch (error) {
      showMessage(root, error instanceof Error ? error.message : 'دریافت دوباره اطلاعات ناموفق بود.');
      button.disabled = false;
    }
  });
  bindTemplateActions(root, state);
  bindCampaignActions(root, state);
}

function bindTemplateActions(root: HTMLElement, state: NonNullable<typeof stateCache>) {
  root.querySelectorAll<HTMLElement>('[data-template-copy]').forEach((button) => {
    button.onclick = () => {
      const item = state.templates.find((x) => x.id === button.dataset.templateCopy);
      if (!item) return;
      void copyTextCompat(item.body).then(() => showMessage(root, 'متن قالب کپی شد.', 'ok')).catch(() => showMessage(root, 'کپی خودکار انجام نشد.'));
    };
  });
  root.querySelector<HTMLElement>('[data-template-new]')?.addEventListener('click', () => {
    editingTemplateId = null;
    templateEditorOpen = true;
    hydrateStateIntoRoot(root, state);
    root.querySelector<HTMLElement>('[data-template-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    root.querySelector<HTMLInputElement>('[data-template-name]')?.focus();
  });
  root.querySelector<HTMLElement>('[data-campaign-open-templates]')?.addEventListener('click', () => {
    editingTemplateId = null;
    templateEditorOpen = true;
    hydrateStateIntoRoot(root, state);
    root.querySelector<HTMLElement>('[data-campaign-template-manager]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    root.querySelector<HTMLInputElement>('[data-template-name]')?.focus();
  });
  root.querySelectorAll<HTMLElement>('[data-template-edit]').forEach((button) => {
    button.onclick = () => {
      editingTemplateId = button.dataset.templateEdit ?? null;
      templateEditorOpen = true;
      hydrateStateIntoRoot(root, state);
      const item = state.templates.find((x) => x.id === editingTemplateId);
      if (item) templateDataToForm(root, item);
      root.querySelector<HTMLElement>('[data-template-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
  root.querySelectorAll<HTMLElement>('[data-template-delete]').forEach((button) => {
    button.onclick = () => {
      const item = state.templates.find((x) => x.id === button.dataset.templateDelete);
      if (!item || !window.confirm(`قالب «${item.name}» حذف شود؟`)) return;
      void request(`/api/v1/templates/${encodeURIComponent(item.id)}`, 'DELETE').then(async () => {
        stateCache = await loadState(true);
        if (stateCache) hydrateStateIntoRoot(root, stateCache);
        showMessage(root, 'قالب حذف شد.', 'ok');
      }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'حذف قالب ناموفق بود.'));
    };
  });
  root.querySelectorAll<HTMLElement>('[data-template-tag]').forEach((button) => {
    button.onclick = () => {
      const editor = root.querySelector<HTMLTextAreaElement>('[data-template-body]');
      if (!editor) return;
      const tag = button.dataset.templateTag ?? '';
      const start = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? start;
      editor.value = `${editor.value.slice(0, start)}${tag}${editor.value.slice(end)}`;
      editor.focus();
      editor.setSelectionRange(start + tag.length, start + tag.length);
    };
  });
  root.querySelector<HTMLElement>('[data-template-preview]')?.addEventListener('click', () => {
    const body = root.querySelector<HTMLTextAreaElement>('[data-template-body]')?.value.trim() ?? '';
    const itemType = root.querySelector<HTMLSelectElement>('[data-template-preview-type]')?.value === 'content' ? 'content' : 'product';
    const box = root.querySelector<HTMLElement>('[data-template-preview-box]');
    if (!body || !box) { showMessage(root, 'متن قالب برای پیش‌نمایش خالی است.'); return; }
    box.style.display = 'block';
    box.textContent = 'در حال ساخت پیش‌نمایش…';
    void request<{ preview?: string }>('/api/v1/templates/preview', 'POST', { body, itemType })
      .then((result) => { box.textContent = result.preview ?? ''; })
      .catch((error) => { box.textContent = error instanceof Error ? error.message : 'پیش‌نمایش قالب انجام نشد.'; });
  });
  root.querySelector<HTMLElement>('[data-template-cancel]')?.addEventListener('click', () => { editingTemplateId = null; templateEditorOpen = false; hydrateStateIntoRoot(root, state); });
  root.querySelector<HTMLElement>('[data-template-save]')?.addEventListener('click', () => {
    const read = (s: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(s)?.value ?? '';
    const existing = editingTemplateId ? state.templates.find((x) => x.id === editingTemplateId) : null; const payload = { name: read('[data-template-name]').trim(), description: read('[data-template-description]').trim(), body: read('[data-template-body]').trim(), category: read('[data-template-category]').trim() || 'عمومی', settingsJson: existing?.settingsJson ?? {} };
    if (!payload.name || !payload.body) { showMessage(root, 'نام و متن قالب الزامی است.'); return; }
    const method = editingTemplateId ? 'PUT' : 'POST';
    const url = editingTemplateId ? `/api/v1/templates/${encodeURIComponent(editingTemplateId)}` : '/api/v1/templates';
    void request(url, method, payload).then(async () => {
      stateCache = await loadState(true);
      editingTemplateId = null;
      templateEditorOpen = false;
      if (stateCache) hydrateStateIntoRoot(root, stateCache);
      showMessage(root, 'قالب ذخیره شد.', 'ok');
    }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'ذخیره قالب ناموفق بود.'));
  });
}

function refreshSelectionOptions(root: HTMLElement) {
  const type = root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product';
  
  const selection = root.querySelector<HTMLSelectElement>('[data-campaign-selection]');
  if (!selection) return;
  const current = selection.value;
  selection.innerHTML = campaignSelections(type, current);
  if (!Array.from(selection.options).some((opt) => opt.value === current)) selection.value = 'latest';
}

function bindCampaignActions(root: HTMLElement, state: NonNullable<typeof stateCache>) {
  syncCampaignPickerFromForm(root, state);
  const selectionEl = root.querySelector<HTMLSelectElement>('[data-campaign-selection]');
  if (selectionEl?.value === 'manual') void loadCampaignPicker(root);
  if (selectionEl?.value === 'category') void loadCampaignCategories(root);
  root.querySelector<HTMLSelectElement>('[data-campaign-site]')?.addEventListener('change', () => {
    const nextSiteId = root.querySelector<HTMLSelectElement>('[data-campaign-site]')?.value ?? '';
    if (nextSiteId !== campaignPickerSiteId) campaignPickerIds = [];
    campaignPickerSiteId = nextSiteId;
    const mode = root.querySelector<HTMLSelectElement>('[data-campaign-selection]')?.value;
    if (mode === 'manual') void loadCampaignPicker(root);
    if (mode === 'category') void loadCampaignCategories(root);
  });
  root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.addEventListener('change', () => {
    refreshSelectionOptions(root);
    campaignPickerIds = [];
    const mode = root.querySelector<HTMLSelectElement>('[data-campaign-selection]')?.value;
    const host = root.querySelector<HTMLElement>('.wp-campaign-form');
    const oldArea = root.querySelector<HTMLElement>('[data-campaign-picker-area]');
    if (mode === 'manual' || mode === 'category') {
      if (host) {
        oldArea?.remove();
        const box = document.createElement('div');
        box.innerHTML = mode === 'manual' ? renderCampaignPickerPlaceholder(root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product') : renderCampaignCategoryPickerPlaceholder(root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product');
        host.insertBefore(box.firstElementChild as HTMLElement, host.querySelector('[data-campaign-enabled]')?.parentElement ?? null);
      }
      if (mode === 'manual') void loadCampaignPicker(root); else void loadCampaignCategories(root);
    }
  });
  selectionEl?.addEventListener('change', () => {
    campaignPickerIds = [];
    const host = selectionEl.closest('.wp-campaign-form');
    const oldArea = root.querySelector<HTMLElement>('[data-campaign-picker-area]');
    oldArea?.remove();
    if (selectionEl.value === 'manual' || selectionEl.value === 'category') {
      if (host) {
        const box = document.createElement('div');
        box.innerHTML = selectionEl.value === 'manual' ? renderCampaignPickerPlaceholder(root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product') : renderCampaignCategoryPickerPlaceholder(root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product');
        host.insertBefore(box.firstElementChild as HTMLElement, host.querySelector('[data-campaign-enabled]')?.parentElement ?? null);
      }
      if (selectionEl.value === 'manual') void loadCampaignPicker(root); else void loadCampaignCategories(root);
    }
  });
  root.querySelector<HTMLInputElement>('[data-campaign-time]')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const latin = toLatinDigits(input.value).replace(/[^0-9:]/g, '').slice(0, 5);
    input.value = faDigits(latin);
  });
  root.querySelector<HTMLInputElement>('[data-campaign-count]')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    input.value = faDigits(toLatinDigits(input.value).replace(/[^0-9]/g, '').slice(0, 2));
  });
  root.querySelector<HTMLSelectElement>('[data-campaign-content-kind]')?.addEventListener('change', () => {
    const mode = root.querySelector<HTMLSelectElement>('[data-campaign-selection]')?.value;
    if (mode === 'category') void loadCampaignCategories(root); else void loadCampaignPicker(root);
  });
  root.querySelector<HTMLElement>('[data-campaign-picker-search-btn]')?.addEventListener('click', () => void loadCampaignPicker(root));
  root.querySelector<HTMLInputElement>('[data-campaign-picker-search]')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void loadCampaignPicker(root); } });
  root.querySelector<HTMLElement>('[data-campaign-preview]')?.addEventListener('click', () => {
    const templateId = root.querySelector<HTMLSelectElement>('[data-campaign-template]')?.value ?? '';
    const template = state.templates.find((x) => x.id === templateId);
    const body = template?.body ?? '{title}\n\n{description}\n\n🔗 {link}';
    const itemType = root.querySelector<HTMLSelectElement>('[data-campaign-type]')?.value === 'content' ? 'content' : 'product';
    const box = root.querySelector<HTMLElement>('[data-campaign-preview-box]');
    if (!box) return;
    box.style.display = 'block';
    box.textContent = 'در حال ساخت پیش‌نمایش کمپین…';
    void request<{ preview?: string }>('/api/v1/templates/preview', 'POST', { body, itemType })
      .then((result) => { box.textContent = result.preview ?? ''; })
      .catch((error) => { box.textContent = error instanceof Error ? error.message : 'پیش‌نمایش کمپین انجام نشد.'; });
  });
  root.querySelector<HTMLElement>('[data-campaign-cancel]')?.addEventListener('click', () => { editingCampaignId = null; hydrateStateIntoRoot(root, state); });
  root.querySelector<HTMLElement>('[data-campaign-save]')?.addEventListener('click', () => {
    const value = (selector: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? '';
    const itemType = value('[data-campaign-type]') === 'content' ? 'content' : 'product';
    const channelIds = Array.from(root.querySelectorAll<HTMLInputElement>('[data-campaign-channel]:checked')).map((el) => el.value);
    const days = Array.from(root.querySelectorAll<HTMLInputElement>('[data-campaign-day]:checked')).map((el) => el.value);
    const payload = {
      name: value('[data-campaign-name]').trim(),
      siteId: value('[data-campaign-site]'),
      itemType,
      selectionType: value('[data-campaign-selection]') || 'latest',
      selectionIds: ['manual', 'category'].includes(value('[data-campaign-selection]')) ? campaignPickerIds.slice(0, 20) : [],
      templateId: value('[data-campaign-template]') || null,
      channelIds,
      frequency: value('[data-campaign-frequency]') === 'weekly' ? 'weekly' : 'daily',
      sendTime: toLatinDigits(value('[data-campaign-time]') || '12:00'),
      days,
      itemCount: Number(toLatinDigits(value('[data-campaign-count]') || '3').replace(/[^0-9]/g, '') || '3'),
      isEnabled: Boolean(root.querySelector<HTMLInputElement>('[data-campaign-enabled]')?.checked),
    };
    if (!Number.isInteger(payload.itemCount) || payload.itemCount < 1 || payload.itemCount > 20) { showMessage(root, 'تعداد هر اجرا باید عددی بین ۱ تا ۲۰ باشد.'); return; }
    if (!payload.name || !payload.siteId) { showMessage(root, 'نام کمپین و فروشگاه را مشخص کنید.'); return; }
    if (payload.selectionType === 'manual' && payload.selectionIds.length === 0) { showMessage(root, 'برای انتخاب دستی، حداقل یک محصول یا مقاله را جستجو و انتخاب کنید.'); return; }
    if (payload.selectionType === 'category' && payload.selectionIds.length === 0) { showMessage(root, 'برای انتخاب بر اساس دسته‌بندی، حداقل یک دسته را انتخاب کنید.'); return; }
    const method = editingCampaignId ? 'PUT' : 'POST';
    const url = editingCampaignId ? `/api/v1/wordpress/campaigns/${encodeURIComponent(editingCampaignId)}` : '/api/v1/wordpress/campaigns';
    void request(url, method, payload).then(async () => {
      stateCache = await loadState(true);
      editingCampaignId = null;
      if (stateCache) hydrateStateIntoRoot(root, stateCache);
      showMessage(root, 'کمپین ذخیره شد.', 'ok');
    }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'ذخیره کمپین ناموفق بود.'));
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-edit]').forEach((button) => {
    button.onclick = () => { editingCampaignId = button.dataset.campaignEdit ?? null; hydrateStateIntoRoot(root, state); };
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-delete]').forEach((button) => {
    button.onclick = () => {
      const item = state.campaigns.find((x) => x.id === button.dataset.campaignDelete);
      if (!item || !window.confirm(`کمپین «${item.name}» حذف شود؟`)) return;
      void request(`/api/v1/wordpress/campaigns/${encodeURIComponent(item.id)}`, 'DELETE').then(async () => {
        stateCache = await loadState(true);
        if (stateCache) hydrateStateIntoRoot(root, stateCache);
        showMessage(root, 'کمپین حذف شد.', 'ok');
      }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'حذف کمپین ناموفق بود.'));
    };
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-toggle]').forEach((button) => {
    button.onclick = () => {
      const item = state.campaigns.find((x) => x.id === button.dataset.campaignToggle);
      if (!item) return;
      const enabled = !bool(item.isEnabled);
      void request(`/api/v1/wordpress/campaigns/${encodeURIComponent(item.id)}/enabled`, 'POST', { enabled }).then(async () => {
        stateCache = await loadState(true);
        if (stateCache) hydrateStateIntoRoot(root, stateCache);
        showMessage(root, enabled ? 'کمپین فعال شد.' : 'کمپین خاموش شد.', 'ok');
      }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'تغییر وضعیت کمپین ناموفق بود.'));
    };
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-analytics]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.campaignAnalytics;
      if (!id) return;
      const item = state.campaigns.find((x) => x.id === id);
      if (!item) return;
      void renderCampaignAnalyticsDetails(root, id, item.name, String(state.sites.find((site) => site.id === item.siteId)?.siteUrl ?? 'وب‌سایت متصل'));
    };
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-run]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.campaignRun;
      if (!id) return;
      button.setAttribute('disabled', 'true');
      void request<AnyRecord>(`/api/v1/wordpress/campaigns/${encodeURIComponent(id)}/run`, 'POST', {}).then(async (result) => {
        stateCache = await loadState(true);
        if (stateCache) hydrateStateIntoRoot(root, stateCache);
        showMessage(root, `اجرای کمپین انجام شد: ${faNum(result?.queued ?? 0)} مورد در صف قرار گرفت.`, 'ok');
      }).catch((error) => showMessage(root, error instanceof Error ? error.message : 'اجرای کمپین ناموفق بود.')).finally(() => button.removeAttribute('disabled'));
    };
  });
}

async function mountWooTools(main: HTMLElement) {
  if (window.location.pathname !== '/dashboard/campaigns') return;
  if ((main.textContent ?? '').includes('در پلن فعلی فعال نیست')) return;
  const host = main.querySelector<HTMLElement>('[data-postyar-campaigns-host="1"]');
  if (!host) return;
  let root = host.querySelector<HTMLElement>(`[${ROOT_MARK}]`);
  if (!root) {
    root = document.createElement('section');
    root.className = 'card';
    root.setAttribute(ROOT_MARK, '1');
    root.style.minWidth = '0';
    host.appendChild(root);
  }
  if (root.dataset.wpToolsReady === '1' || root.dataset.wpToolsLoading === '1') return;
  root.dataset.wpToolsLoading = '1';
  root.innerHTML = '<div class="wp-tools-loading-shell"><div class="wp-tools-loading-shell__title">کمپین‌ها</div><div class="wp-tools-loading-shell__bars"><span></span><span></span><span></span></div><div class="wp-tools-loading-shell__meta">در حال بارگذاری اطلاعات</div></div>';
  try {
    const state = await Promise.race([loadState(), new Promise<Awaited<ReturnType<typeof loadState>>>((_, reject) => window.setTimeout(() => reject(new Error('بارگذاری اطلاعات بیش از زمان مجاز طول کشید. دوباره تلاش کنید.')), 12000))]);
    hydrateStateIntoRoot(root, state);
    root.dataset.wpToolsReady = '1';
    delete root.dataset.wpToolsLoading;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'دریافت اطلاعات ناموفق بود.';
    root.innerHTML = `<div class="wp-template-preview" role="alert"><strong>بارگذاری اطلاعات کمپین‌ها کامل نشد.</strong><p>${esc(message)}</p><button type="button" class="btn btn-soft" data-wp-tools-retry>تلاش دوباره</button></div>`;
    delete root.dataset.wpToolsLoading;
    root.querySelector<HTMLElement>('[data-wp-tools-retry]')?.addEventListener('click', () => {
      stateCache = null;
      delete root.dataset.wpToolsReady;
      void mountWooTools(main);
    });
  }
}

function copyTextCompat(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
    ta.remove();
  });
}

async function mountReferralFallback(main: HTMLElement) {
  if (!hasHeading(main, 'تنظیمات حساب')) return;
  if (main.querySelector('input[aria-label="کد معرف شما"]')) return;
  if (main.querySelector(`[${SETTINGS_MARK}]`)) return;
  try {
    const data = await request<{ referralCode?: string }>('/api/v1/users/me/settings');
    const code = String(data.referralCode ?? '').trim();
    if (!code) return;
    const card = document.createElement('section');
    card.className = 'card';
    card.setAttribute(SETTINGS_MARK, '1');
    card.style.marginTop = '14px';
    card.innerHTML = `<div class="wp-card-head"><div><h2 style="font-size:16px">کد معرف شما</h2><p>این کد را برای دوستان خود ارسال کنید تا هنگام ثبت‌نام وارد کنند.</p></div><span class="badge">معرفی</span></div><div class="wp-code-row"><code dir="ltr">${esc(code)}</code><button type="button" class="btn btn-soft" data-referral-copy>کپی کد</button></div>`;
    card.querySelector<HTMLButtonElement>('[data-referral-copy]')?.addEventListener('click', () => {
      void copyTextCompat(code).then(() => window.alert('کد معرف کپی شد.')).catch(() => undefined);
    });
    main.appendChild(card);
  } catch { /* settings page remains untouched on failure */ }
}

function sync() {
  const main = findDashboardMain();
  const path = window.location.pathname;
  if (!main || !path.startsWith('/dashboard/')) return;
  if (currentPath !== path) {
    currentPath = path;
    stateCache = null;
    editingTemplateId = null;
    templateEditorOpen = false;
    editingCampaignId = null;
    campaignPickerIds = [];
    campaignPickerSiteId = '';
    document.querySelector(`[${ROOT_MARK}]`)?.remove();
    document.querySelector(`[${SETTINGS_MARK}]`)?.remove();
  }
  void mountWooTools(main);
  void mountReferralFallback(main);
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  window.requestAnimationFrame(() => { syncScheduled = false; sync(); });
}

function start() {
  if ((window as Window & { __POSTYAR_V26_WORDPRESS_TOOLS?: boolean }).__POSTYAR_V26_WORDPRESS_TOOLS) return;
  (window as Window & { __POSTYAR_V26_WORDPRESS_TOOLS?: boolean }).__POSTYAR_V26_WORDPRESS_TOOLS = true;
  scheduleSync();
  onRouteChange(scheduleSync);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
