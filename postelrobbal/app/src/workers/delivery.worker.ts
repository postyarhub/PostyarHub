import { Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  bots, channels, media, outboxEvents, postTargets, posts, wordpressCampaigns, wordpressContents, wordpressProducts,
} from '../db/schema.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { nextRetryDelaySeconds } from '../core/delivery-state.js';
import { refreshPostAggregate } from '../core/post-aggregate.js';
import { outboxRow, relayOutbox } from '../core/outbox.js';
import { emitEvent } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { resolveUniqueDeliveryButtons } from '../core/delivery-buttons.js';
import { readMediaBuffer, readProviderPhotoJpeg } from '../modules/media/media.service.js';
import { createWorker } from '../queue/connection.js';
import { loadEnv } from '../config/env.js';
import { enqueue } from '../queue/queues.js';
import { assertSafeUrl } from '../core/http.js';
import { getProvider } from '../providers/index.js';
import { decryptSecret } from '../security/encryption.js';
import type { Platform, ProviderError } from '../providers/types.js';
import { outboxDispatcher } from './dispatcher.js';

/**
 * Delivery worker (§22, §84-88). One queue 'delivery', two job kinds:
 *   - deliver          {targetId}       → send a post_target to its channel
 *   - deliver-product  {payloadJson}    → transient wordpress product send
 * Duplicate-send protection: the PROCESSING claim is an atomic
 * UPDATE ... WHERE state IN ('PENDING','RETRYING') — losing updater exits.
 */

const log = createLogger('delivery-worker');

const RETRY_CLASSES = new Set<string>(['TRANSIENT', 'RATE_LIMITED']);

