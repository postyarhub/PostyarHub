import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bots, channelRegistry, channels, users } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { decryptSecret } from '../../security/encryption.js';
import { getRedis } from '../../queue/connection.js';
import { newToken } from '../../core/ids.js';

export function normalizeChannelRef(platform: Platform, value: string): string {
  const ref = value.trim();
  if (platform !== 'rubika') return ref;

  const webLink = ref.match(/^(?:https?:\/\/)?web\.rubika\.ir\/#c=([^&#\s]+)$/i);
  const fragmentRef = ref.match(/^#c=([^&#\s]+)$/i);
  const extracted = webLink?.[1] ?? fragmentRef?.[1] ?? null;
  if (extracted) {
    try { return decodeURIComponent(extracted).trim(); } catch { return extracted.trim(); }
  }
  if (ref.startsWith('@') || /^https?:\/\/(?:www\.)?rubika\.ir\//i.test(ref)) {
    throw new AppError(ERR.VALIDATION(
      'برای کانال روبیکا، لینک عمومی یا @نام‌کاربری قابل استفاده نیست. لینک مستقیم web.rubika.ir/#c=… یا خود chat_id را وارد کنید.'
    ));
  }
  return ref;
}

const RUBIKA_DISCOVERY_TTL_SECONDS = 10 * 60;
const RUBIKA_DISCOVERY_PREFIX = 'postyar:rubika-channel-discovery:';
const RUBIKA_DISCOVERY_COMMAND_PREFIX = 'postyar:rubika-channel-discovery-command:';
const RUBIKA_DISCOVERY_LOCK_PREFIX = 'postyar:rubika-channel-discovery-lock:';

type RubikaDiscoveryState = {
  tenantId: string;
  botId: string;
  platform: 'rubika';
  discoveryId: string;
  command: string;
  publicRef: string | null;
  title: string | null;
  createdAt: string;
  expiresAt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR';
  lastError: string | null;
  channelId: string | null;
  channelRef: string | null;
  channelTitle: string | null;
};

export interface RubikaDiscoveryStatus {
  discoveryId: string;
  status: RubikaDiscoveryState['status'] | 'EXPIRED';
  command: string;
  expiresAt: string;
  lastError: string | null;
  channelId: string | null;
  channelRef: string | null;
  channelTitle: string | null;
}

function discoveryKey(discoveryId: string): string {
  return `${RUBIKA_DISCOVERY_PREFIX}${discoveryId}`;
}

function discoveryCommandKey(tenantId: string, botId: string, marker: string): string {
  return `${RUBIKA_DISCOVERY_COMMAND_PREFIX}${tenantId}:${botId}:${marker}`;
}

function discoveryLockKey(discoveryId: string): string {
  return `${RUBIKA_DISCOVERY_LOCK_PREFIX}${discoveryId}`;
}

function parseDiscovery(raw: string | null): RubikaDiscoveryState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RubikaDiscoveryState;
    if (value.platform !== 'rubika' || typeof value.tenantId !== 'string' || typeof value.botId !== 'string' || typeof value.command !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

async function saveDiscovery(state: RubikaDiscoveryState): Promise<void> {
  const redis = getRedis();
  const ttl = Math.max(1, Math.ceil((Date.parse(state.expiresAt) - Date.now()) / 1000));
  await redis.set(discoveryKey(state.discoveryId), JSON.stringify(state), 'EX', ttl);
}

function toDiscoveryStatus(state: RubikaDiscoveryState): RubikaDiscoveryStatus {
  const expired = Date.parse(state.expiresAt) <= Date.now() && state.status !== 'COMPLETED';
  return {
    discoveryId: state.discoveryId,
    status: expired ? 'EXPIRED' : state.status,
    command: state.command,
    expiresAt: state.expiresAt,
    lastError: state.lastError,
    channelId: state.channelId,
    channelRef: state.channelRef,
    channelTitle: state.channelTitle,
  };
}

export async function startRubikaChannelDiscovery(
  tenantId: string,
  input: { botId: string; publicRef?: string; title?: string },
): Promise<RubikaDiscoveryStatus> {
  const db = getDb();
  const [bot] = await db.select({ id: bots.id, status: bots.status, platform: bots.platform, mode: bots.mode })
    .from(bots)
    .where(and(eq(bots.id, input.botId), eq(bots.tenantId, tenantId)))
    .limit(1);
  if (!bot || bot.platform !== 'rubika' || bot.status !== 'ACTIVE' || bot.mode !== 'WEBHOOK') {
    throw new AppError(ERR.VALIDATION('برای شناسایی کانال، یک ربات فعال روبیکا با وبهوک معتبر انتخاب کنید.'));
  }

  const marker = newToken(9);
  const discoveryId = newToken(18);
  const command = `/postyar-connect ${marker}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RUBIKA_DISCOVERY_TTL_SECONDS * 1000);
  const state: RubikaDiscoveryState = {
    tenantId,
    botId: input.botId,
    platform: 'rubika',
    discoveryId,
    command,
    publicRef: input.publicRef?.trim() || null,
    title: input.title?.trim() || null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'PENDING',
    lastError: null,
    channelId: null,
    channelRef: null,
    channelTitle: null,
  };

  const redis = getRedis();
  const indexKey = discoveryCommandKey(tenantId, input.botId, marker);
  await redis.set(indexKey, discoveryId, 'EX', RUBIKA_DISCOVERY_TTL_SECONDS, 'NX');
  await saveDiscovery(state);
  return toDiscoveryStatus(state);
}

export async function getRubikaChannelDiscovery(tenantId: string, discoveryId: string): Promise<RubikaDiscoveryStatus> {
  const state = parseDiscovery(await getRedis().get(discoveryKey(discoveryId)));
  if (!state || state.tenantId !== tenantId) throw new AppError(ERR.NOT_FOUND('درخواست شناسایی'));
  return toDiscoveryStatus(state);
}

export function parseRubikaDiscoveryCommand(text: string): string | null {
  const match = text.trim().match(/^\/postyar-connect(?:@[^\s]+)?\s+([A-Za-z0-9_-]{6,40})$/i);
  return match?.[1] ?? null;
}

async function bindVerifiedRubikaChannel(
  tenantId: string,
  botId: string,
  chat: { id: string; type: string | null; title: string | null; username: string | null },
  titleHint: string | null,
  publicRef: string | null,
): Promise<ChannelDto> {
  const db = getDb();
  const channelRef = chat.id.trim();
  if (!channelRef) throw new AppError(ERR.VALIDATION('شناسهٔ کانال روبیکا از پلتفرم دریافت نشد.'));
  if (String(chat.type ?? '').toLowerCase() !== 'channel') {
    throw new AppError(ERR.VALIDATION('پیام شناسایی از یک کانال روبیکا دریافت نشد. ربات را داخل همان کانال قرار دهید.'));
  }
  const now = new Date();
  const displayTitle = (chat.title?.trim() || titleHint?.trim() || publicRef?.trim() || chat.username?.trim() || 'کانال روبیکا').slice(0, 190);

  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
    const [existing] = await tx.select({ id: channels.id, botId: channels.botId, title: channels.title })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, 'rubika'), eq(channels.channelRef, channelRef)))
      .limit(1);
    if (!existing) await assertWithinLimit(tenantId, 'channels');

    await tx.insert(channelRegistry).values({ platform: 'rubika', channelRef, tenantId, claimedAt: now })
      .onDuplicateKeyUpdate({
        set: {
          tenantId: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${tenantId}, ${channelRegistry.tenantId})`,
          claimedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${now}, ${channelRegistry.claimedAt})`,
          releasedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, NULL, ${channelRegistry.releasedAt})`,
        },
      });
    const [claim] = await tx.select().from(channelRegistry)
      .where(and(eq(channelRegistry.platform, 'rubika'), eq(channelRegistry.channelRef, channelRef))).limit(1);
    if (claim && claim.tenantId && claim.tenantId !== tenantId) {
      throw new AppError(ERR.CONFLICT('این کانال قبلاً توسط کاربر دیگری ثبت شده است.'));
    }

    if (existing) {
      await tx.update(channels).set({ title: displayTitle, botId, status: 'ACTIVE', type: 'channel', healthJson: {
        ok: true, verifiedVia: 'rubika_discovery', botId, destinationId: channelRef,
        destinationType: chat.type, destinationTitle: chat.title, destinationUsername: chat.username,
      }, lastVerifiedAt: now, updatedAt: now }).where(eq(channels.id, existing.id));
    } else {
      await tx.insert(channels).values({
        id: newId(), tenantId, platform: 'rubika', channelRef, title: displayTitle, type: 'channel', mode: 'bot_post', status: 'ACTIVE', botId,
        healthJson: { ok: true, verifiedVia: 'rubika_discovery', botId, destinationId: channelRef,
          destinationType: chat.type, destinationTitle: chat.title, destinationUsername: chat.username },
        lastVerifiedAt: now,
      });
    }
  });

  const [row] = await db.select().from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, 'rubika'), eq(channels.channelRef, channelRef))).limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());
  await emitEvent({ name: 'channel.created', tenantId, subjectType: 'channel', subjectId: row.id, props: { platform: 'rubika', botId, discovery: true } });
  await audit({ action: 'channel.connect', actorId: tenantId, subjectType: 'channel', subjectId: row.id, meta: { platform: 'rubika', botId, discovery: true } });
  return toChannelDto(row);
}

