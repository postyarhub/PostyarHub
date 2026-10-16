import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, like, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { wordpressSites, wordpressProducts, wordpressContents, wordpressCampaigns, channels, posts, postTargets, outboxEvents } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { httpBuffer } from '../../core/http.js';
import { isAllowedImageMime, uploadMedia } from '../media/media.service.js';
import { newId, sha256Hex } from '../../core/ids.js';
import { emitEvent } from '../../core/events.js';
import { outboxRow } from '../../core/outbox.js';
import { audit } from '../../core/audit.js';
import { assertFeature, assertWithinLimit } from '../subscriptions/plan.service.js';
import { recordAnalyticsEvent } from '../analytics/analytics.service.js';
import { createPost, publishNow } from '../publishing/post.service.js';
import { listTemplates, renderTemplate } from '../templates/template.service.js';

const MAX_PRODUCTS_PER_SYNC = 200;
const MAX_PUBLISH_CHANNELS = 5;

function normalizeProductEventType(value: WpProductInput['event_type']): 'new' | 'update' | 'product_price' | 'product_stock' {
  if (value === 'price' || value === 'product_price') return 'product_price';
  if (value === 'stock' || value === 'product_stock') return 'product_stock';
  if (value === 'update') return 'update';
  return 'new';
}

export interface WpProductInput {
  wc_id: number;
  title: string;
  price_rial?: number | null;
  permalink?: string | null;
  image_url?: string | null;
  regular_price_rial?: number | null; sale_price_rial?: number | null; old_price_rial?: number | null;
  event_type?: 'new' | 'update' | 'price' | 'stock' | 'product_price' | 'product_stock';
  stock_status?: string | null; is_featured?: boolean; sales_count?: number; sku?: string | null; excerpt?: string | null; body?: string | null;
  categories?: Array<{ id: number; name: string; slug: string }>;
}

export interface WpContentInput {
  content_id: number; title: string; body: string; excerpt?: string | null; content_type?: 'post' | 'page';
  categories?: Array<{ id: number; name: string; slug: string }>; permalink?: string | null; image_url?: string | null; event_type?: string;
}

export interface WordPressCategory { id: number; name: string; slug: string }

function normalizeSiteUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ERR.VALIDATION('آدرس سایت معتبر نیست.'));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(ERR.VALIDATION('فقط آدرس‌های http و https مجاز هستند.'));
  }
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  return normalized.slice(0, 255);
}

function generateHex32(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export interface ConnectedSite {
  id: string;
  siteUrl: string;
  siteKey: string;
  secret: string; // returned ONCE, never stored in plaintext
}

/** Connect a WooCommerce site (plan feature `woocommerce` required, §150). */
export async function connectSite(tenantId: string, rawSiteUrl: string): Promise<ConnectedSite> {
  await assertFeature(tenantId, 'woocommerce');
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const db = getDb();

  const siteKey = generateHex32();
  const secret = generateHex32();
  const secretHash = await sha256Hex(secret);
  const id = newId();

  // One site per (tenant, url): reconnecting rotates the secret atomically.
  await db
    .insert(wordpressSites)
    .values({ id, tenantId, siteUrl, siteKey, secretHash, status: 'ACTIVE' })
    .onDuplicateKeyUpdate({ set: { siteKey, secretHash, status: 'ACTIVE', lastError: null } });

  const [row] = await db
    .select({ id: wordpressSites.id, siteUrl: wordpressSites.siteUrl, siteKey: wordpressSites.siteKey })
    .from(wordpressSites)
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.siteUrl, siteUrl)))
    .limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());

  await audit({ action: 'wordpress.connected', actorId: tenantId, subjectType: 'wordpress_site', subjectId: row.id, meta: { siteUrl } });
  await emitEvent({ name: 'wordpress.connected', tenantId, subjectType: 'wordpress_site', subjectId: row.id, props: { siteUrl } });
  return { id: row.id, siteUrl: row.siteUrl, siteKey: row.siteKey, secret };
}

export async function listSites(tenantId: string): Promise<Array<{ id: string; siteUrl: string; siteKey: string; status: string; autoPublish: number; sendImage: number; channelIdsJson: string[] | null; automationJson: Record<string, unknown> | null; messageStyle: string; lastError: string | null; lastSyncAt: Date | null; createdAt: Date }>> {
  await assertFeature(tenantId, 'woocommerce');
  const db = getDb();
  const rows = await db
    .select({
      id: wordpressSites.id,
      siteUrl: wordpressSites.siteUrl,
      siteKey: wordpressSites.siteKey,
      status: wordpressSites.status,
      autoPublish: wordpressSites.autoPublish,
      sendImage: wordpressSites.sendImage,
      channelIdsJson: wordpressSites.channelIdsJson,
      automationJson: wordpressSites.automationJson,
      messageStyle: wordpressSites.messageStyle,
      lastError: wordpressSites.lastError,
      lastSyncAt: wordpressSites.lastSyncAt,
      createdAt: wordpressSites.createdAt,
    })
    .from(wordpressSites)
    .where(eq(wordpressSites.tenantId, tenantId))
    .orderBy(desc(wordpressSites.createdAt));
  return rows;
}

