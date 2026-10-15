import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { channels, goldConfigs, goldSnapshots, outboxEvents, postTargets, posts } from '../../db/schema.js';
import { newId, sha256Hex } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { httpRaw, assertSafeUrl } from '../../core/http.js';
import { outboxRow } from '../../core/outbox.js';
import { getPlanContext } from '../subscriptions/plan.service.js';
import { getGoldSettings } from '../admin/system-settings.service.js';

/**
 * Gold ticker (§29): scheduled price scraping → tolerant parser → snapshot →
 * optional publish through the tenant's ACTIVE channels. Gated by the plan
 * feature gold_ticker. SSRF-guarded fetch on every run (§60) since sourceUrl
 * is user-influenced.
 */

const DEFAULT_SOURCE_URL = 'https://www.tgju.org';
const DEFAULT_TEMPLATE =
  '🪙 نرخ لحظه‌ای طلا و سکه:\n\n' +
  'دلار: {دلار}\n' +
  'طلای ۱۸ عیار: {طلای ۱۸ عیار}\n' +
  'سکه امامی: {سکه امامی}\n\n' +
  ' توسط ربات پُست‌یار';

export interface GoldPrice {
  label: string;
  value: number;
}

export interface GoldConfigDto {
  id: string;
  tenantId: string;
  sourceUrl: string;
  templateText: string;
  channelIds: string[];
  frequencyMinutes: number;
  timezone: string;
  changeOnly: boolean;
  isEnabled: boolean;
  lastSnapshot: unknown;
  lastRunAt: Date | null;
}

export interface GoldRunResult {
  configId: string;
  ok: boolean;
  changed: boolean;
  published: boolean;
  postId: string | null;
  prices: GoldPrice[];
  message: string | null;
}

export interface SaveGoldConfigInput {
  sourceUrl: string;
  templateText: string;
  channelIds: string[];
  frequencyMinutes: number;
  timezone: string;
  changeOnly: boolean;
  isEnabled: boolean;
}

async function requireGoldFeature(tenantId: string): Promise<void> {
  const ctx = await getPlanContext(tenantId);
  if (!ctx.features.gold_ticker) {
    throw new AppError({ ...ERR.FORBIDDEN(), message: 'ماژول طلا در پلن فعلی شما فعال نیست.' });
  }
}

function toDto(row: typeof goldConfigs.$inferSelect): GoldConfigDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceUrl: row.sourceUrl,
    templateText: row.templateText,
    channelIds: Array.isArray(row.channelIds) ? row.channelIds : [],
    frequencyMinutes: row.frequencyMinutes,
    timezone: row.timezone,
    changeOnly: row.changeOnly === 1,
    isEnabled: row.isEnabled === 1,
    lastSnapshot: row.lastSnapshotJson ?? null,
    lastRunAt: row.lastRunAt,
  };
}

export async function getGoldConfig(tenantId: string): Promise<GoldConfigDto> {
  await requireGoldFeature(tenantId);
  const db = getDb();
  const [row] = await db.select().from(goldConfigs).where(eq(goldConfigs.tenantId, tenantId)).limit(1);
  if (row) return toDto(row); // existing rows keep their own values — unchanged behavior
  // Lazy default row so the settings form is immediately editable.
  // Round 18: the admin-configured defaults (system_settings key 'gold') win
  // when non-empty; otherwise the built-in constants below apply.
  let sourceUrl = DEFAULT_SOURCE_URL;
  let template = DEFAULT_TEMPLATE;
  let frequencyMinutes = 60;
  try {
    const admin = await getGoldSettings();
    if (admin.defaultSourceUrl !== '') sourceUrl = admin.defaultSourceUrl;
    if (admin.defaultTemplateFa !== '') template = admin.defaultTemplateFa;
    frequencyMinutes = admin.defaultFrequencyMinutes;
  } catch {
    // settings read failure → built-in defaults (never block the user form)
  }
  const id = newId();
  await db.insert(goldConfigs).values({
    id,
    tenantId,
    sourceUrl,
    templateText: template,
    channelIds: [],
    frequencyMinutes,
    timezone: 'Asia/Tehran',
    changeOnly: 1,
    isEnabled: 0,
  });
  const [created] = await db.select().from(goldConfigs).where(eq(goldConfigs.tenantId, tenantId)).limit(1);
  if (!created) throw new AppError(ERR.INTERNAL());
  return toDto(created);
}