async function emitDeliveryEventSafely(input: Parameters<typeof emitEvent>[0]): Promise<void> {
  try {
    await emitEvent(input);
  } catch (err) {
    log.warn({ err, event: input.name, postId: input.props?.postId, targetId: input.props?.targetId }, 'delivery_analytics_event_failed');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

function asProviderError(err: unknown): ProviderError | null {
  if (err instanceof Error) {
    const candidate = err as ProviderError;
    if (typeof candidate.providerClass === 'string' && typeof candidate.userMessageFa === 'string') return candidate;
  }
  return null;
}

function errorClassOf(err: unknown): string {
  const provider = asProviderError(err);
  if (provider) return provider.providerClass;
  if (err instanceof AppError) return err.errorClass.toUpperCase();
  return 'UNKNOWN';
}

function errorMessageOf(err: unknown): string {
  const provider = asProviderError(err);
  if (provider) return provider.userMessageFa;
  if (err instanceof AppError) return err.userMessage;
  return 'ارسال پیام ناموفق بود.';
}

function providerDiagnosticOf(err: unknown): Record<string, unknown> {
  const provider = asProviderError(err);
  const root = provider ? (provider.cause ?? provider) : err;
  const e = root instanceof Error ? root : new Error(String(root ?? 'unknown'));
  const cause = e.cause instanceof Error ? e.cause : e.cause;
  const c = cause && typeof cause === 'object' ? cause as Record<string, unknown> : null;
  const safeCode = typeof (e as Error & { code?: unknown }).code === 'string' ? String((e as Error & { code?: unknown }).code) : null;
  const safeCauseCode = c && typeof c.code === 'string' ? c.code : null;
  const httpError = root && typeof root === 'object' && 'status' in root && 'contentType' in root && 'bodyPreview' in root
    ? root as { status?: unknown; contentType?: unknown; bodyPreview?: unknown; method?: unknown }
    : null;
  return {
    providerClass: provider?.providerClass ?? null,
    errorName: e.name,
    errorCode: safeCode ?? safeCauseCode,
    errorMessage: String(e.message).slice(0, 180),
    causeName: c && typeof c.name === 'string' ? c.name : null,
    causeMessage: c && typeof c.message === 'string' ? c.message.slice(0, 180) : null,
    httpStatus: httpError && typeof httpError.status === 'number' ? httpError.status : null,
    httpContentType: httpError && typeof httpError.contentType === 'string' ? httpError.contentType.slice(0, 120) : null,
    httpBodyPreview: httpError && typeof httpError.bodyPreview === 'string'
      ? httpError.bodyPreview.replace(/[\r\n]+/g, ' ').slice(0, 240)
      : null,
  };
}

/** Platforms without parse-mode support receive plain text (§15: no emulation). */
function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripMarkdown(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

function escapeDestinationFooter(input: string, parseMode: 'NONE' | 'HTML' | 'MARKDOWN'): string {
  if (parseMode === 'HTML') return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (parseMode === 'MARKDOWN') {
    const markdownSpecial = new Set(['_', '*', '[', ']', '(', ')', '~', String.fromCharCode(96), '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\']);
    return Array.from(input, (char) => markdownSpecial.has(char) ? '\\' + char : char).join('');
  }
  return input;
}

async function claimTarget(targetId: string): Promise<boolean> {
  // Atomic claim — prevents duplicate sends when a job is retried/duplicated.
  const res = await getDb()
    .update(postTargets)
    .set({ state: 'PROCESSING' })
    .where(and(eq(postTargets.id, targetId), inArray(postTargets.state, ['PENDING', 'RETRYING'])));
  return affectedRowsOf(res) > 0;
}

/**
 * After claiming a target, atomically reserve the parent post for delivery.
 * The post row lock is the same serialization boundary used by cancelPost():
 * either cancellation wins and the claimed target is cancelled, or the worker
 * wins and the post becomes PUBLISHING before any provider call can start.
 */
async function activateClaimedTarget(targetId: string, postId: string): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [post] = await tx.select({ state: posts.state })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1)
      .for('update');
    if (!post || !['QUEUED', 'SCHEDULED', 'PUBLISHING'].includes(post.state)) {
      await tx.update(postTargets)
        .set({ state: 'CANCELLED', nextRetryAt: null })
        .where(and(eq(postTargets.id, targetId), eq(postTargets.state, 'PROCESSING')));
      return false;
    }
    if (post.state !== 'PUBLISHING') {
      await tx.update(posts)
        .set({ state: 'PUBLISHING' })
        .where(and(eq(posts.id, postId), inArray(posts.state, ['QUEUED', 'SCHEDULED'])));
    }
    return true;
  });
}

async function loadActiveBotToken(channel: typeof channels.$inferSelect): Promise<{ token: string; botId: string } | null> {
  if (!channel.botId) return null;
  const db = getDb();
  const [bot] = await db
    .select({ id: bots.id, tokenEncrypted: bots.tokenEncrypted })
    .from(bots)
    .where(
      and(
        eq(bots.id, channel.botId),
        eq(bots.tenantId, channel.tenantId),
        eq(bots.platform, channel.platform),
        eq(bots.status, 'ACTIVE'),
      )
    )
    .limit(1);
  if (!bot) return null;
  return { token: decryptSecret(bot.tokenEncrypted), botId: bot.id };
}

async function resolveMediaForDelivery(tenantId: string, mediaId: string): Promise<{
  buffer: Buffer;
  kind: 'photo' | 'video';
  mime: string;
  filename: string;
} | null> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.tenantId, tenantId)))
    .limit(1);
  if (!m) return null;
  if (!(m.mime.startsWith('image/') || m.mime === 'video/mp4')) return null;

  // Upload directly from the private worker storage to the provider. This
  // deliberately avoids asking Telegram/Bale to fetch a private PostYar URL.
  if (m.mime.startsWith('image/')) {
    return {
      buffer: await readProviderPhotoJpeg(m),
      kind: 'photo',
      mime: 'image/jpeg',
      filename: `postyar-${m.id}.jpg`,
    };
  }
  return {
    buffer: await readMediaBuffer(m),
    kind: 'video',
    mime: 'video/mp4',
    filename: `postyar-${m.id}.mp4`,
  };
}

