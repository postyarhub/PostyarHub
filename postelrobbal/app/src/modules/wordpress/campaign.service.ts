import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  channels,
  messageTemplates,
  users,
  wordpressCampaigns,
  wordpressContents,
  wordpressProducts,
  wordpressSites,
  outboxEvents,
  posts,
  postTargets,
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { audit } from '../../core/audit.js';
import { outboxRow } from '../../core/outbox.js';
import { recordAnalyticsEvent } from '../analytics/analytics.service.js';
import { assertFeature } from '../subscriptions/plan.service.js';
import { renderTemplate } from '../templates/template.service.js';
import type { Tx } from '../subscriptions/plan.service.js';

const MAX_CHANNELS = 5;
const MAX_ITEMS = 20;
const ALLOWED_SELECTIONS = new Set([
  'latest',
  'newest',
  'recently_updated',
  'random',
  'manual',
  'category',
  'featured_products',
  'sale_products',
  'in_stock_products',
  'out_of_stock_products',
  'best_selling_products',
]);
const PRODUCT_ONLY_SELECTIONS = new Set([
  'featured_products',
  'sale_products',
  'in_stock_products',
  'out_of_stock_products',
  'best_selling_products',
]);

type CampaignItemType = 'product' | 'content';

type CampaignRow = typeof wordpressCampaigns.$inferSelect;

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function dayKey(value: string): string {
  return value.trim().toLowerCase();
}

function localParts(date: Date, timeZone: string): { date: string; time: string; weekday: string } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    weekday: String(parts.weekday ?? '').slice(0, 3).toLowerCase(),
  };
}

function selectedSlot(campaign: CampaignRow, now: Date, timeZone: string): boolean {
  const current = localParts(now, timeZone);
  if (current.time < campaign.sendTime) return false;
  if (campaign.frequency === 'weekly') {
    const days = Array.isArray(campaign.daysJson) ? campaign.daysJson.map(dayKey) : [];
    if (days.length && !days.includes(current.weekday)) return false;
  }
  if (!campaign.lastRunAt) return true;
  const previous = localParts(campaign.lastRunAt, timeZone);
  if (campaign.frequency === 'daily') return previous.date !== current.date;
  return !(previous.date === current.date && previous.time >= campaign.sendTime);
}

function discountPercent(regularPrice: number | null | undefined, salePrice: number | null | undefined): string {
  const regular = Number(regularPrice ?? 0);
  const sale = Number(salePrice ?? 0);
  if (!Number.isFinite(regular) || !Number.isFinite(sale) || regular <= 0 || sale <= 0 || sale >= regular) return '';
  return String(Math.max(0, Math.min(100, Math.round(((regular - sale) / regular) * 100))));
}

function moneyFa(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Math.max(0, Math.floor(value)).toLocaleString('fa-IR');
}

function productContext(row: typeof wordpressProducts.$inferSelect, siteUrl: string, selectionType: string) {
  const title = row.customTitle?.trim() || row.title;
  const body = row.customBody?.trim() || row.body || row.excerpt || '';
  const image = row.customImageUrl?.trim() || row.imageUrl || '';
  const price = moneyFa(row.priceRial);
  const regularPrice = moneyFa(row.regularPriceRial);
  const salePrice = moneyFa(row.salePriceRial);
  return {
    title,
    description: row.excerpt || body,
    excerpt: row.excerpt || '',
    content: body,
    link: row.permalink || siteUrl,
    date: row.lastSyncedAt ? row.lastSyncedAt.toLocaleDateString('fa-IR') : '',
    author: '',
    site_name: (() => { try { return new URL(siteUrl).hostname; } catch { return siteUrl; } })(),
    post_type: 'محصول',
    featured_image: image,
    site_url: siteUrl,
    event_type: selectionType,
    product_id: row.wcProductId,
    discount_percent: discountPercent(row.regularPriceRial, row.salePriceRial),
    old_price: moneyFa(row.oldPriceRial),
    price,
    regular_price: regularPrice,
    sale_price: salePrice,
    sku: row.sku || '',
    stock_status: row.stockStatus === 'instock' ? 'موجود' : row.stockStatus === 'outofstock' ? 'ناموجود' : row.stockStatus || '',
  };
}