export async function saveGoldConfig(tenantId: string, input: SaveGoldConfigInput): Promise<GoldConfigDto> {
  await requireGoldFeature(tenantId);
  const db = getDb();

  if (input.frequencyMinutes < 15) {
    throw new AppError(ERR.VALIDATION('فاصلهٔ به‌روزرسانی نباید کمتر از ۱۵ دقیقه باشد.'));
  }
  // Save-time SSRF validation; the fetch re-validates on every run (DNS rebinding).
  await assertSafeUrl(input.sourceUrl);

  const uniqueChannelIds = [...new Set(input.channelIds)];
  if (uniqueChannelIds.length > 0) {
    const rows = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), inArray(channels.id, uniqueChannelIds)));
    if (rows.length !== uniqueChannelIds.length) {
      throw new AppError(ERR.VALIDATION('یکی از کانال‌های انتخاب‌شده معتبر نیست.'));
    }
  }

  const [existing] = await db.select().from(goldConfigs).where(eq(goldConfigs.tenantId, tenantId)).limit(1);
  const values = {
    sourceUrl: input.sourceUrl,
    templateText: input.templateText,
    channelIds: uniqueChannelIds,
    frequencyMinutes: input.frequencyMinutes,
    timezone: input.timezone || 'Asia/Tehran',
    changeOnly: input.changeOnly ? 1 : 0,
    isEnabled: input.isEnabled ? 1 : 0,
  };
  if (existing) {
    await db.update(goldConfigs).set(values).where(eq(goldConfigs.id, existing.id));
  } else {
    await db.insert(goldConfigs).values({ id: newId(), tenantId, ...values });
  }
  const [row] = await db.select().from(goldConfigs).where(eq(goldConfigs.tenantId, tenantId)).limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());
  return toDto(row);
}

// ---- tolerant price parser -------------------------------------------------

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const p = PERSIAN_DIGITS.indexOf(d);
    if (p >= 0) return String(p);
    return String(ARABIC_DIGITS.indexOf(d));
  });
}

/** Label detection rules — order matters (specific before generic). */
const LABEL_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /سکه\s*امامی/, label: 'سکه امامی' },
  { re: /نیم\s*سکه|سکه\s*نیم/, label: 'نیم سکه' },
  { re: /ربع\s*سکه|سکه\s*ربع/, label: 'ربع سکه' },
  { re: /سکه\s*گرمی|گرمی/, label: 'سکه گرمی' },
  { re: /سکه/, label: 'سکه' },
  { re: /طلای\s*18|عِیار\s*18|عیار\s*18|18\s*عیار/, label: 'طلای ۱۸ عیار' },
  { re: /انس/, label: 'انس جهانی' },
  { re: /دلار/, label: 'دلار' },
  { re: /یورو/, label: 'یورو' },
  { re: /درهم/, label: 'درهم' },
  { re: /لیر/, label: 'لیر' },
  { re: /گرم/, label: 'طلای گرم' },
];