export async function updateSiteSettings(tenantId: string, siteId: string, input: { autoPublish?: boolean; channelIds?: string[]; automation?: Record<string, unknown>; messageStyle?: 'shop'|'minimal'|'sale'; sendImage?: boolean }) {
  await assertFeature(tenantId, 'woocommerce');
  const db = getDb();
  await db
    .update(wordpressSites)
    .set({ ...(input.autoPublish === undefined ? {} : { autoPublish: input.autoPublish ? 1 : 0 }), ...(input.sendImage === undefined ? {} : { sendImage: input.sendImage ? 1 : 0 }), ...(input.channelIds === undefined ? {} : { channelIdsJson: input.channelIds }), ...(input.automation === undefined ? {} : { automationJson: input.automation }), ...(input.messageStyle === undefined ? {} : { messageStyle: input.messageStyle }) })
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.id, siteId)));
  const [site] = await db
    .select({ id: wordpressSites.id, autoPublish: wordpressSites.autoPublish, sendImage: wordpressSites.sendImage, channelIdsJson: wordpressSites.channelIdsJson, automationJson: wordpressSites.automationJson, messageStyle: wordpressSites.messageStyle })
    .from(wordpressSites)
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.id, siteId)))
    .limit(1);
  if (!site) throw new AppError(ERR.NOT_FOUND('سایت'));
  return site;
}

async function ownedSite(tenantId: string, siteId: string) {
  const db = getDb();
  const [site] = await db
    .select()
    .from(wordpressSites)
    .where(and(eq(wordpressSites.id, siteId), eq(wordpressSites.tenantId, tenantId)))
    .limit(1);
  if (!site) throw new AppError(ERR.NOT_FOUND('سایت'));
  return site;
}


function normalizeFeaturedImageUrl(raw: string, siteUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim(), `${siteUrl.replace(/\/+$/, '')}/`);
  } catch {
    throw new AppError(ERR.VALIDATION('نشانی تصویر شاخص معتبر نیست.'));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(ERR.VALIDATION('نشانی تصویر باید از نوع HTTP یا HTTPS باشد.'));
  }
  try {
    const base = new URL(siteUrl);
    if (base.protocol === 'https:' && parsed.protocol === 'http:' && parsed.hostname.toLowerCase() === base.hostname.toLowerCase()) {
      parsed.protocol = 'https:';
    }
  } catch { /* owned site URL has already passed connection validation */ }
  return parsed.toString();
}

interface FeaturedImageAsset {
  buffer: Buffer;
  mimeType: string;
}

async function fetchFeaturedImageAsset(
  tenantId: string,
  input: { siteId: string; itemType: 'product' | 'content'; sourceId: number },
): Promise<FeaturedImageAsset> {
  await assertFeature(tenantId, 'woocommerce');
  if (!Number.isSafeInteger(input.sourceId) || input.sourceId < 1) {
    throw new AppError(ERR.VALIDATION('شناسهٔ محتوا معتبر نیست.'));
  }
  const site = await ownedSite(tenantId, input.siteId);
  const db = getDb();
  const source = input.itemType === 'product'
    ? (await db.select({ imageUrl: wordpressProducts.imageUrl, customImageUrl: wordpressProducts.customImageUrl })
        .from(wordpressProducts)
        .where(and(eq(wordpressProducts.tenantId, tenantId), eq(wordpressProducts.siteId, site.id), eq(wordpressProducts.wcProductId, input.sourceId)))
        .limit(1))[0]
    : (await db.select({ imageUrl: wordpressContents.imageUrl, customImageUrl: wordpressContents.customImageUrl })
        .from(wordpressContents)
        .where(and(eq(wordpressContents.tenantId, tenantId), eq(wordpressContents.siteId, site.id), eq(wordpressContents.contentId, input.sourceId)))
        .limit(1))[0];
  if (!source) throw new AppError(ERR.NOT_FOUND('محتوای وب‌سایت'));
  const imageUrl = String(source.customImageUrl ?? '').trim() || String(source.imageUrl ?? '').trim();
  if (!imageUrl) throw new AppError(ERR.VALIDATION('برای این مورد تصویر شاخص ثبت نشده است.'));
  const url = normalizeFeaturedImageUrl(imageUrl, site.siteUrl);
  let response;
  try {
    response = await httpBuffer(url, {
      timeoutMs: 25_000,
      ssrfGuard: true,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8' },
    });
  } catch {
    throw new AppError(ERR.VALIDATION('دریافت تصویر شاخص از وب‌سایت ناموفق بود. آدرس تصویر را در وردپرس بررسی کنید.'));
  }
  if (response.status !== 200 || response.body.length === 0) {
    throw new AppError(ERR.VALIDATION('تصویر شاخص از وب‌سایت دریافت نشد؛ نشانی یا دسترسی تصویر را بررسی کنید.'));
  }
  let mimeType = response.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mimeType === 'image/jpg' || mimeType === 'image/pjpeg') mimeType = 'image/jpeg';
  if (mimeType === 'image/x-png') mimeType = 'image/png';
  if (!isAllowedImageMime(mimeType)) {
    throw new AppError(ERR.VALIDATION('نشانی انتخاب‌شده به یک تصویر پشتیبانی‌شده اشاره نمی‌کند.'));
  }
  return { buffer: response.body, mimeType };
}

