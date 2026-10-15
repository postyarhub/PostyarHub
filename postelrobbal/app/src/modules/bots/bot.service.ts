import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  bots, channels, botUsers, botCommands, botKeywords, botEvents, botConversations, botMessages, events, users,
} from '../../db/schema.js';
import { newId, newToken, sha256Hex, timingSafeEqualStr } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { encryptSecret, decryptSecret, maskSecret } from '../../security/encryption.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { loadEnv } from '../../config/env.js';
import { getRedis } from '../../queue/connection.js';
import { enqueue } from '../../queue/queues.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';
import { createLogger } from '../../core/logger.js';
import { extractBotMessage } from '../../core/bot-message.js';
import { handleRubikaChannelDiscovery } from '../channels/channel.service.js';
import { MAX_BOT_USER_EXPORT, type BotUserExportRow } from './bot-users-export.js';

/**
 * Bot lifecycle (ADR-0008): tokens are AES-256-GCM encrypted at rest (§92),
 * only masked values ever leave the service (§93), verification goes through
 * the platform provider, and webhook mode registers a secret-protected URL.
 */

type BotRow = typeof bots.$inferSelect;

const botLog = createLogger('bot-service');

function asId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.length > 0 && v.length <= 190) return v;
  return null;
}

export interface BotPublic {
  id: string;
  platform: Platform;
  title: string;
  username: string | null;
  status: string;
  mode: string;
  tokenMasked: string;
  aiEnabled: boolean;
  aiSystemPrompt: string | null;
  lastEventAt: Date | null;
  healthJson: Record<string, unknown> | null;
  createdAt: Date;
}

function toPublicHealth(row: BotRow): Record<string, unknown> | null {
  const raw = row.healthJson;
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  // Never expose webhook URLs because Bale/Rubika may keep their secret in
  // the query string. Provider identity is intentionally non-secret and is
  // useful for operational diagnostics.
  const allowed = [
    'ok', 'verify', 'providerBotId', 'verifiedAt', 'connectionMode', 'lastEnable',
    'checkedAt', 'errorCode', 'verifyError', 'errorClass', 'errorMessageFa', 'failedAt', 'webhook',
  ];
  return Object.fromEntries(allowed.filter((key) => src[key] !== undefined).map((key) => [key, src[key]]));
}

function toPublicBot(row: BotRow): BotPublic {
  return {
    id: row.id,
    platform: row.platform,
    title: row.title,
    username: row.username,
    status: row.status,
    mode: row.mode,
    tokenMasked: row.tokenMasked,
    aiEnabled: row.aiEnabled === 1,
    aiSystemPrompt: row.aiSystemPrompt,
    lastEventAt: row.lastEventAt,
    healthJson: toPublicHealth(row),
    createdAt: row.createdAt,
  };
}

/** Map a classified ProviderError to the Persian-safe AppError contract (§114). */
export function mapProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const cls = (err as { providerClass?: unknown }).providerClass;
  if (typeof cls !== 'string') return new AppError(ERR.PROVIDER_UNAVAILABLE());
  const rawMsg = (err as { userMessageFa?: unknown }).userMessageFa;
  const fa = typeof rawMsg === 'string' ? rawMsg : undefined;
  switch (cls) {
    case 'UNAUTHORIZED':
      return new AppError(ERR.PROVIDER_UNAUTHORIZED());
    case 'RATE_LIMITED':
      return new AppError(ERR.PROVIDER_RATE_LIMITED());
    case 'TRANSIENT':
      return new AppError(ERR.PROVIDER_UNAVAILABLE());
    case 'NOT_FOUND':
      return new AppError(ERR.VALIDATION(fa ?? 'ربات یا مقصد در پلتفرم یافت نشد.'));
    case 'BLOCKED':
      return new AppError(ERR.VALIDATION(fa ?? 'دسترسی ربات به مقصد مسدود است.'));
    case 'VALIDATION':
      return new AppError(ERR.VALIDATION(fa));
    default:
      return new AppError(ERR.PROVIDER_UNAVAILABLE());
  }
}

export async function getOwnedBot(tenantId: string, botId: string): Promise<BotRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('ربات'));
  return row;
}

// ---------- listing / connection ----------

export async function listBots(tenantId: string): Promise<BotPublic[]> {
  const db = getDb();
  const rows = await db.select().from(bots).where(eq(bots.tenantId, tenantId)).orderBy(desc(bots.createdAt));
  return rows.map(toPublicBot); // never exposes tokenEncrypted/webhookSecret (§93)
}