/**
 * Handles a Rubika discovery command before normal bot-event processing. Returns true
 * only when a matching discovery attempt existed; successful binding is synchronous.
 */
export async function handleRubikaChannelDiscovery(
  bot: { id: string; tenantId: string; platform: Platform },
  body: unknown,
  token: string,
): Promise<boolean> {
  if (bot.platform !== 'rubika') return false;
  const extracted = extractRubikaDiscoveryMessage(body);
  if (!extracted) return false;
  const marker = parseRubikaDiscoveryCommand(extracted.text);
  if (!marker || !extracted.chatId) return false;

  const redis = getRedis();
  const indexKey = discoveryCommandKey(bot.tenantId, bot.id, marker);
  const discoveryId = await redis.get(indexKey);
  if (!discoveryId) return false;
  const key = discoveryKey(discoveryId);
  const lockKey = discoveryLockKey(discoveryId);
  const lockValue = `${process.pid}:${newToken(10)}`;
  if (await redis.set(lockKey, lockValue, 'EX', 60, 'NX') !== 'OK') return true;
  try {
    const state = parseDiscovery(await redis.get(key));
    if (!state || state.tenantId !== bot.tenantId || state.botId !== bot.id || state.status === 'COMPLETED') return true;
    if (Date.parse(state.expiresAt) <= Date.now()) {
      state.status = 'ERROR';
      state.lastError = 'زمان شناسایی این درخواست تمام شده است. از صفحه کانال‌ها یک درخواست جدید شروع کنید.';
      await saveDiscovery(state);
      return true;
    }

    state.status = 'PROCESSING';
    state.lastError = null;
    await saveDiscovery(state);
    try {
      const provider = getProvider('rubika');
      const chat = await provider.getChat(token, extracted.chatId);
      const channel = await bindVerifiedRubikaChannel(bot.tenantId, bot.id, chat, state.title, state.publicRef);
      state.status = 'COMPLETED';
      state.channelId = channel.id;
      state.channelRef = channel.channelRef;
      state.channelTitle = channel.title;
      state.lastError = null;
      await saveDiscovery(state);
    } catch (err) {
      const mapped = mapChannelProviderError(err);
      state.status = 'ERROR';
      state.lastError = mapped.message;
      await saveDiscovery(state);
    }
    return true;
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockValue).catch(() => undefined);
  }
}