async function deliverPost(targetId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ target: postTargets, post: posts, channel: channels })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.id, targetId))
    .limit(1);
  if (!row) {
    log.warn({ targetId }, 'deliver_target_not_found');
    return;
  }
  const { target, post, channel } = row;

  if (!(await claimTargetSafe(targetId))) return;

  // The post-state transition is serialized under the parent-row lock so a
  // concurrent cancel cannot commit after our state check but before the
  // provider call. If cancellation wins, this function returns before send.
  if (!(await activateClaimedTarget(target.id, post.id))) {
    return;
  }

  await emitDeliveryEventSafely({
    name: 'post.delivery.started',
    tenantId: post.tenantId,
    subjectType: 'post_target',
    subjectId: target.id,
    props: { postId: post.id, channelId: channel.id, targetId: target.id, platform: channel.platform, attempts: target.attempts + 1 },
    analyticsDedupeKey: `delivery:started:${target.id}:${target.attempts + 1}`,
  });

  try {
    // Ownership guard: a DISABLED channel must never receive sends.
    if (channel.status === 'DISABLED') {
      await finalizeFailure(target, post, channel, 'CHANNEL_DISABLED', 'کانال غیرفعال است. آن را دوباره متصل کنید.', false);
      return;
    }

    const platform: Platform = channel.platform;
    let token: string;
    try {
      const bot = await loadActiveBotToken(channel);
      if (!bot) {
        const message = channel.botId
          ? 'ربات متصل به این کانال فعال نیست یا دیگر وجود ندارد. ربات را فعال کنید یا کانال را دوباره متصل کنید.'
          : 'ربات فعالی برای این پلتفرم یافت نشد. ابتدا ربات را متصل کنید.';
        await finalizeFailure(target, post, channel, 'NO_BOT', message, false);
        return;
      }
      token = bot.token;
    } catch {
      await finalizeFailure(target, post, channel, 'UNAUTHORIZED', 'اعتبارنامهٔ ربات نامعتبر است. ربات را دوباره متصل کنید.', false);
      return;
    }

    const provider = getProvider(platform);
    const caps = provider.capabilities();

    const buttons = post.buttonsJson ?? {};

    // Parse mode: strip markup for platforms without parse support.
    let text = post.body;
    let parseMode: 'NONE' | 'HTML' | 'MARKDOWN' = post.parseMode;
    if (!caps.htmlParseMode) {
      if (parseMode === 'HTML') {
        text = stripHtml(text);
        parseMode = 'NONE';
      } else if (parseMode === 'MARKDOWN') {
        text = stripMarkdown(text);
        parseMode = 'NONE';
      }
    }

    // Per-channel suffixes are appended only for this target.
    const destinationFooterValue = buttons.footerByChannel?.[channel.id];
    const destinationFooter = typeof destinationFooterValue === 'string'
      ? destinationFooterValue.trim()
      : '';
    if (destinationFooter) {
      const footerText = escapeDestinationFooter(destinationFooter, parseMode);
      const baseText = text.trimEnd();
      const separator = parseMode === 'HTML' ? '<br><br>' : '\n\n';
      const finalText = baseText ? baseText + separator + footerText : footerText;
      if (finalText.length > 4000) {
        await finalizeFailure(target, post, channel, 'POST_TEXT_TOO_LONG', 'مجموع متن پست و متن انتهایی اختصاصی از حد ۴۰۰۰ نویسه بیشتر است.', false);
        return;
      }
      text = finalText;
    }

    // Destination-specific buttons override platform defaults; legacy post shapes remain supported.
    const channelButtons = buttons.byChannel?.[channel.id];
    const platformButtons = buttons.byPlatform?.[platform];
    let inline = channelButtons !== undefined
      ? channelButtons
      : platformButtons !== undefined
        ? platformButtons
        : [...(buttons.inline ?? []), ...(buttons.links ?? []).map((l) => ({ label: l.label, url: l.url }))];
    if (!caps.inlineButtons) inline = [];
    // Normalize before enforcing the provider limit, and collapse identical
    // destinations. Legacy posts can contain the same button in both `inline`
    // and `links`; without this guard that URL is exposed more than once.
    const inlineButtons = caps.inlineButtons
      ? resolveUniqueDeliveryButtons(platform, inline)
      : [];

    // Media is part of the user's publication request. Never silently send
    // text-only when an attached media cannot be delivered.
    let mediaPayload: Awaited<ReturnType<typeof resolveMediaForDelivery>> = null;
    if (post.mediaId) {
      if (!caps.sendMedia) {
        await finalizeFailure(target, post, channel, 'UNSUPPORTED_MEDIA', 'پلتفرم مقصد از ارسال این نوع رسانه پشتیبانی نمی‌کند.', false);
        return;
      }
      mediaPayload = await resolveMediaForDelivery(post.tenantId, post.mediaId);
      if (!mediaPayload) {
        await finalizeFailure(target, post, channel, 'MEDIA_UNAVAILABLE', 'رسانهٔ پیوست‌شده دیگر قابل دسترسی یا قابل انتشار نیست.', false);
        return;
      }
    }

    const result =
      mediaPayload !== null
        ? await provider.sendMedia(token, {
            chatRef: channel.channelRef,
            text,
            parseMode,
            inlineButtons,
            mediaBuffer: mediaPayload.buffer,
            mediaFilename: mediaPayload.filename,
            mediaMime: mediaPayload.mime,
            kind: mediaPayload.kind,
          })
        : await provider.sendText(token, { chatRef: channel.channelRef, text, parseMode, inlineButtons });

    await finalizeSuccess(target, post, channel, platform, result.messageId);
  } catch (err) {
    const errorClass = errorClassOf(err);
    const message = errorMessageOf(err);
    const retryable = RETRY_CLASSES.has(errorClass);
    log.error({
      targetId: target.id,
      postId: post.id,
      channelId: channel.id,
      platform: channel.platform,
      errorClass,
      retryable,
      diagnostic: providerDiagnosticOf(err),
    }, 'delivery_attempt_failed');
    await finalizeFailure(target, post, channel, errorClass, message, retryable, asProviderError(err)?.retryAfterMs);
  }
}