async function withProviderIdentityLock<T>(platform: Platform, providerId: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const key = `postyar:bot-identity:${platform}:${providerId}`;
  const lockValue = `${process.pid}:${newToken(12)}`;
  const acquired = await redis.set(key, lockValue, 'EX', 60, 'NX');
  if (acquired !== 'OK') throw new AppError(ERR.VALIDATION('همین ربات هم‌زمان در حال اتصال یا بررسی است. دوباره تلاش کنید.'));
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      lockValue,
    ).catch(() => undefined);
  }
}

async function assertProviderIdentityFree(
  platform: Platform,
  providerId: string,
  username?: string | null,
  excludeBotId?: string,
): Promise<void> {
  const rows = await getDb()
    .select({ id: bots.id, username: bots.username, healthJson: bots.healthJson })
    .from(bots)
    .where(eq(bots.platform, platform));
  for (const row of rows) {
    if (excludeBotId && row.id === excludeBotId) continue;
    const health = (row.healthJson ?? {}) as Record<string, unknown>;
    if (health['providerBotId'] === providerId || (username && row.username === username)) {
      throw new AppError(ERR.DUPLICATE('این ربات'));
    }
  }
}

function buildBotWebhookUrl(botId: string, webhookSecret: string, platform: Platform): string {
  const base = loadEnv().API_URL.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new AppError(ERR.VALIDATION('برای وبهوک روبیکا، آدرس API باید عمومی و با HTTPS باشد.'));
  }
  return platform === 'telegram'
    ? `${base}/api/v1/webhooks/bots/${botId}`
    : `${base}/api/v1/webhooks/bots/${botId}?s=${encodeURIComponent(webhookSecret)}`;
}

export async function connectBot(
  tenantId: string,
  input: { platform: Platform; token: string; title?: string }
): Promise<BotPublic> {
  const token = input.token.trim();
  if (!token) throw new AppError(ERR.VALIDATION('توکن ربات نمی‌تواند خالی باشد.'));
  const provider = getProvider(input.platform);
  const identity = await provider.verifyBot(token).catch((err: unknown) => {
    throw mapProviderError(err);
  });
  if (!identity.id.trim()) throw new AppError(ERR.VALIDATION('شناسهٔ ربات از پلتفرم دریافت نشد.'));

  return withProviderIdentityLock(input.platform, identity.id, async () => {
    await assertProviderIdentityFree(input.platform, identity.id, identity.username);
    const db = getDb();
    const id = newId();
    const now = new Date();
    const mode = input.platform === 'rubika' ? 'WEBHOOK' : 'POLLING';
    const webhookSecret = provider.capabilities().webhook ? newToken(24) : null;
    if (mode === 'POLLING' && provider.capabilities().webhook && typeof provider.deleteWebhook === 'function') {
      await provider.deleteWebhook(token).catch((err: unknown) => { throw mapProviderError(err); });
    }
    await db.transaction(async (tx) => {
      // Serialize bot creation per tenant so max_bots cannot be exceeded by
      // concurrent connect requests that all pass an earlier count check.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
      await assertWithinLimit(tenantId, 'bots');
      await tx.insert(bots).values({
        id, tenantId, platform: input.platform, tokenEncrypted: encryptSecret(token), tokenMasked: maskSecret(token),
        username: identity.username, title: (input.title?.trim() || identity.title || 'ربات').slice(0, 190), status: 'ACTIVE', mode,
        webhookSecret, healthJson: { verify: 'ok', providerBotId: identity.id, verifiedAt: now.toISOString(), connectionMode: mode },
      });
    });
  const created = await getOwnedBot(tenantId, id);
  if (mode === 'WEBHOOK' && provider.capabilities().webhook && typeof provider.setWebhook === 'function' && webhookSecret) {
    const url = buildBotWebhookUrl(id, webhookSecret, input.platform);
    try {
      await provider.setWebhook(token, url, webhookSecret);
      await db.update(bots).set({ webhookUrl: url.slice(0, 255), webhookRegisteredAt: now }).where(eq(bots.id, id));
    } catch (err) {
      const mapped = mapProviderError(err);
      await db.update(bots).set({
        status: 'ERROR',
        healthJson: { verify: 'ok', webhook: 'failed', webhookUrl: url, errorClass: mapped instanceof Error && 'providerClass' in mapped ? String((mapped as { providerClass?: unknown }).providerClass ?? '') : 'UNKNOWN', errorMessageFa: mapped instanceof Error ? mapped.message : 'خطای اتصال وبهوک روبیکا', failedAt: new Date().toISOString() },
      }).where(eq(bots.id, id)).catch(() => undefined);
      throw mapped;
    }
  }

  await emitEvent({
    name: 'bot.created',
    tenantId,
    subjectType: 'bot',
    subjectId: id,
    props: { platform: input.platform },
  });
    await audit({ action: 'bot.connect', actorId: tenantId, subjectType: 'bot', subjectId: id, meta: { platform: input.platform } });
    return toPublicBot(created);
  });
}