function contentContext(row: typeof wordpressContents.$inferSelect, siteUrl: string, selectionType: string) {
  const title = row.customTitle?.trim() || row.title;
  const body = row.customBody?.trim() || row.body;
  const image = row.customImageUrl?.trim() || row.imageUrl || '';
  let siteName = siteUrl;
  try { siteName = new URL(siteUrl).hostname; } catch { /* preserve URL text */ }
  return {
    title,
    description: body,
    excerpt: body,
    content: body,
    link: row.permalink || siteUrl,
    date: row.createdAt?.toLocaleDateString('fa-IR') || '',
    author: '',
    site_name: siteName,
    post_type: 'محتوا',
    featured_image: image,
    site_url: siteUrl,
    event_type: selectionType,
    product_id: '',
    discount_percent: '',
    old_price: '', price: '', regular_price: '', sale_price: '', sku: '', stock_status: '',
  };
}

async function assertCampaignAccess(tenantId: string): Promise<void> {
  await assertFeature(tenantId, 'woocommerce');
  await assertFeature(tenantId, 'wordpress_campaigns');
}

async function requireSite(tenantId: string, siteId: string) {
  await assertCampaignAccess(tenantId);
  const db = getDb();
  const [site] = await db.select().from(wordpressSites).where(and(eq(wordpressSites.id, siteId), eq(wordpressSites.tenantId, tenantId))).limit(1);
  if (!site) throw new AppError(ERR.NOT_FOUND('سایت'));
  if (site.status !== 'ACTIVE') throw new AppError(ERR.CONFLICT('سایت وردپرسی هنوز فعال نشده است.'));
  return site;
}

async function resolveChannels(tenantId: string, site: typeof wordpressSites.$inferSelect, requested: string[] | null | undefined) {
  const candidates = (requested?.length ? requested : (site.channelIdsJson ?? [])).slice(0, MAX_CHANNELS);
  const db = getDb();
  let rows = candidates.length
    ? await db.select({ id: channels.id }).from(channels).where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'ACTIVE'), sql`${channels.id} in (${sql.join(candidates.map((id) => sql`${id}`), sql`, `)})`))
    : [];
  if (!rows.length) {
    rows = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'ACTIVE'))).orderBy(asc(channels.createdAt)).limit(MAX_CHANNELS);
  }
  const ids = rows.map((r) => r.id);
  if (!ids.length) throw new AppError(ERR.VALIDATION('کانال فعالی برای اجرای کمپین یافت نشد.'));
  return ids;
}

export interface CampaignInput {
  name: string;
  siteId: string;
  itemType: CampaignItemType;
  selectionType: string;
  selectionIds?: number[] | null;
  templateId?: string | null;
  channelIds?: string[] | null;
  frequency: 'daily' | 'weekly';
  sendTime: string;
  days?: string[] | null;
  itemCount: number;
  isEnabled: boolean;
}