async function claimTargetSafe(targetId: string): Promise<boolean> {
  const claimed = await claimTarget(targetId);
  if (!claimed) log.debug({ targetId }, 'deliver_target_already_claimed');
  return claimed;
}

async function publishScheduledPost(postId: string, scheduledAtIso?: string | null): Promise<void> {
  const db = getDb();
  const now = new Date();
  let published = false;
  await db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: posts.id, state: posts.state, scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1)
      .for('update');
    if (!post || post.state !== 'SCHEDULED') return;
    if (!post.scheduledAt || post.scheduledAt.getTime() > now.getTime()) return;
    const flipped = await tx
      .update(posts)
      .set({ state: 'QUEUED' })
      .where(and(eq(posts.id, postId), eq(posts.state, 'SCHEDULED')));
    if (affectedRowsOf(flipped) === 0) return;
    await tx.insert(outboxEvents).values(
      outboxRow({ aggregateType: 'post', aggregateId: postId, eventType: 'post.publish', payload: { scheduledAt: scheduledAtIso ?? post.scheduledAt.toISOString() } })
    );
    published = true;
  });
  if (published) {
    await relayOutbox(outboxDispatcher);
    log.info({ postId, scheduledAt: scheduledAtIso ?? null }, 'scheduled_post_released');
  }
}

interface WordPressSuccessMeta {
  siteId: string;
  itemType: 'product' | 'content';
  itemId: number;
  campaignId?: string | null;
}