export async function verifyBot(
  tenantId: string,
  botId: string
): Promise<{ username: string | null; title: string }> {
  const bot = await getOwnedBot(tenantId, botId);
  const provider = getProvider(bot.platform);
  const identity = await provider.verifyBot(decryptSecret(bot.tokenEncrypted)).catch((err: unknown) => {
    throw mapProviderError(err);
  });
  if (!identity.id.trim()) throw new AppError(ERR.VALIDATION('شناسهٔ ربات از پلتفرم دریافت نشد.'));
  await withProviderIdentityLock(bot.platform, identity.id, async () => {
    await assertProviderIdentityFree(bot.platform, identity.id, identity.username, bot.id);
    const db = getDb();
    await db
      .update(bots)
      .set({
        username: identity.username,
        healthJson: { ...((bot.healthJson ?? {}) as Record<string, unknown>), verify: 'ok', providerBotId: identity.id, verifiedAt: new Date().toISOString() },
      })
      .where(eq(bots.id, bot.id));
  });
  await audit({ action: 'bot.verify', actorId: tenantId, subjectType: 'bot', subjectId: bot.id });
  return { username: identity.username, title: identity.title };
}

export async function enableBot(tenantId: string, botId: string): Promise<BotPublic> {
  const db = getDb();
  let enabled = false;
  await db.transaction(async (tx) => {
    const [bot] = await tx
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId)))
      .limit(1)
      .for('update');
    if (!bot) throw new AppError(ERR.NOT_FOUND('ربات'));
    if (bot.status === 'ACTIVE') return;

    const provider = getProvider(bot.platform);
    const token = decryptSecret(bot.tokenEncrypted);
    let webhookSecret = bot.webhookSecret;
    let webhookUrl = bot.webhookUrl;
    let webhookRegisteredAt = bot.webhookRegisteredAt;

    if (bot.mode === 'WEBHOOK' && provider.capabilities().webhook && typeof provider.setWebhook === 'function') {
      if (!webhookSecret) webhookSecret = newToken(24);
      const url = buildBotWebhookUrl(bot.id, webhookSecret, bot.platform);
      await provider.setWebhook(token, url, webhookSecret).catch((err: unknown) => {
        throw mapProviderError(err);
      });
      webhookUrl = url.slice(0, 255);
      webhookRegisteredAt = new Date();
    } else if (bot.mode === 'POLLING') {
      if (provider.capabilities().webhook && typeof provider.deleteWebhook === 'function') {
        await provider.deleteWebhook(token).catch((err: unknown) => { throw mapProviderError(err); });
      }
      webhookUrl = null;
      webhookRegisteredAt = null;
    }

    await tx
      .update(bots)
      .set({
        status: 'ACTIVE',
        webhookSecret,
        webhookUrl,
        webhookRegisteredAt,
        healthJson: { ...((bot.healthJson ?? {}) as Record<string, unknown>), lastEnable: new Date().toISOString() },
      })
      .where(eq(bots.id, bot.id));
    enabled = true;
  });

  if (enabled) {
    await emitEvent({ name: 'bot.enabled', tenantId, subjectType: 'bot', subjectId: botId });
    await audit({ action: 'bot.enable', actorId: tenantId, subjectType: 'bot', subjectId: botId });
  }
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

export async function disableBot(tenantId: string, botId: string): Promise<BotPublic> {
  const db = getDb();
  let disabled = false;
  const now = new Date();
  await db.transaction(async (tx) => {
    const [bot] = await tx
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId)))
      .limit(1)
      .for('update');
    if (!bot) throw new AppError(ERR.NOT_FOUND('ربات'));
    if (bot.status === 'DISABLED') return;

    const provider = getProvider(bot.platform);
    if (bot.platform !== 'rubika' && provider.capabilities().webhook && typeof provider.deleteWebhook === 'function') {
      await provider.deleteWebhook(decryptSecret(bot.tokenEncrypted)).catch((err: unknown) => {
        // Disabling ingress is still enforced in Postyar even if provider-side
        // webhook deletion is temporarily unavailable. Record the incident and
        // continue with the durable application-side DISABLED state.
        logProviderDisableFailure(bot.id, err);
      });
    }

    await tx.update(bots).set({ status: 'DISABLED' }).where(and(eq(bots.id, bot.id), eq(bots.status, 'ACTIVE')));

    await tx
      .update(channels)
      .set({
        status: 'PENDING_VERIFY',
        lastVerifiedAt: null,
        healthJson: { ok: false, errorCode: 'BOT_DISABLED', checkedAt: now.toISOString() },
        updatedAt: now,
      })
      .where(and(eq(channels.tenantId, tenantId), eq(channels.botId, bot.id), eq(channels.status, 'ACTIVE')));
    disabled = true;
  });

  if (disabled) {
    await emitEvent({ name: 'bot.disabled', tenantId, subjectType: 'bot', subjectId: botId });
    await audit({ action: 'bot.disable', actorId: tenantId, subjectType: 'bot', subjectId: botId });
  }
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