function normalizeInput(input: CampaignInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(ERR.VALIDATION('نام کمپین الزامی است.'));
  if (!validTime(input.sendTime)) throw new AppError(ERR.VALIDATION('ساعت کمپین معتبر نیست.'));
  if (!ALLOWED_SELECTIONS.has(input.selectionType)) throw new AppError(ERR.VALIDATION('نوع انتخاب کمپین معتبر نیست.'));
  if (input.itemType === 'content' && PRODUCT_ONLY_SELECTIONS.has(input.selectionType)) {
    throw new AppError(ERR.VALIDATION('این معیار انتخاب فقط برای محصولات ووکامرس قابل استفاده است.'));
  }
  const days = Array.from(new Set((input.days ?? []).map(dayKey).filter((x) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(x))));
  if (input.frequency === 'weekly' && !days.length) throw new AppError(ERR.VALIDATION('برای کمپین هفتگی حداقل یک روز انتخاب کنید.'));
  const selectionIds = Array.from(new Set((input.selectionIds ?? []).map((x) => Number(x)).filter(Number.isFinite))).slice(0, MAX_ITEMS);
  if ((input.selectionType === 'manual' || input.selectionType === 'category') && selectionIds.length === 0) throw new AppError(ERR.VALIDATION(input.selectionType === 'category' ? 'برای انتخاب دسته‌بندی، حداقل یک دسته را انتخاب کنید.' : 'برای انتخاب دستی حداقل یک مورد را انتخاب کنید.'));
  return {
    name: name.slice(0, 120),
    siteId: input.siteId,
    itemType: input.itemType,
    selectionType: input.selectionType === 'newest' ? 'latest' : input.selectionType,
    selectionIds: selectionIds.length ? selectionIds : null,
    templateId: input.templateId?.trim() || null,
    channelIds: Array.from(new Set(input.channelIds ?? [])).slice(0, MAX_CHANNELS),
    frequency: input.frequency,
    sendTime: input.sendTime,
    days: days.length ? days : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    itemCount: Math.max(1, Math.min(MAX_ITEMS, Math.floor(input.itemCount))),
    isEnabled: Boolean(input.isEnabled),
  };
}

export async function listCampaigns(tenantId: string) {
  await assertCampaignAccess(tenantId);
  const db = getDb();
  return db.select().from(wordpressCampaigns).where(eq(wordpressCampaigns.tenantId, tenantId)).orderBy(desc(wordpressCampaigns.createdAt));
}

export async function upsertCampaign(tenantId: string, input: CampaignInput, id?: string) {
  const normalized = normalizeInput(input);
  const site = await requireSite(tenantId, normalized.siteId);
  const channelIds = await resolveChannels(tenantId, site, normalized.channelIds);
  const db = getDb();
  if (normalized.templateId) {
    const [template] = await db.select({ id: messageTemplates.id }).from(messageTemplates).where(and(eq(messageTemplates.id, normalized.templateId), eq(messageTemplates.tenantId, tenantId))).limit(1);
    if (!template) throw new AppError(ERR.NOT_FOUND('قالب'));
  }
  if (id) {
    const [existing] = await db.select().from(wordpressCampaigns).where(and(eq(wordpressCampaigns.id, id), eq(wordpressCampaigns.tenantId, tenantId))).limit(1);
    if (!existing) throw new AppError(ERR.NOT_FOUND('کمپین'));
    await db.update(wordpressCampaigns).set({
      name: normalized.name,
      siteId: site.id,
      itemType: normalized.itemType,
      selectionType: normalized.selectionType,
      selectionIdsJson: normalized.selectionIds,
      templateId: normalized.templateId,
      channelIdsJson: channelIds,
      frequency: normalized.frequency,
      sendTime: normalized.sendTime,
      daysJson: normalized.days,
      itemCount: normalized.itemCount,
      isEnabled: normalized.isEnabled ? 1 : 0,
    }).where(and(eq(wordpressCampaigns.id, id), eq(wordpressCampaigns.tenantId, tenantId)));
    await audit({ action: 'wordpress.campaign_updated', actorId: tenantId, subjectType: 'wordpress_campaign', subjectId: id });
    return id;
  }

  const campaignId = newId();
  try {
    await db.insert(wordpressCampaigns).values({
      id: campaignId,
      tenantId,
      siteId: site.id,
      name: normalized.name,
      itemType: normalized.itemType,
      selectionType: normalized.selectionType,
      selectionIdsJson: normalized.selectionIds,
      templateId: normalized.templateId,
      channelIdsJson: channelIds,
      frequency: normalized.frequency,
      sendTime: normalized.sendTime,
      daysJson: normalized.days,
      itemCount: normalized.itemCount,
      isEnabled: normalized.isEnabled ? 1 : 0,
      sentIdsJson: [],
      lastRunAt: null,
      lastResultJson: null,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) {
      throw new AppError(ERR.CONFLICT('کمپینی با این نام قبلاً ثبت شده است.'));
    }
    throw err;
  }
  await audit({ action: 'wordpress.campaign_created', actorId: tenantId, subjectType: 'wordpress_campaign', subjectId: campaignId });
  return campaignId;
}

export async function deleteCampaign(tenantId: string, id: string): Promise<void> {
  await assertCampaignAccess(tenantId);
  const db = getDb();
  const result = await db.delete(wordpressCampaigns).where(and(eq(wordpressCampaigns.id, id), eq(wordpressCampaigns.tenantId, tenantId)));
  const affected = Array.isArray(result) ? Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0) : Number((result as { affectedRows?: number })?.affectedRows ?? 0);
  if (affected === 0) throw new AppError(ERR.NOT_FOUND('کمپین'));
  await audit({ action: 'wordpress.campaign_deleted', actorId: tenantId, subjectType: 'wordpress_campaign', subjectId: id });
}