async function finalizeSuccess(
  target: typeof postTargets.$inferSelect,
  post: typeof posts.$inferSelect,
  channel: typeof channels.$inferSelect,
  platform: Platform,
  messageId: string,
  wordpressMeta?: WordPressSuccessMeta,
): Promise<boolean> {
  const now = new Date();
  const db = getDb();
  let applied = false;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(postTargets)
      .set({
        state: 'SENT',
        providerMessageId: messageId.slice(0, 190),
        sentAt: now,
        attempts: target.attempts + 1,
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
      })
      .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'PROCESSING')));
    if (affectedRowsOf(updated) === 0) return;
    applied = true;

    // WordPress metadata must commit in the same transaction as the target's
    // successful terminal transition. This prevents "sent but not recorded"
    // windows that could otherwise cause campaign duplicates on the next run.
    if (wordpressMeta) {
      if (wordpressMeta.itemType === 'product') {
        await tx
          .update(wordpressProducts)
          .set({ lastPublishedAt: now })
          .where(and(
            eq(wordpressProducts.siteId, wordpressMeta.siteId),
            eq(wordpressProducts.tenantId, post.tenantId),
            eq(wordpressProducts.wcProductId, wordpressMeta.itemId),
          ));
      } else {
        await tx
          .update(wordpressContents)
          .set({ lastPublishedAt: now })
          .where(and(
            eq(wordpressContents.siteId, wordpressMeta.siteId),
            eq(wordpressContents.tenantId, post.tenantId),
            eq(wordpressContents.contentId, wordpressMeta.itemId),
          ));
      }

      if (wordpressMeta.campaignId) {
        const [campaign] = await tx
          .select({ sentIdsJson: wordpressCampaigns.sentIdsJson })
          .from(wordpressCampaigns)
          .where(and(
            eq(wordpressCampaigns.id, wordpressMeta.campaignId),
            eq(wordpressCampaigns.tenantId, post.tenantId),
          ))
          .limit(1)
          .for('update');
        if (campaign) {
          const current = Array.isArray(campaign.sentIdsJson)
            ? campaign.sentIdsJson.map((value) => Number(value)).filter(Number.isFinite)
            : [];
          if (!current.includes(wordpressMeta.itemId)) {
            await tx
              .update(wordpressCampaigns)
              .set({ sentIdsJson: [...current, wordpressMeta.itemId].slice(-5000) })
              .where(and(
                eq(wordpressCampaigns.id, wordpressMeta.campaignId),
                eq(wordpressCampaigns.tenantId, post.tenantId),
              ));
          }
        }
      }
    }
  });

  if (!applied) {
    // Scheduler/maintenance may have terminally reaped a long-running job.
    // A late provider response must never resurrect that terminal decision.
    log.warn({ targetId: target.id, postId: post.id }, 'delivery_stale_success_ignored');
    return false;
  }

  await db
    .update(channels)
    .set({ status: 'ACTIVE', lastVerifiedAt: now, healthJson: { ok: true, verifiedVia: 'first_send' } })
    .where(and(eq(channels.id, channel.id), eq(channels.status, 'PENDING_VERIFY')));

  await refreshPostAggregate(post.id);

  await emitDeliveryEventSafely({
    name: 'post.sent',
    tenantId: post.tenantId,
    subjectType: 'post',
    subjectId: post.id,
    props: { channelId: channel.id, targetId: target.id, platform },
  });
  await emitDeliveryEventSafely({
    name: 'post.delivery.sent',
    tenantId: post.tenantId,
    subjectType: 'post_target',
    subjectId: target.id,
    props: { postId: post.id, channelId: channel.id, targetId: target.id, platform, attempts: target.attempts + 1, campaignId: wordpressMeta?.campaignId ?? null },
    analyticsDedupeKey: `delivery:sent:${target.id}:${messageId.slice(0, 80)}`,
  });

  if (wordpressMeta) {
    const baseProps = {
      tenantId: post.tenantId,
      siteId: wordpressMeta.siteId,
      itemId: wordpressMeta.itemId,
      campaignId: wordpressMeta.campaignId ?? null,
      postId: post.id,
      targetId: target.id,
      channelId: channel.id,
      platform,
    };
    if (wordpressMeta.itemType === 'product') {
      await emitDeliveryEventSafely({
        name: 'wordpress.product.published',
        tenantId: post.tenantId,
        subjectType: 'wordpress_product',
        subjectId: `${wordpressMeta.siteId}:${wordpressMeta.itemId}`,
        props: baseProps,
      });
    } else {
      await emitDeliveryEventSafely({
        name: 'wordpress.content.published',
        tenantId: post.tenantId,
        subjectType: 'wordpress_content',
        subjectId: `${wordpressMeta.siteId}:${wordpressMeta.itemId}`,
        props: baseProps,
      });
    }
  }
  return true;
}