function logProviderDisableFailure(botId: string, err: unknown): void {
  botLog.warn({ botId, error: err instanceof Error ? err.message : String(err ?? '') }, 'bot_webhook_delete_on_disable_failed');
}

export async function setBotMode(tenantId: string, botId: string, mode: 'WEBHOOK' | 'POLLING'): Promise<BotPublic> {
  const db = getDb();
  let changed = false;
  await db.transaction(async (tx) => {
    const [bot] = await tx
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId)))
      .limit(1)
      .for('update');
    if (!bot) throw new AppError(ERR.NOT_FOUND('ربات'));
    if (mode === bot.mode) return;
    if (bot.platform === 'rubika' && mode === 'POLLING') {
      throw new AppError(ERR.VALIDATION('برای روبیکا حالت وبهوک رسمی فعال است؛ برای جلوگیری از دو دریافت هم‌زمان، حالت پایش دوره‌ای از پنل قابل انتخاب نیست.'));
    }

    const provider = getProvider(bot.platform);
    let webhookSecret = bot.webhookSecret;
    let webhookUrl: string | null = bot.webhookUrl;
    let webhookRegisteredAt: Date | null = bot.webhookRegisteredAt;

    if (mode === 'WEBHOOK') {
      if (!provider.capabilities().webhook || typeof provider.setWebhook !== 'function') {
        throw new AppError(ERR.VALIDATION('این پلتفرم از حالت وبهوک پشتیبانی نمی‌کند.'));
      }
      if (!webhookSecret) webhookSecret = newToken(24);
      if (bot.status === 'ACTIVE') {
        const url = buildBotWebhookUrl(bot.id, webhookSecret, bot.platform);
        await provider.setWebhook(decryptSecret(bot.tokenEncrypted), url, webhookSecret).catch((err: unknown) => {
          throw mapProviderError(err);
        });
        webhookUrl = url.slice(0, 255);
        webhookRegisteredAt = new Date();
      } else {
        webhookUrl = null;
        webhookRegisteredAt = null;
      }
    } else {
      if (provider.capabilities().webhook && typeof provider.deleteWebhook === 'function') {
        await provider.deleteWebhook(decryptSecret(bot.tokenEncrypted)).catch((err: unknown) => { throw mapProviderError(err); });
      }
      webhookUrl = null;
      webhookRegisteredAt = null;
    }

    await tx
      .update(bots)
      .set({ mode, webhookSecret, webhookUrl, webhookRegisteredAt })
      .where(and(eq(bots.id, bot.id), eq(bots.mode, bot.mode)));
    changed = true;
  });

  if (changed) {
    await audit({ action: 'bot.mode', actorId: tenantId, subjectType: 'bot', subjectId: botId, meta: { mode } });
  }
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