function extractRubikaDiscoveryMessage(body: unknown): { text: string; chatId: string | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  const update = root.update && typeof root.update === 'object' ? root.update as Record<string, unknown> : null;
  const inline = root.inline_message && typeof root.inline_message === 'object' ? root.inline_message as Record<string, unknown> : null;
  const source = update ?? inline;
  if (!source) return null;
  const msg = update && source.new_message && typeof source.new_message === 'object' ? source.new_message as Record<string, unknown> : source;
  const text = typeof msg.text === 'string' ? msg.text : '';
  const chatId = typeof source.chat_id === 'string' && source.chat_id.length <= 190 ? source.chat_id
    : typeof msg.chat_id === 'string' && msg.chat_id.length <= 190 ? msg.chat_id : null;
  if (!text || !chatId) return null;
  return { text, chatId };
}

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

function mapChannelProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const cls = (err as { providerClass?: unknown })?.providerClass;
  const msg = (err as { userMessageFa?: unknown })?.userMessageFa;
  if (cls === 'UNAUTHORIZED') return new AppError(ERR.PROVIDER_UNAUTHORIZED());
  if (cls === 'RATE_LIMITED') return new AppError(ERR.PROVIDER_RATE_LIMITED());
  if (cls === 'TRANSIENT') return new AppError(ERR.PROVIDER_UNAVAILABLE());
  if (cls === 'NOT_FOUND' || cls === 'BLOCKED' || cls === 'VALIDATION') {
    if (typeof msg === 'string' && msg.trim()) return new AppError(ERR.VALIDATION(msg));
  }
  if (typeof msg === 'string' && msg.trim()) return new AppError(ERR.VALIDATION(msg));
  return new AppError(ERR.PROVIDER_UNAVAILABLE());
}