/** Preview through the authenticated application origin. This avoids broken
 * mixed-content/hotlink images in the browser while deriving the URL only from
 * a tenant-owned catalog record and applying the SSRF-safe binary fetcher. */
export async function previewFeaturedImage(
  tenantId: string,
  input: { siteId: string; itemType: 'product' | 'content'; sourceId: number },
): Promise<FeaturedImageAsset> {
  return fetchFeaturedImageAsset(tenantId, input);
}

/** Import the actual catalog featured image as private, tenant-owned media. The
 * browser submits only source identifiers; image URLs always come from the
 * tenant-scoped database record, and httpBuffer applies SSRF/redirect guards. */
export async function importFeaturedImageToMedia(
  tenantId: string,
  input: { siteId: string; itemType: 'product' | 'content'; sourceId: number },
) {
  const asset = await fetchFeaturedImageAsset(tenantId, input);
  const storedMedia = await uploadMedia(tenantId, { buffer: asset.buffer, mimeType: asset.mimeType, maxBytes: 8 * 1024 * 1024 });
  return { media: storedMedia };
}

export async function getSiteSettings(site: VerifiedSite | { id: string; tenantId: string }) {
  const db = getDb();
  const [row] = await db.select({ autoPublish: wordpressSites.autoPublish, sendImage: wordpressSites.sendImage, channelIds: wordpressSites.channelIdsJson, automation: wordpressSites.automationJson, messageStyle: wordpressSites.messageStyle })
    .from(wordpressSites)
    .where(and(eq(wordpressSites.id, site.id), eq(wordpressSites.tenantId, site.tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('سایت'));
  // WordPress plugin 1.9.x renders its available-channel cards from `channels`.
  // Return only channels belonging to this tenant and currently active; never
  // expose bot credentials or the secret fields from the channels/bots tables.
  const activeChannels = await db.select({
    id: channels.id,
    title: channels.title,
    channelRef: channels.channelRef,
    platform: channels.platform,
  }).from(channels)
    .where(and(eq(channels.tenantId, site.tenantId), eq(channels.status, 'ACTIVE')))
    .orderBy(asc(channels.createdAt))
    .limit(100);
  const savedChannelIds = Array.isArray(row.channelIds) ? row.channelIds : [];
  // The empty selection already means "use active defaults" in delivery logic.
  // Mirror that same behavior in the plugin UI so these channels are visible
  // and preselected on a fresh connection instead of appearing unconfigured.
  const channelIds = savedChannelIds.length
    ? savedChannelIds.filter((id) => activeChannels.some((channel) => channel.id === id)).slice(0, MAX_PUBLISH_CHANNELS)
    : activeChannels.slice(0, MAX_PUBLISH_CHANNELS).map((channel) => channel.id);
  return {
    autoPublish: Boolean(row.autoPublish),
    channelIds,
    channels: activeChannels,
    automation: row.automation ?? {},
    messageStyle: row.messageStyle,
    sendImage: Boolean(row.sendImage),
  };
}

export async function deleteSite(tenantId: string, siteId: string): Promise<void> {
  await assertFeature(tenantId, 'woocommerce');
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(wordpressProducts).where(eq(wordpressProducts.siteId, site.id));
    await tx.delete(wordpressContents).where(eq(wordpressContents.siteId, site.id));
    await tx.delete(wordpressCampaigns).where(eq(wordpressCampaigns.siteId, site.id));
    await tx.delete(wordpressSites).where(eq(wordpressSites.id, site.id));
  });
  await audit({ action: 'wordpress.disconnected', actorId: tenantId, subjectType: 'wordpress_site', subjectId: site.id, meta: { siteUrl: site.siteUrl } });
}

/** Secret rotation: new plaintext returned ONCE; only its hash is stored. */
export async function rotateSecret(tenantId: string, siteId: string): Promise<{ secret: string; connectionCode: string }> {
  await assertFeature(tenantId, 'woocommerce');
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  const secret = generateHex32();
  const secretHash = await sha256Hex(secret);
  await db.update(wordpressSites).set({ secretHash }).where(eq(wordpressSites.id, site.id));
  await audit({ action: 'wordpress.secret_rotated', actorId: tenantId, subjectType: 'wordpress_site', subjectId: site.id });
  return { secret, connectionCode: Buffer.from(`${site.siteKey}:${secret}`).toString('base64url') };
}