export async function setCampaignEnabled(tenantId: string, id: string, enabled: boolean): Promise<void> {
  await assertCampaignAccess(tenantId);
  const db = getDb();
  const result = await db.update(wordpressCampaigns).set({ isEnabled: enabled ? 1 : 0 }).where(and(eq(wordpressCampaigns.id, id), eq(wordpressCampaigns.tenantId, tenantId)));
  const affected = Array.isArray(result) ? Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0) : Number((result as { affectedRows?: number })?.affectedRows ?? 0);
  if (affected === 0) throw new AppError(ERR.NOT_FOUND('کمپین'));
}

async function selectItems(tx: Tx, campaign: CampaignRow) {
  const sent = Array.isArray(campaign.sentIdsJson) ? campaign.sentIdsJson.map((x) => Number(x)).filter(Number.isFinite) : [];
  const limit = Math.min(MAX_ITEMS, Math.max(1, campaign.itemCount));

  if (campaign.itemType === 'product') {
    const conditions = [eq(wordpressProducts.siteId, campaign.siteId), eq(wordpressProducts.tenantId, campaign.tenantId)];
    const manualIds = Array.isArray(campaign.selectionIdsJson) ? campaign.selectionIdsJson.map((x) => Number(x)).filter(Number.isFinite) : [];
    if (campaign.selectionType === 'manual') {
      if (!manualIds.length) return [];
      conditions.push(inArray(wordpressProducts.wcProductId, manualIds));
    } else if (campaign.selectionType === 'category') {
      if (!manualIds.length) return [];
      conditions.push(sql`(${sql.join(manualIds.map((categoryId) => sql`JSON_CONTAINS(${wordpressProducts.categoriesJson}, JSON_OBJECT('id', ${categoryId}), '$') = 1`), sql` OR `)})`);
    }
    switch (campaign.selectionType) {
      case 'featured_products': conditions.push(eq(wordpressProducts.isFeatured, 1)); break;
      case 'sale_products': conditions.push(isNotNull(wordpressProducts.salePriceRial)); break;
      case 'in_stock_products': conditions.push(eq(wordpressProducts.stockStatus, 'instock')); break;
      case 'out_of_stock_products': conditions.push(eq(wordpressProducts.stockStatus, 'outofstock')); break;
    }
    const shouldExclude = campaign.selectionType !== 'latest' && campaign.selectionType !== 'manual';
    if (shouldExclude && sent.length) conditions.push(notInArray(wordpressProducts.wcProductId, sent));
    const base = tx.select().from(wordpressProducts).where(and(...conditions));
    if (campaign.selectionType === 'random') return base.orderBy(sql`RAND()`).limit(limit);
    if (campaign.selectionType === 'best_selling_products') return base.orderBy(desc(wordpressProducts.salesCount), desc(wordpressProducts.lastSyncedAt)).limit(limit);
    return base.orderBy(desc(wordpressProducts.lastSyncedAt), asc(wordpressProducts.id)).limit(limit);
  }

  const conditions = [eq(wordpressContents.siteId, campaign.siteId), eq(wordpressContents.tenantId, campaign.tenantId)];
  const manualIds = Array.isArray(campaign.selectionIdsJson) ? campaign.selectionIdsJson.map((x) => Number(x)).filter(Number.isFinite) : [];
  if (campaign.selectionType === 'manual') {
    if (!manualIds.length) return [];
    conditions.push(inArray(wordpressContents.contentId, manualIds));
  } else if (campaign.selectionType === 'category') {
    if (!manualIds.length) return [];
    conditions.push(sql`(${sql.join(manualIds.map((categoryId) => sql`JSON_CONTAINS(${wordpressContents.categoriesJson}, JSON_OBJECT('id', ${categoryId}), '$') = 1`), sql` OR `)})`);
  }
  if (campaign.selectionType !== 'latest' && campaign.selectionType !== 'manual' && sent.length) conditions.push(notInArray(wordpressContents.contentId, sent));
  const base = tx.select().from(wordpressContents).where(and(...conditions));
  if (campaign.selectionType === 'random') return base.orderBy(sql`RAND()`).limit(limit);
  return base.orderBy(desc(wordpressContents.createdAt), asc(wordpressContents.id)).limit(limit);
}