function extractNumber(line: string): number | null {
  const match = line.match(/(\d[\d,،٬./\s]*\d|\d)/);
  const captured = match?.[1];
  if (!captured) return null;
  let raw = captured.replace(/[\s,،٬]/g, '');
  if (raw.includes('/') && !raw.includes('.')) raw = raw.replace(/\//g, '.');
  const dots = (raw.match(/\./g) ?? []).length;
  if (dots > 1) {
    const parts = raw.split('.');
    const last = parts.pop() ?? '';
    raw = parts.join('') + (last.length <= 2 ? `.${last}` : last);
  } else if (dots === 1) {
    const [intPart, fracPart = ''] = raw.split('.');
    if (fracPart.length > 2) raw = intPart + fracPart; // likely a thousands dot
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Tolerant parser: Persian/Arabic digits, common separators, keyword lines. */
export function parseGoldPrices(input: string): GoldPrice[] {
  const text = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  const lines = normalizeDigits(text).split(/\r?\n|\u2028/);
  const out: GoldPrice[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const rule = LABEL_RULES.find((r) => r.re.test(line));
    if (!rule) continue;
    if (seen.has(rule.label)) continue;
    const value = extractNumber(line.replace(rule.re, ' '));
    if (value === null) continue;
    seen.add(rule.label);
    out.push({ label: rule.label, value });
    if (out.length >= 12) break;
  }
  return out;
}

function toPersianNumber(value: number): string {
  const formatted = Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return formatted.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/** Replace {label} / {{label}} placeholders; unknown placeholders are removed. */
export function renderGoldTemplate(template: string, prices: GoldPrice[]): string {
  let out = template;
  for (const price of prices) {
    const formatted = toPersianNumber(price.value);
    out = out.split(`{{${price.label}}}`).join(formatted);
    out = out.split(`{${price.label}}`).join(formatted);
  }
  return out.replace(/\{\{?[^{}\n]+\}?\}/g, '').trim();
}

// ---- run -------------------------------------------------------------------

export async function runGoldCheck(configId: string): Promise<GoldRunResult> {
  const db = getDb();
  const [config] = await db.select().from(goldConfigs).where(eq(goldConfigs.id, configId)).limit(1);
  if (!config) throw new AppError(ERR.NOT_FOUND('پیکربندی طلا'));

  const result: GoldRunResult = {
    configId,
    ok: false,
    changed: false,
    published: false,
    postId: null,
    prices: [],
    message: null,
  };

  try {
    const res = await httpRaw(config.sourceUrl, { ssrfGuard: true, timeoutMs: 15_000 });
    if (res.status >= 400) {
      result.message = 'دریافت اطلاعات از منبع ناموفق بود.';
      return result;
    }
    const prices = parseGoldPrices(res.body);
    if (prices.length === 0) {
      result.message = 'هیچ قیمتی از منبع استخراج نشد.';
      return result;
    }
    result.prices = prices;
    const contentHash = await sha256Hex(JSON.stringify(prices));

    // Serialize scheduler/manual executions on the gold config row. The source
    // fetch remains outside the transaction, while the latest-snapshot check,
    // publication outbox, snapshot and lastRunAt commit atomically. A concurrent
    // run therefore re-checks the fresh snapshot and cannot publish the same
    // price twice after the first transaction commits.
    await db.transaction(async (tx) => {
      const [lockedConfig] = await tx
        .select()
        .from(goldConfigs)
        .where(eq(goldConfigs.id, configId))
        .limit(1)
        .for('update');
      if (!lockedConfig) throw new AppError(ERR.NOT_FOUND('پیکربندی طلا'));

      const [last] = await tx
        .select({ contentHash: goldSnapshots.contentHash })
        .from(goldSnapshots)
        .where(eq(goldSnapshots.configId, configId))
        .orderBy(desc(goldSnapshots.capturedAt))
        .limit(1);
      const changed = !last || last.contentHash !== contentHash;
      result.changed = changed;

      const willPublish =
        (changed || lockedConfig.changeOnly !== 1) && lockedConfig.isEnabled === 1 && lockedConfig.channelIds.length > 0;

      if (willPublish) {
        const activeChannels = await tx
          .select({ id: channels.id })
          .from(channels)
          .where(
            and(
              eq(channels.tenantId, lockedConfig.tenantId),
              eq(channels.status, 'ACTIVE'),
              inArray(channels.id, lockedConfig.channelIds)
            )
          );
        if (activeChannels.length > 0) {
          const postId = newId();
          const body = renderGoldTemplate(lockedConfig.templateText, prices);
          await tx.insert(posts).values({
            id: postId,
            tenantId: lockedConfig.tenantId,
            title: 'نرخ لحظه‌ای طلا و سکه',
            body,
            parseMode: 'NONE',
            source: 'GOLD',
            state: 'QUEUED',
          });
          for (const channel of activeChannels) {
            await tx.insert(postTargets).values({
              id: newId(),
              postId,
              tenantId: lockedConfig.tenantId,
              channelId: channel.id,
              state: 'PENDING',
            });
          }
          await tx.insert(outboxEvents).values(
            outboxRow({ aggregateType: 'post', aggregateId: postId, eventType: 'post.publish', payload: {} })
          );
          result.published = true;
          result.postId = postId;
        }
      }

      await tx.insert(goldSnapshots).values({
        id: newId(),
        configId,
        pricesJson: prices,
        contentHash,
        published: result.published ? 1 : 0,
      });
      await tx
        .update(goldConfigs)
        .set({ lastRunAt: new Date(), lastSnapshotJson: prices })
        .where(eq(goldConfigs.id, configId));
    });

    result.ok = true;
    return result;
  } catch (err) {
    result.message = err instanceof AppError ? err.userMessage : 'بررسی نرخ طلا و سکه ناموفق بود.';
    // Record the attempt so a failing source is retried at the next frequency,
    // but only after all publish/snapshot work has been rolled back as one unit.
    await db
      .update(goldConfigs)
      .set({ lastRunAt: new Date() })
      .where(eq(goldConfigs.id, configId))
      .catch(() => undefined);
    return result;
  }
}

export async function runNow(tenantId: string): Promise<GoldRunResult> {
  const config = await getGoldConfig(tenantId); // feature-gated, auto-creates the row
  return runGoldCheck(config.id);
}