export interface VerifiedSite {
  id: string;
  tenantId: string;
  siteUrl: string;
  status: string;
}

/**
 * Webhook authentication (§153, WORDPRESS.md): the WordPress plugin sends the
 * plaintext secret in `x-postyar-secret`; we hash it (SHA-256) and compare
 * timing-safe against the stored hash. TLS transport + per-site secret +
 * timing-safe compare = secure without storing the plaintext server-side.
 */
export async function verifySiteRequest(siteKey: string, secret: string): Promise<VerifiedSite | null> {
  if (!siteKey || !secret) return null;
  const db = getDb();
  const [site] = await db
    .select()
    .from(wordpressSites)
    .where(and(eq(wordpressSites.siteKey, siteKey), ne(wordpressSites.status, 'DISABLED')))
    .limit(1);
  if (!site) return null;
  const incomingHash = createHash('sha256').update(secret).digest('hex');
  const a = Buffer.from(incomingHash);
  const b = Buffer.from(site.secretHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: site.id, tenantId: site.tenantId, siteUrl: site.siteUrl, status: site.status };
}

function productContentHash(p: WpProductInput): string {
  const canonical = JSON.stringify([p.wc_id, p.title, p.price_rial ?? null, p.regular_price_rial ?? null, p.sale_price_rial ?? null, p.old_price_rial ?? null, p.stock_status ?? null, p.is_featured ?? false, p.sales_count ?? 0, p.sku ?? null, p.excerpt ?? null, p.body ?? null, p.permalink ?? null, p.image_url ?? null, p.categories ?? []]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Idempotent product sync (§23): unchanged products (same content hash) are skipped. */
export async function syncProducts(site: VerifiedSite, products: WpProductInput[]): Promise<{ synced: number; skipped: number }> {
  await assertFeature(site.tenantId, 'woocommerce');
  if (products.length > MAX_PRODUCTS_PER_SYNC) {
    throw new AppError(ERR.VALIDATION('تعداد محصولات هر همگام‌سازی حداکثر ۲۰۰ مورد است.'));
  }
  const db = getDb();
  let synced = 0;
  let skipped = 0;

  for (const p of products) {
    if (!Number.isInteger(p.wc_id) || !p.title) {
      skipped++;
      continue;
    }
    const contentHash = productContentHash(p);
    const [existing] = await db
      .select({ id: wordpressProducts.id, contentHash: wordpressProducts.contentHash })
      .from(wordpressProducts)
      .where(and(eq(wordpressProducts.siteId, site.id), eq(wordpressProducts.wcProductId, p.wc_id)))
      .limit(1);

    if (existing && existing.contentHash === contentHash) {
      skipped++;
      continue;
    }

    const values = {
      title: p.title.slice(0, 255),
      priceRial: typeof p.price_rial === 'number' ? Math.max(0, Math.floor(p.price_rial)) : null,
      permalink: p.permalink?.slice(0, 255) ?? null,
      imageUrl: p.image_url?.slice(0, 512) ?? null,
      regularPriceRial: p.regular_price_rial ?? null, salePriceRial: p.sale_price_rial ?? null, oldPriceRial: p.old_price_rial ?? null,
      stockStatus: p.stock_status?.slice(0, 30) ?? null, isFeatured: p.is_featured ? 1 : 0, salesCount: Math.max(0, Math.floor(p.sales_count ?? 0)), sku: p.sku?.slice(0,190) ?? null, excerpt: p.excerpt ?? null, body: p.body ?? null,
      categoriesJson: (p.categories ?? []).slice(0, 50).map((category) => ({ id: Math.floor(category.id), name: category.name.slice(0, 255), slug: category.slug.slice(0, 200) })),
      contentHash,
      lastSyncedAt: new Date(),
    };

    if (existing) {
      await db.update(wordpressProducts).set(values).where(eq(wordpressProducts.id, existing.id));
    } else {
      await db
        .insert(wordpressProducts)
        .values({ id: newId(), siteId: site.id, tenantId: site.tenantId, wcProductId: p.wc_id, ...values })
        .onDuplicateKeyUpdate({ set: values });
    }
    synced++;
  }

  await db.update(wordpressSites).set({ lastSyncAt: new Date() }).where(eq(wordpressSites.id, site.id));
  if (synced > 0) {
    await emitEvent({
      name: 'wordpress.product.synced',
      tenantId: site.tenantId,
      subjectType: 'wordpress_site',
      subjectId: site.id,
      props: { synced, skipped },
    });
    await recordAnalyticsEvent({
      userId: site.tenantId,
      eventType: 'wordpress.product.synced',
      source: 'wordpress',
      value: synced,
      metadata: { siteId: site.id, synced, skipped },
    });
  }
  return { synced, skipped };
}

/**
 * publish_product → one WORDPRESS post + targets for the tenant's first 5
 * ACTIVE channels + one outbox row per channel ('wordpress.publish') which the
 * dispatcher forwards to the delivery worker (§125).
 */
export async function publishProduct(site: VerifiedSite, product: WpProductInput): Promise<{ postId: string; channels: number }> {
  await assertFeature(site.tenantId, 'woocommerce');
  if (!Number.isInteger(product.wc_id) || !product.title) {
    throw new AppError(ERR.VALIDATION('اطلاعات محصول معتبر نیست.'));
  }
  await assertWithinLimit(site.tenantId, 'posts');

  const db = getDb();
  const settings = await getSiteSettings(site);
  const priceFa = typeof product.price_rial === 'number' ? product.price_rial.toLocaleString('fa-IR') : null;
  const eventType = normalizeProductEventType(product.event_type);
  const selectedTemplateIds = (settings.automation && typeof settings.automation.templateIds === 'object' && settings.automation.templateIds !== null)
    ? settings.automation.templateIds as Record<string, unknown>
    : {};
  const selectedTemplateId = typeof selectedTemplateIds[eventType] === 'string' ? String(selectedTemplateIds[eventType]) : '';
  let body: string;
  let templateCta: { label: string; url: string } | null = null;
  const templates = await listTemplates(site.tenantId);
  const selectedTemplate = selectedTemplateId
    ? templates.find((t) => t.id === selectedTemplateId)
    : templates.find((t) => Boolean(t.isDefault) && (() => { const e = t.settingsJson && typeof t.settingsJson === 'object' ? t.settingsJson as Record<string, unknown> : {}; return e.eventType === eventType; })());
  if (selectedTemplateId && !selectedTemplate) throw new AppError(ERR.NOT_FOUND('قالب انتخاب‌شده'));
  if (selectedTemplate) {
    const regular = typeof product.regular_price_rial === 'number' ? product.regular_price_rial : null;
    const sale = typeof product.sale_price_rial === 'number' ? product.sale_price_rial : null;
    const discount = regular && sale !== null && regular > 0 ? Math.max(0, Math.min(100, Math.round(((regular - sale) / regular) * 100))) : 0;
    const templateContext = {
      title: product.title, description: product.excerpt ?? product.body ?? '', excerpt: product.excerpt ?? '', content: product.body ?? product.excerpt ?? '',
      link: product.permalink ?? site.siteUrl, date: '', author: '', site_name: (() => { try { return new URL(site.siteUrl).hostname; } catch { return site.siteUrl; } })(),
      post_type: 'محصول', featured_image: product.image_url ?? '', site_url: site.siteUrl, event_type: eventType, product_id: product.wc_id,
      discount_percent: discount, old_price: typeof product.old_price_rial === 'number' ? product.old_price_rial.toLocaleString('fa-IR') : '',
      price: priceFa ?? '', regular_price: typeof product.regular_price_rial === 'number' ? product.regular_price_rial.toLocaleString('fa-IR') : '',
      sale_price: typeof product.sale_price_rial === 'number' ? product.sale_price_rial.toLocaleString('fa-IR') : '', sku: product.sku ?? '', stock_status: product.stock_status === 'instock' ? 'موجود' : product.stock_status === 'outofstock' ? 'ناموجود' : product.stock_status ?? '',
    };
    const cta = selectedTemplate.settingsJson && typeof selectedTemplate.settingsJson === 'object' && (selectedTemplate.settingsJson as Record<string, unknown>).cta && typeof (selectedTemplate.settingsJson as Record<string, unknown>).cta === 'object' ? (selectedTemplate.settingsJson as Record<string, unknown>).cta as Record<string, unknown> : null;
    if (cta && typeof cta.label === 'string' && typeof cta.url === 'string' && cta.label.trim() && cta.url.trim()) {
      const renderedCtaUrl = renderTemplate(cta.url.trim(), templateContext).trim();
      try { const parsed = new URL(renderedCtaUrl); if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname) templateCta = { label: cta.label.trim(), url: renderedCtaUrl }; } catch {}
    }
    body = renderTemplate(selectedTemplate.body, templateContext);
  } else {
    const style = settings.messageStyle ?? 'shop';
    const bodyParts = [style === 'sale' ? `🔥 ${product.title}` : style === 'minimal' ? product.title : `🛍 ${product.title}`];
    if (priceFa) bodyParts.push(style === 'sale' ? `قیمت ویژه: ${priceFa} ریال` : `قیمت: ${priceFa} ریال`);
    if (product.stock_status && style !== 'minimal') bodyParts.push(`وضعیت موجودی: ${product.stock_status}`);
    if (product.permalink) bodyParts.push(product.permalink);
    body = bodyParts.join('\n\n');
  }

  const requestedChannels = Array.isArray(settings.channelIds) ? settings.channelIds.slice(0, MAX_PUBLISH_CHANNELS) : [];
  const activeChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(requestedChannels.length
      ? and(eq(channels.tenantId, site.tenantId), eq(channels.status, 'ACTIVE'), inArray(channels.id, requestedChannels))
      : and(eq(channels.tenantId, site.tenantId), eq(channels.status, 'ACTIVE')))
    .orderBy(channels.createdAt)
    .limit(MAX_PUBLISH_CHANNELS);
  if (activeChannels.length === 0) {
    throw new AppError(ERR.VALIDATION('کانال فعالی برای انتشار محصول یافت نشد.'));
  }

  const postId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(posts).values({
      id: postId,
      tenantId: site.tenantId,
      title: product.title.slice(0, 190),
      body,
      buttonsJson: templateCta ? { links: [{ label: templateCta.label, url: templateCta.url }] } : null,
      source: 'WORDPRESS',
      state: 'QUEUED',
    });

    for (const ch of activeChannels) {
      const targetId = newId();
      await tx.insert(postTargets).values({
        id: targetId,
        postId,
        tenantId: site.tenantId,
        channelId: ch.id,
        state: 'PENDING',
      });
      await tx.insert(outboxEvents).values(
        outboxRow({
          aggregateType: 'wordpress',
          aggregateId: site.id,
          eventType: 'wordpress.publish',
          payload: {
            tenantId: site.tenantId,
            siteId: site.id,
            productId: product.wc_id,
            channelId: ch.id,
            targetId,
            postId,
            title: product.title,
            body,
            imageUrl: settings.sendImage ? (product.image_url ?? null) : null,
          },
        })
      );
    }

    // upsert product + stamp publish time
    const values = {
      title: product.title.slice(0, 255),
      priceRial: typeof product.price_rial === 'number' ? Math.max(0, Math.floor(product.price_rial)) : null,
      permalink: product.permalink?.slice(0, 255) ?? null,
      imageUrl: product.image_url?.slice(0, 512) ?? null,
      categoriesJson: (product.categories ?? []).slice(0, 50).map((category) => ({ id: Math.floor(category.id), name: category.name.slice(0, 255), slug: category.slug.slice(0, 200) })),
      contentHash: productContentHash(product),
      lastSyncedAt: new Date(),
    };
    await tx
      .insert(wordpressProducts)
      .values({ id: newId(), siteId: site.id, tenantId: site.tenantId, wcProductId: product.wc_id, ...values })
      .onDuplicateKeyUpdate({ set: values });
  });

  // The publication event is emitted by the delivery worker only after the
  // provider confirms the message. This function has only queued durable work.
  await audit({ action: 'wordpress.product_queued', actorId: site.tenantId, subjectType: 'wordpress_site', subjectId: site.id, meta: { productId: product.wc_id, channels: activeChannels.length } });

  return { postId, channels: activeChannels.length };
}