export async function updateAiSettings(
  tenantId: string,
  botId: string,
  input: { aiEnabled: boolean; aiSystemPrompt?: string | null }
): Promise<BotPublic> {
  const bot = await getOwnedBot(tenantId, botId);
  const db = getDb();
  await db
    .update(bots)
    .set({
      aiEnabled: input.aiEnabled ? 1 : 0,
      aiSystemPrompt: input.aiSystemPrompt === undefined ? bot.aiSystemPrompt : input.aiSystemPrompt,
    })
    .where(eq(bots.id, bot.id));
  await audit({
    action: 'bot.ai_settings',
    actorId: tenantId,
    subjectType: 'bot',
    subjectId: bot.id,
    meta: { aiEnabled: input.aiEnabled },
  });
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

/** Internal use only (worker/delivery) — never exposed through HTTP. */
export async function getBotToken(tenantId: string, botId: string): Promise<string> {
  const bot = await getOwnedBot(tenantId, botId);
  return decryptSecret(bot.tokenEncrypted);
}

// ---------- users / stats ----------

export async function listBotUsers(
  tenantId: string,
  botId: string,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  await getOwnedBot(tenantId, botId);
  const db = getDb();
  const offset = (page - 1) * pageSize;
  const items = await db
    .select({
      id: botUsers.id,
      platformUserId: botUsers.platformUserId,
      username: botUsers.username,
      displayName: botUsers.displayName,
      firstSeenAt: botUsers.firstSeenAt,
      lastSeenAt: botUsers.lastSeenAt,
    })
    .from(botUsers)
    .where(eq(botUsers.botId, botId))
    .orderBy(desc(botUsers.lastSeenAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsers)
    .where(eq(botUsers.botId, botId));
  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}

/** Tenant-scoped, bounded CSV export. The extra row detects cap overflow without COUNT+SELECT races. */
export async function exportBotUsers(tenantId: string, botId: string): Promise<BotUserExportRow[]> {
  await getOwnedBot(tenantId, botId);
  const rows = await getDb()
    .select({
      displayName: botUsers.displayName,
      platformUserId: botUsers.platformUserId,
      username: botUsers.username,
      firstSeenAt: botUsers.firstSeenAt,
      lastSeenAt: botUsers.lastSeenAt,
    })
    .from(botUsers)
    .where(eq(botUsers.botId, botId))
    .orderBy(desc(botUsers.lastSeenAt))
    .limit(MAX_BOT_USER_EXPORT + 1);
  if (rows.length > MAX_BOT_USER_EXPORT) {
    throw new AppError(ERR.VALIDATION('برای جلوگیری از تولید فایل بسیار بزرگ، خروجی هر بار به ۱۰٬۰۰۰ کاربر محدود است.'));
  }
  await audit({
    action: 'bot.users.export',
    actorId: tenantId,
    subjectType: 'bot',
    subjectId: botId,
    meta: { rowCount: rows.length, format: 'csv' },
  });
  return rows;
}

export async function listBotConversations(
  tenantId: string,
  botId: string,
  page: number,
  pageSize: number,
  platformUserId?: string,
): Promise<{
  items: Array<{
    id: string;
    platform: string;
    chatRef: string;
    platformUserId: string;
    username: string | null;
    displayName: string | null;
    lastActivityAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  await getOwnedBot(tenantId, botId);
  const db = getDb();
  const where = platformUserId === undefined
    ? and(eq(botConversations.tenantId, tenantId), eq(botConversations.botId, botId))
    : and(eq(botConversations.tenantId, tenantId), eq(botConversations.botId, botId), eq(botConversations.platformUserId, platformUserId));
  const offset = (page - 1) * pageSize;
  const rows = await db
    .select({
      id: botConversations.id,
      platform: botConversations.platform,
      chatRef: botConversations.chatRef,
      platformUserId: botConversations.platformUserId,
      username: botUsers.username,
      displayName: botUsers.displayName,
      lastActivityAt: botConversations.lastActivityAt,
    })
    .from(botConversations)
    .leftJoin(botUsers, and(eq(botUsers.botId, botId), eq(botUsers.platformUserId, botConversations.platformUserId)))
    .where(where)
    .orderBy(desc(botConversations.lastActivityAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botConversations)
    .where(where);
  return { items: rows, total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function listBotConversationMessages(
  tenantId: string,
  botId: string,
  conversationId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: Array<{
    id: string;
    direction: string;
    platformMessageId: string | null;
    senderRef: string | null;
    text: string | null;
    actionType: string | null;
    actionRef: string | null;
    status: string;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  await getOwnedBot(tenantId, botId);
  const db = getDb();
  const [conversation] = await db
    .select({ id: botConversations.id })
    .from(botConversations)
    .where(and(eq(botConversations.id, conversationId), eq(botConversations.tenantId, tenantId), eq(botConversations.botId, botId)))
    .limit(1);
  if (!conversation) throw new AppError(ERR.NOT_FOUND('گفتگو'));

  const offset = (page - 1) * pageSize;
  const items = await db
    .select({
      id: botMessages.id,
      direction: botMessages.direction,
      platformMessageId: botMessages.platformMessageId,
      senderRef: botMessages.senderRef,
      text: botMessages.text,
      actionType: botMessages.actionType,
      actionRef: botMessages.actionRef,
      status: botMessages.status,
      createdAt: botMessages.createdAt,
    })
    .from(botMessages)
    .where(and(eq(botMessages.conversationId, conversationId), eq(botMessages.tenantId, tenantId), eq(botMessages.botId, botId)))
    .orderBy(desc(botMessages.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botMessages)
    .where(and(eq(botMessages.conversationId, conversationId), eq(botMessages.tenantId, tenantId), eq(botMessages.botId, botId)));
  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function getBotStats(
  tenantId: string,
  botId: string
): Promise<{
  eventsByKind: Array<{ kind: string; count: number }>;
  messagesSent30d: number;
  messagesReceived30d: number;
  commandsMatched30d: number;
  workflowsRun30d: number;
  userCount: number;
  recentActivity: Array<{ id: string; direction: string; platform: string; text: string | null; actionType: string | null; status: string; senderRef: string | null; createdAt: Date }>
}> {
  const bot = await getOwnedBot(tenantId, botId);
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const kindRows = await db
    .select({ kind: botEvents.kind, count: sql<number>`count(*)` })
    .from(botEvents)
    .where(and(eq(botEvents.botId, bot.id), gte(botEvents.createdAt, since)))
    .groupBy(botEvents.kind);

  const [sentRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        eq(events.name, 'bot.message.sent'),
        eq(events.tenantId, tenantId),
        gte(events.createdAt, since),
        sql`json_extract(${events.propsJson}, '$.botId') = ${bot.id}`
      )
    );

  const [userRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsers)
    .where(eq(botUsers.botId, bot.id));

  const [receivedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botMessages)
    .where(and(eq(botMessages.botId, bot.id), eq(botMessages.direction, 'INBOUND'), gte(botMessages.createdAt, since)));

  const [commandRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botMessages)
    .where(and(eq(botMessages.botId, bot.id), eq(botMessages.actionType, 'COMMAND'), gte(botMessages.createdAt, since)));

  const [workflowRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botMessages)
    .where(and(eq(botMessages.botId, bot.id), eq(botMessages.actionType, 'WORKFLOW'), gte(botMessages.createdAt, since)));

  const recentActivity = await db
    .select({ id: botMessages.id, direction: botMessages.direction, platform: botMessages.platform, text: botMessages.text, actionType: botMessages.actionType, status: botMessages.status, senderRef: botMessages.senderRef, createdAt: botMessages.createdAt })
    .from(botMessages)
    .where(and(eq(botMessages.botId, bot.id), eq(botMessages.tenantId, tenantId)))
    .orderBy(desc(botMessages.createdAt))
    .limit(50);

  return {
    eventsByKind: kindRows.map((r) => ({ kind: r.kind, count: Number(r.count ?? 0) })),
    messagesSent30d: Number(sentRow?.count ?? 0),
    messagesReceived30d: Number(receivedRow?.count ?? 0),
    commandsMatched30d: Number(commandRow?.count ?? 0),
    workflowsRun30d: Number(workflowRow?.count ?? 0),
    userCount: Number(userRow?.count ?? 0),
    recentActivity,
  };
}

// ---------- commands ----------

export function normalizeCommandName(raw: string): string {
  let cmd = raw.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const at = cmd.indexOf('@');
  if (at > 0) cmd = cmd.slice(0, at);
  if (!cmd.startsWith('/')) cmd = `/${cmd}`;
  return cmd;
}

export type BotResponsePayload = {
  text?: string;
  buttons?: Array<{ label: string; url?: string; callback?: string }>;
  systemPrompt?: string;
  workflowId?: string;
};

export async function listBotCommands(tenantId: string, botId: string) {
  await getOwnedBot(tenantId, botId);
  return getDb()
    .select()
    .from(botCommands)
    .where(eq(botCommands.botId, botId))
    .orderBy(botCommands.createdAt);
}

export async function createBotCommand(
  tenantId: string,
  botId: string,
  input: { command: string; descriptionFa?: string; responseKind: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null }
) {
  await getOwnedBot(tenantId, botId);
  const command = normalizeCommandName(input.command);
  if (!/^\/[a-z0-9_]{1,31}$/.test(command)) {
    throw new AppError(ERR.VALIDATION('دستور باید با «/» و حروف لاتین، عدد یا زیرخط باشد.'));
  }
  const db = getDb();
  const id = newId();
  await db
    .insert(botCommands)
    .values({
      id,
      botId,
      tenantId,
      command,
      descriptionFa: input.descriptionFa ?? '',
      responseKind: input.responseKind,
      responsePayload: input.responsePayload ?? null,
    })
    .catch((err: unknown) => {
      // ER_DUP_ENTRY (1062) → user-facing duplicate; anything else rethrown as-is.
      if ((err as { errno?: number } | null)?.errno === 1062) throw new AppError(ERR.DUPLICATE('این دستور'));
      throw err;
    });
  await audit({ action: 'bot.command.create', actorId: tenantId, subjectType: 'bot_command', subjectId: id, meta: { command } });
  const [row] = await db.select().from(botCommands).where(eq(botCommands.id, id)).limit(1);
  return row;
}

export async function updateBotCommand(
  tenantId: string,
  commandId: string,
  patch: { command?: string; descriptionFa?: string; responseKind?: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null; isEnabled?: boolean },
  botId?: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(botCommands)
    .where(and(
      eq(botCommands.id, commandId),
      eq(botCommands.tenantId, tenantId),
      ...(botId ? [eq(botCommands.botId, botId)] : []),
    ))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('دستور'));
  const command = patch.command !== undefined ? normalizeCommandName(patch.command) : undefined;
  if (command !== undefined && !/^\/[a-z0-9_]{1,31}$/.test(command)) {
    throw new AppError(ERR.VALIDATION('دستور باید با «/» و حروف لاتین، عدد یا زیرخط باشد.'));
  }
  await db
    .update(botCommands)
    .set({
      ...(command !== undefined ? { command } : {}),
      ...(patch.descriptionFa !== undefined ? { descriptionFa: patch.descriptionFa } : {}),
      ...(patch.responseKind !== undefined ? { responseKind: patch.responseKind } : {}),
      ...(patch.responsePayload !== undefined ? { responsePayload: patch.responsePayload } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled ? 1 : 0 } : {}),
    })
    .where(and(eq(botCommands.id, commandId), eq(botCommands.tenantId, tenantId), ...(botId ? [eq(botCommands.botId, botId)] : [])));
  await audit({ action: 'bot.command.update', actorId: tenantId, subjectType: 'bot_command', subjectId: commandId });
  const [updated] = await db.select().from(botCommands).where(and(eq(botCommands.id, commandId), eq(botCommands.tenantId, tenantId), ...(botId ? [eq(botCommands.botId, botId)] : []))).limit(1);
  return updated;
}

export async function deleteBotCommand(tenantId: string, commandId: string, botId?: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: botCommands.id })
    .from(botCommands)
    .where(and(
      eq(botCommands.id, commandId),
      eq(botCommands.tenantId, tenantId),
      ...(botId ? [eq(botCommands.botId, botId)] : []),
    ))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('دستور'));
  await db.delete(botCommands).where(and(eq(botCommands.id, commandId), ...(botId ? [eq(botCommands.botId, botId)] : [])));
  await audit({ action: 'bot.command.delete', actorId: tenantId, subjectType: 'bot_command', subjectId: commandId });
}

// ---------- keywords ----------

export async function listBotKeywords(tenantId: string, botId: string) {
  await getOwnedBot(tenantId, botId);
  return getDb()
    .select()
    .from(botKeywords)
    .where(eq(botKeywords.botId, botId))
    .orderBy(botKeywords.createdAt);
}

export async function createBotKeyword(
  tenantId: string,
  botId: string,
  input: { keyword: string; matchKind: 'EXACT' | 'CONTAINS'; responseKind: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null }
) {
  await getOwnedBot(tenantId, botId);
  const keyword = input.keyword.trim();
  if (keyword.length < 2) throw new AppError(ERR.VALIDATION('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.'));
  const db = getDb();
  const id = newId();
  await db.insert(botKeywords).values({
    id,
    botId,
    tenantId,
    keyword: keyword.slice(0, 190),
    matchKind: input.matchKind,
    responseKind: input.responseKind,
    responsePayload: input.responsePayload ?? null,
  });
  await audit({ action: 'bot.keyword.create', actorId: tenantId, subjectType: 'bot_keyword', subjectId: id });
  const [row] = await db.select().from(botKeywords).where(eq(botKeywords.id, id)).limit(1);
  return row;
}

export async function updateBotKeyword(
  tenantId: string,
  keywordId: string,
  patch: { keyword?: string; matchKind?: 'EXACT' | 'CONTAINS'; responseKind?: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null; isEnabled?: boolean },
  botId?: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(botKeywords)
    .where(and(
      eq(botKeywords.id, keywordId),
      eq(botKeywords.tenantId, tenantId),
      ...(botId ? [eq(botKeywords.botId, botId)] : []),
    ))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کلمهٔ کلیدی'));
  if (patch.keyword !== undefined && patch.keyword.trim().length < 2) {
    throw new AppError(ERR.VALIDATION('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.'));
  }
  await db
    .update(botKeywords)
    .set({
      ...(patch.keyword !== undefined ? { keyword: patch.keyword.trim().slice(0, 190) } : {}),
      ...(patch.matchKind !== undefined ? { matchKind: patch.matchKind } : {}),
      ...(patch.responseKind !== undefined ? { responseKind: patch.responseKind } : {}),
      ...(patch.responsePayload !== undefined ? { responsePayload: patch.responsePayload } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled ? 1 : 0 } : {}),
    })
    .where(and(eq(botKeywords.id, keywordId), eq(botKeywords.tenantId, tenantId), ...(botId ? [eq(botKeywords.botId, botId)] : [])));
  await audit({ action: 'bot.keyword.update', actorId: tenantId, subjectType: 'bot_keyword', subjectId: keywordId });
  const [updated] = await db.select().from(botKeywords).where(and(eq(botKeywords.id, keywordId), eq(botKeywords.tenantId, tenantId), ...(botId ? [eq(botKeywords.botId, botId)] : []))).limit(1);
  return updated;
}

export async function deleteBotKeyword(tenantId: string, keywordId: string, botId?: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: botKeywords.id })
    .from(botKeywords)
    .where(and(
      eq(botKeywords.id, keywordId),
      eq(botKeywords.tenantId, tenantId),
      ...(botId ? [eq(botKeywords.botId, botId)] : []),
    ))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کلمهٔ کلیدی'));
  await db.delete(botKeywords).where(and(eq(botKeywords.id, keywordId), ...(botId ? [eq(botKeywords.botId, botId)] : [])));
  await audit({ action: 'bot.keyword.delete', actorId: tenantId, subjectType: 'bot_keyword', subjectId: keywordId });
}