async function finalizeFailure(
  target: typeof postTargets.$inferSelect,
  post: typeof posts.$inferSelect,
  channel: typeof channels.$inferSelect,
  errorCode: string,
  messageFa: string,
  retryable: boolean,
  retryAfterMs?: number,
  campaignId?: string | null,
): Promise<void> {
  const attempts = target.attempts + 1;
  let nextRetryAt: Date | null = null;
  let state: 'RETRYING' | 'FAILED' = 'FAILED';
  if (retryable) {
    const policyDelaySeconds = nextRetryDelaySeconds(attempts);
    const providerDelaySeconds = Number.isFinite(retryAfterMs) && (retryAfterMs ?? 0) > 0
      ? Math.ceil((retryAfterMs as number) / 1000)
      : null;
    const delaySeconds = providerDelaySeconds !== null
      ? Math.max(providerDelaySeconds, policyDelaySeconds ?? 0)
      : policyDelaySeconds;
    if (delaySeconds !== null) {
      state = 'RETRYING';
      nextRetryAt = new Date(Date.now() + Math.min(3_600, Math.max(1, delaySeconds)) * 1000);
    }
  }
  const updated = await getDb()
    .update(postTargets)
    .set({ state, attempts, nextRetryAt, errorCode: errorCode.slice(0, 80), errorMessage: messageFa.slice(0, 250) })
    .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'PROCESSING')));
  if (affectedRowsOf(updated) === 0) {
    // A stale worker completion must not overwrite a scheduler/maintenance
    // terminal decision or generate misleading failure analytics.
    log.warn({ targetId: target.id, postId: post.id, errorCode }, 'delivery_stale_failure_ignored');
    return;
  }

  // Failed chat lookups are recorded as channel health, without auto-disabling.
  if (errorCode === 'NOT_FOUND' || errorCode === 'BLOCKED') {
    await getDb()
      .update(channels)
      .set({ healthJson: { ok: false, errorCode, checkedAt: new Date().toISOString() } })
      .where(eq(channels.id, channel.id));
  }

  await refreshPostAggregate(post.id);

  // Schedule the retry directly in BullMQ as the primary retry clock. The
  // database state remains authoritative and the scheduler/worker recovery
  // lanes remain fallbacks if Redis is unavailable at this exact moment. A
  // conditional PROCESSING -> RETRYING transition plus the stable attempt job
  // id prevents an overlapping recovery tick from sending twice.
  if (state === 'RETRYING' && nextRetryAt) {
    try {
      await enqueue(
        'delivery',
        'deliver',
        { targetId: target.id },
        { jobId: `retry:${target.id}:${attempts}`, delayMs: Math.max(0, nextRetryAt.getTime() - Date.now()) },
      );
    } catch (err) {
      log.warn({ err, targetId: target.id, attempts }, 'delivery_retry_schedule_failed');
    }
  }

  await emitDeliveryEventSafely({
    name: 'post.failed',
    tenantId: post.tenantId,
    subjectType: 'post',
    subjectId: post.id,
    props: { channelId: channel.id, targetId: target.id, platform: channel.platform, errorCode, retrying: state === 'RETRYING', attempts, campaignId: campaignId ?? null },
  });
  await emitDeliveryEventSafely({
    name: 'post.delivery.failed',
    tenantId: post.tenantId,
    subjectType: 'post_target',
    subjectId: target.id,
    props: { postId: post.id, channelId: channel.id, targetId: target.id, platform: channel.platform, errorCode, retrying: state === 'RETRYING', attempts, nextRetryAt: nextRetryAt?.toISOString() ?? null, campaignId: campaignId ?? null },
    analyticsDedupeKey: `delivery:failed:${target.id}:${attempts}:${errorCode}`,
  });
}

interface WordPressDeliveryPayload {
  postId?: string | null;
  targetId?: string | null;
  tenantId: string;
  siteId: string;
  itemType: 'product' | 'content';
  itemId: number;
  channelId: string;
  title: string;
  body: string;
  imageUrl: string | null;
  campaignId?: string | null;
}