export async function manualSendProducts(site: VerifiedSite, products: WpProductInput[]) {
  let sent = 0; for (const p of products.slice(0,20)) { await publishProduct(site, p); sent++; } return { sent };
}

export async function syncContents(site: VerifiedSite, contents: WpContentInput[]) {
  await assertFeature(site.tenantId, 'woocommerce');
  if (contents.length > MAX_PRODUCTS_PER_SYNC) throw new AppError(ERR.VALIDATION('تعداد مقالات هر همگام‌سازی حداکثر ۲۰۰ مورد است.'));
  const db = getDb();
  let synced = 0;
  let skipped = 0;
  for (const c of contents) {
    if (!Number.isInteger(c.content_id) || c.content_id < 1 || !c.title.trim()) { skipped++; continue; }
    const categories = (c.categories ?? []).slice(0, 50).map((category) => ({ id: Math.floor(category.id), name: category.name.slice(0, 255), slug: category.slug.slice(0, 200) }));
    const contentType = c.content_type === 'page' ? 'page' : 'post';
    const hash = createHash('sha256').update(JSON.stringify([c.content_id, c.title, c.body, c.excerpt ?? null, contentType, categories, c.permalink ?? null, c.image_url ?? null])).digest('hex');
    const [existing] = await db.select({ id: wordpressContents.id, contentHash: wordpressContents.contentHash })
      .from(wordpressContents)
      .where(and(eq(wordpressContents.siteId, site.id), eq(wordpressContents.contentId, c.content_id)))
      .limit(1);
    if (existing?.contentHash === hash) { skipped++; continue; }
    const values = {
      title: c.title.trim().slice(0, 255),
      body: c.body.slice(0, 60000),
      excerpt: c.excerpt?.slice(0, 5000) ?? null,
      permalink: c.permalink?.slice(0, 512) ?? null,
      imageUrl: c.image_url?.slice(0, 512) ?? null,
      contentType,
      categoriesJson: categories,
      contentHash: hash,
    };
    if (existing) await db.update(wordpressContents).set(values).where(eq(wordpressContents.id, existing.id));
    else await db.insert(wordpressContents).values({ id: newId(), siteId: site.id, tenantId: site.tenantId, contentId: c.content_id, postId: newId(), ...values });
    synced++;
  }
  await db.update(wordpressSites).set({ lastSyncAt: new Date() }).where(eq(wordpressSites.id, site.id));
  if (synced > 0) await recordAnalyticsEvent({
    userId: site.tenantId,
    eventType: 'wordpress.content.synced',
    source: 'wordpress',
    value: synced,
    metadata: { siteId: site.id, synced, skipped },
  });
  return { synced, skipped };
}