/**
 * Channel lifecycle (§21, §31). Tokens/credentials never leave this module:
 * the DTO carries status/health only. Anti-cheat: one global claim per
 * (platform, channel_ref) in channel_registry — a channel already claimed by
 * another tenant can never be connected twice.
 */

export interface ActorMeta {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string;
}

export interface ChannelDto {
  id: string;
  platform: Platform;
  channelRef: string;
  title: string;
  type: string;
  mode: 'bot_admin' | 'bot_post';
  botId: string | null;
  status: 'PENDING_VERIFY' | 'ACTIVE' | 'DISABLED' | 'ERROR';
  health: Record<string, unknown> | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

function toChannelDto(row: typeof channels.$inferSelect): ChannelDto {
  return {
    id: row.id,
    platform: row.platform,
    channelRef: row.channelRef,
    title: row.title,
    type: row.type,
    mode: row.mode,
    botId: row.botId,
    status: row.status,
    health: row.healthJson ?? null,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
  };
}

export async function listChannels(tenantId: string): Promise<ChannelDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(channels)
    .where(eq(channels.tenantId, tenantId))
    .orderBy(desc(channels.createdAt));
  return rows.map(toChannelDto);
}

export interface ConnectChannelInput {
  platform: Platform;
  channelRef: string;
  title: string;
  botId?: string;
}

async function resolveSingleActiveBot(tenantId: string, platform: Platform): Promise<string | null> {
  const rows = await getDb()
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.tenantId, tenantId), eq(bots.platform, platform), eq(bots.status, 'ACTIVE')))
    .limit(2);
  if (rows.length === 1 && rows[0]) return rows[0].id;
  if (rows.length > 1) {
    throw new AppError(ERR.VALIDATION('برای این پلتفرم بیش از یک ربات فعال دارید؛ ربات مقصد کانال را مشخص کنید.'));
  }
  return null;
}

/**
 * Connect a channel. ACTIVE is only granted after the provider proves both bot
 * identity and destination reachability via getChat; no test message is sent.
 */