function parseWordPressPayload(payload: Record<string, unknown>): WordPressDeliveryPayload | null {
  const tenantId = asString(payload.tenantId);
  const siteId = asString(payload.siteId);
  const channelId = asString(payload.channelId);
  const rawItemId = payload.itemId ?? payload.productId ?? payload.contentId;
  const itemId = typeof rawItemId === 'number' ? rawItemId : typeof rawItemId === 'string' ? Number(rawItemId) : NaN;
  const rawType = asString(payload.itemType);
  const itemType: 'product' | 'content' = rawType === 'content' ? 'content' : 'product';
  const body = asString(payload.body);
  if (!tenantId || !siteId || !channelId || !Number.isFinite(itemId) || !body) return null;
  return {
    tenantId,
    postId: asString(payload.postId),
    targetId: asString(payload.targetId),
    siteId,
    itemType,
    itemId,
    channelId,
    title: asString(payload.title) ?? '',
    body,
    imageUrl: asString(payload.imageUrl),
    campaignId: asString(payload.campaignId),
  };
}

async function deliverWordPress(payload: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const input = parseWordPressPayload(payload);
  if (!input) {
    log.warn({ payloadKeys: Object.keys(payload) }, 'deliver_wordpress_invalid_payload');
    return;
  }

  let target: typeof postTargets.$inferSelect | null = null;
  let post: typeof posts.$inferSelect | null = null;
  let channel: typeof channels.$inferSelect | null = null;

  // Current WordPress publish/campaign events carry the canonical target. Claim
  // it before any provider call so duplicate jobs cannot double-send. Legacy
  // outbox rows without targetId remain supported as a compatibility path.
  if (input.targetId) {
    const [row] = await db
      .select({ target: postTargets, post: posts, channel: channels })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(eq(postTargets.id, input.targetId), eq(postTargets.tenantId, input.tenantId)))
      .limit(1);
    if (!row) {
      log.warn({ targetId: input.targetId }, 'deliver_wordpress_target_not_found');
      return;
    }
    target = row.target;
    post = row.post;
    channel = row.channel;
    if (target.channelId !== input.channelId || post.id !== input.postId) {
      log.error({ targetId: target.id, payloadChannelId: input.channelId, targetChannelId: target.channelId, payloadPostId: input.postId, targetPostId: post.id }, 'deliver_wordpress_target_payload_mismatch');
      await db
        .update(postTargets)
        .set({ state: 'FAILED', attempts: target.attempts + 1, errorCode: 'TARGET_PAYLOAD_MISMATCH', errorMessage: 'دادهٔ انتشار معتبر نیست.', nextRetryAt: null })
        .where(and(eq(postTargets.id, target.id), inArray(postTargets.state, ['PENDING', 'RETRYING'])));
      return;
    }
    if (!(await claimTargetSafe(target.id))) return;
    if (!(await activateClaimedTarget(target.id, post.id))) return;
  }

  if (!channel) {
    const channelRows = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, input.channelId), eq(channels.tenantId, input.tenantId)))
      .limit(1);
    channel = channelRows[0] ?? null;
  }
  if (!channel || channel.status !== 'ACTIVE') {
    log.warn({ channelId: input.channelId, targetId: input.targetId ?? null }, 'deliver_wordpress_channel_inactive');
    if (target && post && channel) {
      await finalizeFailure(target, post, channel, 'CHANNEL_DISABLED', 'کانال غیرفعال است. آن را دوباره متصل کنید.', false, undefined, input.campaignId);
    }
    return;
  }

  let token: string | null = null;
  try {
    const bot = await loadActiveBotToken(channel);
    token = bot?.token ?? null;
  } catch {
    token = null;
  }
  if (!token) {
    log.warn({ channelId: input.channelId, targetId: input.targetId ?? null }, 'deliver_wordpress_no_bot');
    if (target && post) {
      await finalizeFailure(target, post, channel, 'NO_BOT', 'ربات فعال برای این کانال یافت نشد. ربات را فعال کنید یا کانال را دوباره متصل کنید.', false, undefined, input.campaignId);
    }
    return;
  }

  const provider = getProvider(channel.platform);
  const caps = provider.capabilities();
  let text = input.title ? `${input.title}\n\n${input.body}` : input.body;
  if (!caps.htmlParseMode) text = stripHtml(text);

  try {
    if (input.imageUrl) {
      if (!caps.sendMedia) {
        if (target && post) {
          await finalizeFailure(target, post, channel, 'UNSUPPORTED_MEDIA', 'پلتفرم مقصد از ارسال تصویر پشتیبانی نمی‌کند.', false, undefined, input.campaignId);
        }
        return;
      }
      await assertSafeUrl(input.imageUrl);
    }

    const result = input.imageUrl && caps.sendMedia
      ? await provider.sendMedia(token, {
        chatRef: channel.channelRef,
        text,
        parseMode: 'NONE',
        mediaUrl: input.imageUrl,
        kind: 'photo',
      })
      : await provider.sendText(token, { chatRef: channel.channelRef, text, parseMode: 'NONE' });

    if (target && post) {
      const applied = await finalizeSuccess(target, post, channel, channel.platform, result.messageId, {
        siteId: input.siteId,
        itemType: input.itemType,
        itemId: input.itemId,
        campaignId: input.campaignId,
      });
      if (!applied) return;
      return;
    }

    // Legacy WordPress event path has no durable post_target. Keep it functional
    // but do not claim a provider delivery state that cannot be persisted.
    await emitDeliveryEventSafely({
      name: input.itemType === 'product' ? 'wordpress.product.published' : 'wordpress.content.published',
      tenantId: input.tenantId,
      subjectType: input.itemType === 'product' ? 'wordpress_product' : 'wordpress_content',
      subjectId: `${input.siteId}:${input.itemId}`,
      props: { tenantId: input.tenantId, siteId: input.siteId, itemId: input.itemId, channelId: channel.id, platform: channel.platform, legacyDelivery: true },
    });
  } catch (err) {
    const errorClass = errorClassOf(err);
    const message = errorMessageOf(err);
    const retryable = RETRY_CLASSES.has(errorClass);
    log.error({
      targetId: input.targetId ?? null,
      postId: input.postId ?? null,
      channelId: channel.id,
      platform: channel.platform,
      errorClass,
      retryable,
      diagnostic: providerDiagnosticOf(err),
    }, 'wordpress_delivery_attempt_failed');
    if (target && post) {
      await finalizeFailure(target, post, channel, errorClass, message, retryable, asProviderError(err)?.retryAfterMs, input.campaignId);
      return;
    }
    throw err;
  }
}