export async function publishContent(site: VerifiedSite, content: {content_id:number; title:string; body:string; permalink?:string|null; image_url?:string|null}) {
  // Existing site credentials must not bypass a plan downgrade or revoked
  // website-integration entitlement. Keep the check at the side-effect boundary.
  await assertFeature(site.tenantId, 'woocommerce');
  const settings = await getSiteSettings(site);
  const channelIds = (settings.channelIds as string[]).slice(0, MAX_PUBLISH_CHANNELS);
  const db = getDb();
  const channelsToUse = channelIds.length
    ? channelIds
    : (await db.select({ id: channels.id }).from(channels)
      .where(and(eq(channels.tenantId, site.tenantId), eq(channels.status, 'ACTIVE')))
      .orderBy(channels.createdAt).limit(MAX_PUBLISH_CHANNELS)).map((x) => x.id);
  if (!channelsToUse.length) throw new AppError(ERR.VALIDATION('کانال فعالی برای انتشار محتوا یافت نشد.'));
  const post = await createPost(site.tenantId, {
    title: content.title.slice(0, 190),
    body: content.body,
    source: 'WORDPRESS',
  });
  try {
    await publishNow(site.tenantId, post.id, channelsToUse);
  } catch (error) {
    // Do not leave an orphan draft when publication failed before the post was
    // queued. If publishNow committed QUEUED state, this guarded delete is a no-op.
    await db.delete(posts).where(and(
      eq(posts.id, post.id),
      eq(posts.tenantId, site.tenantId),
      eq(posts.state, 'DRAFT'),
    )).catch(() => undefined);
    throw error;
  }
  return { postId: post.id, channels: channelsToUse.length };
}