export async function connectChannel(
  tenantId: string,
  input: ConnectChannelInput,
  meta: ActorMeta = {}
): Promise<ChannelDto> {
  const db = getDb();
  const platform = input.platform;
  const channelRef = normalizeChannelRef(platform, input.channelRef);
  const title = input.title.trim();
  if (channelRef.length < 2 || channelRef.length > 190) {
    throw new AppError(ERR.VALIDATION('شناسهٔ کانال نامعتبر است.'));
  }
  if (title.length < 1 || title.length > 190) {
    throw new AppError(ERR.VALIDATION('عنوان کانال الزامی است.'));
  }

  // The linked bot must belong to this tenant, be on the same platform and be ACTIVE.
  let botId: string | null = null;
  if (input.botId) {
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, input.botId), eq(bots.tenantId, tenantId), eq(bots.platform, platform), eq(bots.status, 'ACTIVE')))
      .limit(1);
    if (!bot) {
      throw new AppError(ERR.VALIDATION('ربات انتخاب‌شده برای این پلتفرم معتبر یا فعال نیست.'));
    }
    botId = bot.id;
  } else {
    botId = await resolveSingleActiveBot(tenantId, platform);
  }

  // Anti-cheat registry claim: claim (platform, channel_ref) globally.
  // IF-guard keeps an existing foreign claim intact even if the upsert races.
  const now = new Date();

  let health: Record<string, unknown> = { ok: false, verifiedVia: 'pending_bot' };
  let verifiedAt: Date | null = null;
  if (botId) {
    const [botRow] = await db.select().from(bots).where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(bots.platform, platform), eq(bots.status, 'ACTIVE'))).limit(1);
    if (!botRow) throw new AppError(ERR.VALIDATION('ربات انتخاب‌شده دیگر فعال نیست؛ دوباره تلاش کنید.'));
    try {
      const provider = getProvider(platform);
      const token = decryptSecret(botRow.tokenEncrypted);
      const identity = await provider.verifyBot(token);
      const chat = await provider.getChat(token, channelRef);
      if (platform === 'rubika' && String(chat.type ?? '').toLowerCase() !== 'channel') {
        throw new AppError(ERR.VALIDATION('مقصد انتخاب‌شده در روبیکا یک کانال نیست.'));
      }
      health = { ok: true, verifiedVia: 'provider_get_chat', botId: botRow.id, botUsername: identity.username, destinationId: chat.id, destinationType: chat.type, destinationTitle: chat.title, destinationUsername: chat.username };
      verifiedAt = now;
    } catch (err) {
      throw mapChannelProviderError(err);
    }
  }
  const status: 'ACTIVE' | 'PENDING_VERIFY' = botId ? 'ACTIVE' : 'PENDING_VERIFY';

  await db.transaction(async (tx) => {
    // Serialize quota-sensitive channel creation/reconnection per tenant. This
    // closes the check-then-insert race where concurrent requests could exceed
    // the plan's max_channels value.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
    if (botId) {
      const [lockedBot] = await tx.select({ id: bots.id }).from(bots)
        .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(bots.platform, platform)))
        .limit(1).for('update');
      if (!lockedBot) throw new AppError(ERR.VALIDATION('ربات انتخاب‌شده یافت نشد.'));
      const [active] = await tx.select({ id: bots.id }).from(bots)
        .where(and(eq(bots.id, botId), eq(bots.status, 'ACTIVE'))).limit(1);
      if (!active) throw new AppError(ERR.CONFLICT('وضعیت ربات همزمان تغییر کرده است؛ دوباره تلاش کنید.'));
    }

    const [existing] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, platform), eq(channels.channelRef, channelRef)))
      .limit(1);
    if (!existing) await assertWithinLimit(tenantId, 'channels');

    await tx
      .insert(channelRegistry)
      .values({ platform, channelRef, tenantId, claimedAt: now })
      .onDuplicateKeyUpdate({
        set: {
          tenantId: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${tenantId}, ${channelRegistry.tenantId})`,
          claimedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${now}, ${channelRegistry.claimedAt})`,
          releasedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, NULL, ${channelRegistry.releasedAt})`,
        },
      });
    const [claim] = await tx
      .select()
      .from(channelRegistry)
      .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)))
      .limit(1);
    if (claim && claim.tenantId && claim.tenantId !== tenantId) {
      throw new AppError(ERR.CONFLICT('این کانال قبلاً توسط کاربر دیگری ثبت شده است.'));
    }

    await tx
      .insert(channels)
      .values({
        id: newId(),
        tenantId,
        platform,
        channelRef,
        title,
        status,
        botId,
        healthJson: health,
        lastVerifiedAt: botId ? now : null,
      })
      .onDuplicateKeyUpdate({
        set: {
          title,
          botId,
          status,
          healthJson: health,
          lastVerifiedAt: verifiedAt,
          updatedAt: now,
        },
      });
  });
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, platform), eq(channels.channelRef, channelRef)))
    .limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());

  await emitEvent({ name: 'channel.created', tenantId, subjectType: 'channel', subjectId: row.id, props: { platform } });
  if (row.status === 'ACTIVE') {
    await emitEvent({ name: 'channel.connected', tenantId, subjectType: 'channel', subjectId: row.id, props: { platform } });
  }
  await audit({
    action: 'channel.connect',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: row.id,
    ip: meta.ip ?? undefined,
    meta: { platform },
  });
  return toChannelDto(row);
}

/**
 * Explicit verification: mark ACTIVE + healthy. The real-world health signal
 * is bot membership at connect time / first successful send — this endpoint
 * lets the user confirm the channel is live without Postyar sending a message.
 */
export async function verifyChannel(tenantId: string, channelId: string, meta: ActorMeta = {}): Promise<ChannelDto> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));
  const now = new Date();
  let botId = row.botId;
  if (!botId) {
    botId = await resolveSingleActiveBot(tenantId, row.platform);
  } else {
    const [activeBot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform), eq(bots.status, 'ACTIVE')))
      .limit(1);
    if (!activeBot) botId = null;
  }
  if (!botId) {
    throw new AppError(ERR.VALIDATION('این کانال به یک ربات فعال متصل نیست. ابتدا ربات فعال همان پلتفرم را به کانال اختصاص دهید.'));
  }
  const [botRow] = await db
    .select()
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform), eq(bots.status, 'ACTIVE')))
    .limit(1);
  if (!botRow) throw new AppError(ERR.CONFLICT('ربات مقصد دیگر فعال نیست؛ دوباره تلاش کنید.'));
  let health: Record<string, unknown>;
  try {
    const normalizedRef = normalizeChannelRef(row.platform, row.channelRef);
    const provider = getProvider(row.platform);
    const token = decryptSecret(botRow.tokenEncrypted);
    const identity = await provider.verifyBot(token);
    const chat = await provider.getChat(token, normalizedRef);
    health = { ok: true, verifiedVia: 'provider_get_chat', botId: botRow.id, botUsername: identity.username, destinationId: chat.id, destinationType: chat.type, destinationTitle: chat.title, destinationUsername: chat.username };
  } catch (err) {
    throw mapChannelProviderError(err);
  }
  await db.transaction(async (tx) => {
    const [lockedBot] = await tx.select({ id: bots.id }).from(bots)
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform)))
      .limit(1).for('update');
    if (!lockedBot) throw new AppError(ERR.NOT_FOUND('ربات'));
    const [active] = await tx.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.status, 'ACTIVE'))).limit(1);
    if (!active) throw new AppError(ERR.CONFLICT('وضعیت ربات همزمان تغییر کرده است؛ دوباره تلاش کنید.'));
    const changed = await tx.update(channels).set({ botId, status: 'ACTIVE', lastVerifiedAt: now, healthJson: health })
      .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)));
    if (affectedRowsOf(changed) === 0) throw new AppError(ERR.CONFLICT('وضعیت کانال همزمان تغییر کرده است؛ دوباره تلاش کنید.'));
  });
  const [updated] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!updated) throw new AppError(ERR.INTERNAL());
  await emitEvent({ name: 'channel.connected', tenantId, subjectType: 'channel', subjectId: channelId, props: { platform: row.platform } });
  await audit({
    action: 'channel.verify',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: channelId,
    ip: meta.ip ?? undefined,
  });
  return toChannelDto(updated);
}

/**
 * Disconnect: status DISABLED. The channel_registry claim is intentionally
 * KEPT (anti-cheat lock persists across reconnects); releasing a claim is an
 * explicit admin action, never automatic.
 */
export async function disconnectChannel(tenantId: string, channelId: string, meta: ActorMeta = {}): Promise<ChannelDto> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));
  if (row.status !== 'DISABLED') {
    await db.update(channels).set({ status: 'DISABLED' }).where(eq(channels.id, channelId));
    await emitEvent({ name: 'channel.disconnected', tenantId, subjectType: 'channel', subjectId: channelId, props: { platform: row.platform } });
    await audit({
      action: 'channel.disconnect',
      actorId: meta.actorId ?? null,
      actorRole: meta.actorRole ?? null,
      subjectType: 'channel',
      subjectId: channelId,
      ip: meta.ip ?? undefined,
    });
  }
  return { ...toChannelDto(row), status: 'DISABLED' };
}

export async function updateChannel(
  tenantId: string,
  channelId: string,
  input: { title: string; botId?: string | null },
  meta: ActorMeta = {}
): Promise<ChannelDto> {
  const db = getDb();
  const title = input.title.trim();
  if (title.length < 1 || title.length > 190) {
    throw new AppError(ERR.VALIDATION('عنوان کانال نامعتبر است.'));
  }
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));

  const nextBotId = input.botId === undefined ? row.botId : input.botId;
  const bindingChanged = nextBotId !== row.botId;
  let bindingPatch: Record<string, unknown> = {};
  if (bindingChanged && nextBotId) {
    const [bot] = await db.select().from(bots)
      .where(and(eq(bots.id, nextBotId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform), eq(bots.status, 'ACTIVE')))
      .limit(1);
    if (!bot) throw new AppError(ERR.VALIDATION('ربات انتخاب‌شده برای این کانال معتبر یا فعال نیست.'));
    try {
      const provider = getProvider(row.platform);
      const token = decryptSecret(bot.tokenEncrypted);
      const identity = await provider.verifyBot(token);
      const chat = await provider.getChat(token, row.channelRef);
      bindingPatch = { status: 'ACTIVE', healthJson: { ok: true, verifiedVia: 'provider_get_chat', botId: bot.id, botUsername: identity.username, destinationId: chat.id, destinationType: chat.type, destinationTitle: chat.title, destinationUsername: chat.username }, lastVerifiedAt: new Date() };
    } catch (err) {
      throw mapChannelProviderError(err);
    }
  } else if (bindingChanged) {
    bindingPatch = { status: 'PENDING_VERIFY', healthJson: null, lastVerifiedAt: null };
  }

  if (bindingChanged && nextBotId) {
    await db.transaction(async (tx) => {
      const [lockedBot] = await tx.select({ id: bots.id }).from(bots)
        .where(and(eq(bots.id, nextBotId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform)))
        .limit(1).for('update');
      if (!lockedBot) throw new AppError(ERR.NOT_FOUND('ربات'));
      const [active] = await tx.select({ id: bots.id }).from(bots).where(and(eq(bots.id, nextBotId), eq(bots.status, 'ACTIVE'))).limit(1);
      if (!active) throw new AppError(ERR.CONFLICT('وضعیت ربات همزمان تغییر کرده است؛ دوباره تلاش کنید.'));
      const changed = await tx.update(channels).set({ title, botId: nextBotId, ...bindingPatch }).where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)));
      if (affectedRowsOf(changed) === 0) throw new AppError(ERR.CONFLICT('وضعیت کانال همزمان تغییر کرده است؛ دوباره تلاش کنید.'));
    });
  } else {
    await db.update(channels).set({ title, botId: nextBotId, ...bindingPatch }).where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)));
  }
  await emitEvent({ name: 'channel.updated', tenantId, subjectType: 'channel', subjectId: channelId, props: { botChanged: bindingChanged } });
  await audit({
    action: 'channel.update',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: channelId,
    ip: meta.ip ?? undefined,
  });
  const [updated] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!updated) throw new AppError(ERR.NOT_FOUND('کانال'));
  return toChannelDto(updated);
}