export async function runCampaign(tenantId: string, id: string, force = false) {
  await assertCampaignAccess(tenantId);
  const db = getDb();
  let result: { queued: number; items: number; channels: number; skipped: number } = { queued: 0, items: 0, channels: 0, skipped: 0 };
  await recordAnalyticsEvent({ userId: tenantId, eventType: 'wordpress.campaign.run.started', campaignId: id, source: 'campaign', metadata: { force } });

  try {
    await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(wordpressCampaigns).where(and(eq(wordpressCampaigns.id, id), eq(wordpressCampaigns.tenantId, tenantId))).limit(1).for('update');
    if (!campaign) throw new AppError(ERR.NOT_FOUND('کمپین'));
    if (!force && !campaign.isEnabled) throw new AppError(ERR.CONFLICT('کمپین غیرفعال است.'));

    // The outer scheduler eligibility check runs outside this row lock. Two
    // scheduler invocations can therefore both observe the same stale
    // lastRunAt. Re-evaluate the slot after locking the campaign row so only
    // the first transaction for a scheduled slot can publish items.
    if (!force) {
      const [owner] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, tenantId)).limit(1);
      const lockedNow = new Date();
      if (!selectedSlot(campaign, lockedNow, owner?.timezone || 'Asia/Tehran')) return;
    }

    const [site] = await tx.select().from(wordpressSites).where(and(eq(wordpressSites.id, campaign.siteId), eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.status, 'ACTIVE'))).limit(1);
    if (!site) throw new AppError(ERR.CONFLICT('سایت وردپرسی کمپین فعال نیست.'));

    const channelIds = (campaign.channelIdsJson ?? []).slice(0, MAX_CHANNELS);
    const activeChannels = await tx.select({ id: channels.id }).from(channels).where(and(
      eq(channels.tenantId, tenantId),
      eq(channels.status, 'ACTIVE'),
      channelIds.length ? inArray(channels.id, channelIds) : sql`1=1`,
    )).limit(MAX_CHANNELS);
    if (!activeChannels.length) throw new AppError(ERR.VALIDATION('کانال فعالی برای اجرای کمپین یافت نشد.'));

    let templateBody = '{title}\n\n{description}\n\n🔗 {link}';
    if (campaign.templateId) {
      const [template] = await tx.select({ body: messageTemplates.body }).from(messageTemplates).where(and(eq(messageTemplates.id, campaign.templateId), eq(messageTemplates.tenantId, tenantId))).limit(1);
      if (!template) throw new AppError(ERR.NOT_FOUND('قالب'));
      templateBody = template.body;
    }

    const items = await selectItems(tx, campaign);
    const sentIds = Array.isArray(campaign.sentIdsJson) ? campaign.sentIdsJson.map((x) => Number(x)).filter(Number.isFinite) : [];
    const sentSet = new Set(sentIds);
    let queued = 0;
    let skipped = 0;
    let processedItems = 0;
    for (const item of items) {
      const itemId = campaign.itemType === 'product'
        ? Number((item as typeof wordpressProducts.$inferSelect).wcProductId)
        : Number((item as typeof wordpressContents.$inferSelect).contentId);
      if (!Number.isFinite(itemId)) continue;
      const context = campaign.itemType === 'product'
        ? productContext(item as typeof wordpressProducts.$inferSelect, site.siteUrl, campaign.selectionType)
        : contentContext(item as typeof wordpressContents.$inferSelect, site.siteUrl, campaign.selectionType);
      const body = renderTemplate(templateBody, context);
      if (!body) { skipped++; continue; }

      // Every campaign item gets the same durable post/target state machine as
      // normal publishing. The outbox carries the WordPress-specific rendered
      // body/image, while post_targets remains the authoritative delivery state.
      const postId = newId();
      await tx.insert(posts).values({
        id: postId,
        tenantId,
        title: String(context.title ?? '').slice(0, 190) || null,
        body,
        source: 'WORDPRESS',
        state: 'QUEUED',
      });

      for (const ch of activeChannels) {
        const targetId = newId();
        await tx.insert(postTargets).values({
          id: targetId,
          postId,
          tenantId,
          channelId: ch.id,
          state: 'PENDING',
        });
        const row = outboxRow({
          aggregateType: 'wordpress',
          aggregateId: site.id,
          eventType: 'wordpress.publish',
          payload: {
            tenantId,
            siteId: site.id,
            itemType: campaign.itemType,
            itemId,
            productId: campaign.itemType === 'product' ? itemId : undefined,
            contentId: campaign.itemType === 'content' ? itemId : undefined,
            channelId: ch.id,
            targetId,
            postId,
            title: String(context.title ?? '').slice(0, 190),
            body,
            imageUrl: String(context.featured_image ?? '') || null,
            campaignId: campaign.id,
          },
        });
        await tx.insert(outboxEvents).values(row);
        queued++;
      }
      processedItems++;
      // sentIdsJson is updated only by the delivery worker after a provider
      // confirms at least one successful send. Queueing is not a successful send.
    }

    result = { queued, items: processedItems, channels: activeChannels.length, skipped };
    await tx.update(wordpressCampaigns).set({
      lastRunAt: new Date(),
      // Keep only confirmed sent ids here; queued items are intentionally not
      // added until delivery succeeds.
      sentIdsJson: Array.from(sentSet).slice(-5000),
      lastResultJson: { ...result, finishedAt: new Date().toISOString() },
    }).where(and(eq(wordpressCampaigns.id, campaign.id), eq(wordpressCampaigns.tenantId, tenantId)));
    });
  } catch (error) {
    await recordAnalyticsEvent({ userId: tenantId, eventType: 'wordpress.campaign.run.failed', campaignId: id, source: 'campaign', metadata: { error: error instanceof Error ? error.message : String(error).slice(0, 500) } });
    throw error;
  }

  await recordAnalyticsEvent({ userId: tenantId, eventType: 'wordpress.campaign.items.queued', campaignId: id, source: 'campaign', value: result.queued, metadata: result });
  await recordAnalyticsEvent({ userId: tenantId, eventType: 'wordpress.campaign.run.completed', campaignId: id, source: 'campaign', metadata: result });
  await audit({ action: 'wordpress.campaign_run', actorId: tenantId, subjectType: 'wordpress_campaign', subjectId: id, meta: result });
  return result;
}

export async function runDueCampaigns(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const campaigns = await db.select().from(wordpressCampaigns).where(eq(wordpressCampaigns.isEnabled, 1)).orderBy(asc(wordpressCampaigns.sendTime)).limit(100);
  let ran = 0;
  for (const campaign of campaigns) {
    const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, campaign.tenantId)).limit(1);
    const timeZone = user?.timezone || 'Asia/Tehran';
    if (!selectedSlot(campaign, now, timeZone)) continue;
    try {
      await runCampaign(campaign.tenantId, campaign.id, false);
      ran++;
    } catch {
      // One broken campaign must not block the remaining schedule lane.
    }
  }
  return ran;
}