// ---------- provider capabilities ----------

export async function getBotCapabilities(tenantId: string, botId: string) {
  const bot = await getOwnedBot(tenantId, botId);
  return getProvider(bot.platform).capabilities();
}

// ---------- public webhook ingestion (§187) ----------

async function ingestBotUpdate(bot: { id: string; tenantId: string; platform: Platform; mode: string; webhookSecret: string | null }, body: unknown): Promise<void> {
  let update = body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update) as unknown;
    } catch {
      return;
    }
  }
  if (!update || typeof update !== 'object' || Array.isArray(update)) return;

  const updateId = (update as { update_id?: unknown }).update_id;
  const msg = extractBotMessage(update);
  const externalId = asId(updateId) ?? msg?.buttonId ?? (update && typeof update === 'object' ? asId(((update as Record<string, unknown>).message_id)) : null);
  const hashSeed = updateId !== undefined && updateId !== null ? updateId : { externalId, chatId: msg?.chatId, messageId: update && typeof update === 'object' ? (update as Record<string, unknown>).message_id : null, body: update };
  const dedupHash = await sha256Hex(bot.id + JSON.stringify(hashSeed));
  const eventId = newId();
  const res = await getDb()
    .insert(botEvents)
    .values({
      id: eventId,
      tenantId: bot.tenantId,
      botId: bot.id,
      platform: bot.platform,
      externalId,
      dedupHash,
      kind: msg ? 'message' : 'update',
      chatRef: msg?.chatId ?? null,
      senderRef: msg?.senderId ?? null,
      payloadJson: update,
    })
    .onDuplicateKeyUpdate({ set: { dedupHash: sql`${botEvents.dedupHash}` } });

  const header = Array.isArray(res) ? res[0] : res;
  const affected = (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
  if (affected === 0) {
    // The event row may already exist while its first queue enqueue failed.
    // Re-dispatch only an existing PENDING event; PROCESSED/FAILED events are
    // intentionally left untouched to avoid duplicate processing.
    const [existing] = await getDb()
      .select({ id: botEvents.id, state: botEvents.state })
      .from(botEvents)
      .where(and(eq(botEvents.botId, bot.id), eq(botEvents.dedupHash, dedupHash)))
      .limit(1);
    if (existing?.state === 'PENDING') {
      await enqueue('bot-events', 'process', { eventId: existing.id }, { jobId: `botev:${existing.id}` });
    }
    return;
  }

  await getDb().update(bots).set({ lastEventAt: new Date() }).where(eq(bots.id, bot.id));
  await enqueue('bot-events', 'process', { eventId }, { jobId: `botev:${eventId}` });
}