export interface WordPressContentListFilters {
  siteId?: string;
  q?: string;
  categoryId?: number;
  contentType?: 'post' | 'page';
}

export interface WordPressProductListFilters extends WordPressContentListFilters {
  stockStatus?: string;
  featured?: boolean;
  onSale?: boolean;
}

function searchPattern(q: string | undefined): string | null {
  const value = String(q ?? '').trim().slice(0, 120);
  if (!value) return null;
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function normalizeCategoryRows(rows: Array<{ categories: WordPressCategory[] | null }>): WordPressCategory[] {
  const categories = new Map<number, WordPressCategory>();
  for (const row of rows) {
    if (!Array.isArray(row.categories)) continue;
    for (const item of row.categories) {
      const id = Number(item?.id);
      const name = String(item?.name ?? '').trim();
      if (!Number.isInteger(id) || id < 1 || !name) continue;
      categories.set(id, { id, name: name.slice(0, 255), slug: String(item.slug ?? '').slice(0, 200) });
    }
  }
  return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

export async function listProductCategories(tenantId: string, siteId: string): Promise<WordPressCategory[]> {
  await assertFeature(tenantId, 'woocommerce');
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  const rows = await db.select({ categories: wordpressProducts.categoriesJson }).from(wordpressProducts)
    .where(and(eq(wordpressProducts.tenantId, tenantId), eq(wordpressProducts.siteId, site.id)));
  return normalizeCategoryRows(rows);
}

export async function listContentCategories(tenantId: string, siteId: string, contentType?: 'post' | 'page'): Promise<WordPressCategory[]> {
  await assertFeature(tenantId, 'woocommerce');
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  const rows = await db.select({ categories: wordpressContents.categoriesJson }).from(wordpressContents)
    .where(and(eq(wordpressContents.tenantId, tenantId), eq(wordpressContents.siteId, site.id), ...(contentType ? [eq(wordpressContents.contentType, contentType)] : [])));
  return normalizeCategoryRows(rows);
}

export async function listContents(
  tenantId: string,
  page: number,
  pageSize: number,
  filters: WordPressContentListFilters = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  await assertFeature(tenantId, 'woocommerce');
  if (!filters.siteId) throw new AppError(ERR.VALIDATION('برای نمایش محتوا، ابتدا یک وب‌سایت را انتخاب کنید.'));
  const site = await ownedSite(tenantId, filters.siteId);
  const db = getDb();
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const pattern = searchPattern(filters.q);
  const where = and(
    eq(wordpressContents.tenantId, tenantId),
    eq(wordpressContents.siteId, site.id),
    ...(pattern ? [like(wordpressContents.title, pattern)] : []),
    ...(filters.categoryId ? [sql`JSON_CONTAINS(${wordpressContents.categoriesJson}, JSON_OBJECT('id', ${filters.categoryId}), '$') = 1`] : []),
    ...(filters.contentType ? [eq(wordpressContents.contentType, filters.contentType)] : []),
  );
  const [items, totalRows] = await Promise.all([
    db.select({
      id: wordpressContents.id,
      siteId: wordpressContents.siteId,
      siteUrl: wordpressSites.siteUrl,
      contentId: wordpressContents.contentId,
      title: wordpressContents.title,
      body: wordpressContents.body,
      excerpt: wordpressContents.excerpt,
      contentType: wordpressContents.contentType,
      categories: wordpressContents.categoriesJson,
      customTitle: wordpressContents.customTitle,
      customBody: wordpressContents.customBody,
      imageUrl: wordpressContents.imageUrl,
      customImageUrl: wordpressContents.customImageUrl,
      permalink: wordpressContents.permalink,
      lastPublishedAt: wordpressContents.lastPublishedAt,
      createdAt: wordpressContents.createdAt,
    })
      .from(wordpressContents)
      .leftJoin(wordpressSites, eq(wordpressContents.siteId, wordpressSites.id))
      .where(where)
      .orderBy(desc(wordpressContents.createdAt))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize),
    db.select({ value: count() }).from(wordpressContents).where(where),
  ]);
  return { items: items.map((row) => ({ ...row, contentId: Number(row.contentId) })), total: Number(totalRows[0]?.value ?? 0), page: safePage, pageSize: safeSize };
}

export async function listProducts(
  tenantId: string,
  page: number,
  pageSize: number,
  filters: WordPressProductListFilters = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  await assertFeature(tenantId, 'woocommerce');
  if (!filters.siteId) throw new AppError(ERR.VALIDATION('برای نمایش محصولات، ابتدا یک وب‌سایت را انتخاب کنید.'));
  const site = await ownedSite(tenantId, filters.siteId);
  const db = getDb();
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const pattern = searchPattern(filters.q);
  const where = and(
    eq(wordpressProducts.tenantId, tenantId),
    eq(wordpressProducts.siteId, site.id),
    ...(pattern ? [like(wordpressProducts.title, pattern)] : []),
    ...(filters.stockStatus ? [eq(wordpressProducts.stockStatus, filters.stockStatus)] : []),
    ...(filters.featured ? [eq(wordpressProducts.isFeatured, 1)] : []),
    ...(filters.onSale ? [and(isNotNull(wordpressProducts.salePriceRial), gt(wordpressProducts.regularPriceRial, 0), lt(wordpressProducts.salePriceRial, wordpressProducts.regularPriceRial))] : []),
    ...(filters.categoryId ? [sql`JSON_CONTAINS(${wordpressProducts.categoriesJson}, JSON_OBJECT('id', ${filters.categoryId}), '$') = 1`] : []),
  );
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: wordpressProducts.id,
      siteId: wordpressProducts.siteId,
      siteUrl: wordpressSites.siteUrl,
      wcProductId: wordpressProducts.wcProductId,
      title: wordpressProducts.title,
      customTitle: wordpressProducts.customTitle,
      priceRial: wordpressProducts.priceRial,
      regularPriceRial: wordpressProducts.regularPriceRial,
      salePriceRial: wordpressProducts.salePriceRial,
      oldPriceRial: wordpressProducts.oldPriceRial,
      stockStatus: wordpressProducts.stockStatus,
      isFeatured: wordpressProducts.isFeatured,
      salesCount: wordpressProducts.salesCount,
      sku: wordpressProducts.sku,
      excerpt: wordpressProducts.excerpt,
      body: wordpressProducts.body,
      categories: wordpressProducts.categoriesJson,
      customBody: wordpressProducts.customBody,
      permalink: wordpressProducts.permalink,
      imageUrl: wordpressProducts.imageUrl,
      customImageUrl: wordpressProducts.customImageUrl,
      lastSyncedAt: wordpressProducts.lastSyncedAt,
      lastPublishedAt: wordpressProducts.lastPublishedAt,
    })
      .from(wordpressProducts)
      .leftJoin(wordpressSites, eq(wordpressProducts.siteId, wordpressSites.id))
      .where(where)
      .orderBy(desc(wordpressProducts.lastSyncedAt), desc(wordpressProducts.id))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize),
    db.select({ value: count() }).from(wordpressProducts).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      wcProductId: Number(row.wcProductId),
      priceRial: row.priceRial === null ? null : Number(row.priceRial),
      regularPriceRial: row.regularPriceRial === null ? null : Number(row.regularPriceRial),
      salePriceRial: row.salePriceRial === null ? null : Number(row.salePriceRial),
      oldPriceRial: row.oldPriceRial === null ? null : Number(row.oldPriceRial),
      salesCount: Number(row.salesCount ?? 0),
      isFeatured: Boolean(row.isFeatured),
    })),
    total: Number(totalRows[0]?.value ?? 0),
    page: safePage,
    pageSize: safeSize,
  };
}