async function processJob(job: Job): Promise<void> {
  const data = asRecord(job.data);
  if (job.name === 'publish-scheduled') {
    const postId = data ? asString(data.postId) : null;
    if (!postId) {
      log.warn({ jobId: job.id }, 'scheduled_publish_job_missing_post');
      return;
    }
    await publishScheduledPost(postId, data && typeof data.scheduledAt === 'string' ? data.scheduledAt : null);
    return;
  }
  if (job.name === 'deliver') {
    const targetId = data ? asString(data.targetId) : null;
    if (!targetId) {
      log.warn({ jobId: job.id }, 'deliver_job_missing_target');
      return;
    }
    await deliverPost(targetId);
    return;
  }
  if (job.name === 'deliver-product') {
    const payload = data ? asRecord(data.payloadJson) : null;
    if (!payload) {
      log.warn({ jobId: job.id }, 'deliver_wordpress_job_missing_payload');
      return;
    }
    await deliverWordPress(payload);
    return;
  }
  log.warn({ jobName: job.name }, 'unknown_delivery_job');
}

export function startDeliveryWorker() {
  const env = loadEnv();
  log.info({ concurrency: env.WORKER_CONCURRENCY }, 'delivery_worker_starting');
  // createWorker's processor parameter resolves to `never` due to a broken
  // conditional type in queue/connection.ts — bridge it without losing typing.
  const processor = async (job: Job): Promise<void> => {
    try {
      await processJob(job);
    } catch (err) {
      // BullMQ retries (attempts=3); classified failures above never throw.
      log.error({ err, jobId: job.id, jobName: job.name }, 'delivery_job_failed');
      throw err;
    }
  };
  return createWorker('delivery', processor as unknown as never, {
    concurrency: env.WORKER_CONCURRENCY,
  });
}