export async function ingestBotWebhook(botId: string, secretParam: unknown, body: unknown, secretHeader?: unknown): Promise<void> {
  const db = getDb();
  const [bot] = await db
    .select({ id: bots.id, tenantId: bots.tenantId, platform: bots.platform, mode: bots.mode, status: bots.status, webhookSecret: bots.webhookSecret, tokenEncrypted: bots.tokenEncrypted })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!bot || bot.status !== 'ACTIVE' || bot.mode !== 'WEBHOOK' || !bot.webhookSecret) return;

  const querySecret = typeof secretParam === 'string' ? secretParam : '';
  const headerSecret = typeof secretHeader === 'string' ? secretHeader : '';
  const secret = bot.platform === 'telegram' ? headerSecret : querySecret || headerSecret;
  if (!secret || !timingSafeEqualStr(secret, bot.webhookSecret)) return;
  if (bot.platform === 'rubika') {
    const token = decryptSecret(bot.tokenEncrypted);
    if (await handleRubikaChannelDiscovery(bot, body, token)) return;
  }
  await ingestBotUpdate(bot, body);
}

/** Internal polling ingress. No secret is needed because updates come from the provider over the bot token. */
export async function ingestBotPollingUpdate(botId: string, body: unknown): Promise<void> {
  const db = getDb();
  const [bot] = await db
    .select({ id: bots.id, tenantId: bots.tenantId, platform: bots.platform, mode: bots.mode, status: bots.status, webhookSecret: bots.webhookSecret })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!bot || bot.mode !== 'POLLING' || bot.status !== 'ACTIVE') return;
  await ingestBotUpdate(bot, body);
}
