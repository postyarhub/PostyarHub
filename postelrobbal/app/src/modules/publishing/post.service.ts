import { and, desc, eq, gt, inArray, isNull, like, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bots, channels, media, outboxEvents, postTargets, posts, users } from '../../db/schema.js';
import type { PostButtons } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { outboxRow } from '../../core/outbox.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { enqueue } from '../../queue/queues.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';
import { refreshPostAggregate } from '../../core/post-aggregate.js';
import { createLogger } from '../../core/logger.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { decryptSecret } from '../../security/encryption.js';

/**
 * Publishing domain (§22, §25): DRAFT → (SCHEDULED →) QUEUED → PUBLISHING →
 * PUBLISHED/PARTIAL/FAILED, CANCELLED from SCHEDULED/QUEUED. Per-target state
 * machine lives in core/delivery-state. The outbox row is written in the SAME
 * transaction as the state flip (§125) — the dispatcher fans out targets.
 */

const log = createLogger('post-service');

export type PostState = 'DRAFT' | 'SCHEDULED' | 'QUEUED' | 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export type ParseMode = 'NONE' | 'HTML' | 'MARKDOWN';

export interface ActorMeta {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string;
}

export interface CreatePostInput {
  title?: string;
  body?: string;
  parseMode?: ParseMode;
  /** Ordered media collection; mediaId is retained as a legacy fallback. */
  mediaIds?: string[];
  mediaId?: string;
  buttons?: PostButtons;
  source?: 'MANUAL' | 'WORDPRESS';
}

export interface PostListQuery {
  page?: number;
  pageSize?: number;
  state?: PostState;
  search?: string;
  channelId?: string;
}

export interface UpdateScheduledPostInput {
  title?: string | null;
  body: string;
  parseMode?: ParseMode;
  mediaId: string | null;
  mediaIds?: string[];
  buttons?: PostButtons | null;
  channelIds: string[];
  scheduledAt: Date;
}

export interface TargetView {
  id: string;
  channelId: string;
  state: string;
  attempts: number;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  editErrorCode: string | null;
  editErrorMessage: string | null;
  editedAt: Date | null;
  sentAt: Date | null;
  nextRetryAt: Date | null;
  platform: 'telegram' | 'bale' | 'rubika';
  channelTitle: string;
  channelRef: string;
}

const MAX_POST_BODY_LENGTH = 4000;
const MAX_CHANNEL_FOOTER_LENGTH = 500;

function assertFooterLengths(body: string, buttons?: PostButtons | null): void {
  const base = body.trim();
  for (const raw of Object.values(buttons?.footerByChannel ?? {})) {
    const footer = typeof raw === 'string' ? raw.trim() : '';
    if (!footer) continue;
    if (footer.length > MAX_CHANNEL_FOOTER_LENGTH) throw new AppError(ERR.VALIDATION('متن انتهایی هر کانال حداکثر ۵۰۰ نویسه است.'));
    const total = base.length + (base ? 2 : 0) + footer.length;
    if (total > MAX_POST_BODY_LENGTH) throw new AppError(ERR.VALIDATION('مجموع متن پست و متن انتهایی هر کانال نباید از ۴۰۰۰ نویسه بیشتر شود.'));
  }
}

function cleanSearch(term: string): string {
  return term.replace(/[%_]/g, ' ').trim();
}

async function requireOwnedPost(tenantId: string, postId: string) {
  const db = getDb();
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)))
    .limit(1);
  if (!post) throw new AppError(ERR.NOT_FOUND('پست'));
  return post;
}

async function resolveActiveChannels(tenantId: string, channelIds: string[]): Promise<string[]> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) {
    throw new AppError(ERR.VALIDATION('حداقل یک کانال انتخاب کنید.'));
  }
  const db = getDb();
  const rows = await db
    .select({ id: channels.id, platform: channels.platform, botId: channels.botId })
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'ACTIVE'), inArray(channels.id, unique)));
  if (rows.length !== unique.length) {
    throw new AppError(ERR.VALIDATION('یکی از کانال‌های انتخاب‌شده معتبر یا فعال نیست.'));
  }
  for (const row of rows) {
    if (row.botId) {
      const [activeBot] = await db
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.id, row.botId), eq(bots.tenantId, tenantId), eq(bots.platform, row.platform), eq(bots.status, 'ACTIVE')))
        .limit(1);
      if (!activeBot) throw new AppError(ERR.VALIDATION('یکی از کانال‌ها به ربات فعال معتبر متصل نیست.'));
      continue;
    }
    const activeBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.tenantId, tenantId), eq(bots.platform, row.platform), eq(bots.status, 'ACTIVE')))
      .limit(2);
    if (activeBots.length !== 1 || !activeBots[0]) {
      throw new AppError(ERR.VALIDATION(activeBots.length > 1
        ? 'یکی از کانال‌ها بیش از یک ربات فعال دارد؛ ربات مقصد را مشخص کنید.'
        : 'یکی از کانال‌ها ربات فعال ندارد. ابتدا ربات همان پلتفرم را متصل و فعال کنید.'));
    }
    await db.update(channels).set({ botId: activeBots[0].id, updatedAt: new Date() }).where(eq(channels.id, row.id));
  }
  return unique;
}

async function resolvePostMediaIds(
  tenantId: string,
  requestedMediaIds: string[] | undefined,
  legacyMediaId: string | null | undefined,
): Promise<{ mediaIds: string[]; mediaId: string | null }> {
  const requested = requestedMediaIds !== undefined
    ? requestedMediaIds
    : legacyMediaId ? [legacyMediaId] : [];
  const mediaIds = [...new Set(requested)];
  if (mediaIds.length > 10) {
    throw new AppError(ERR.VALIDATION('برای هر پست حداکثر ۱۰ تصویر قابل انتخاب است.'));
  }
  if (mediaIds.length === 0) return { mediaIds: [], mediaId: null };

  const rows = await getDb()
    .select({ id: media.id, mime: media.mime, sizeBytes: media.sizeBytes })
    .from(media)
    .where(and(eq(media.tenantId, tenantId), inArray(media.id, mediaIds)));
  if (rows.length !== mediaIds.length) {
    throw new AppError(ERR.VALIDATION('یکی از رسانه‌های انتخاب‌شده معتبر نیست یا به حساب شما تعلق ندارد.'));
  }
  const totalStoredBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  if (totalStoredBytes > 20 * 1024 * 1024) {
    throw new AppError(ERR.VALIDATION('حجم مجموع تصاویر یک پست نباید بیشتر از ۲۰ مگابایت باشد.'));
  }
  const videos = rows.filter((row) => row.mime === 'video/mp4');
  if (rows.some((row) => !(row.mime.startsWith('image/') || row.mime === 'video/mp4'))) {
    throw new AppError(ERR.VALIDATION('برای انتشار فقط تصویر یا ویدئوی MP4 قابل استفاده است.'));
  }
  if (videos.length > 0 && (videos.length !== 1 || mediaIds.length !== 1)) {
    throw new AppError(ERR.VALIDATION('ویدئو را باید به‌تنهایی ارسال کنید؛ در یک پست نمی‌توان ویدئو را با تصاویر ترکیب کرد.'));
  }
  return { mediaIds, mediaId: mediaIds[0] ?? null };
}

function ensurePublishableState(state: string): void {
  if (state === 'QUEUED' || state === 'PUBLISHING') {
    throw new AppError(ERR.VALIDATION('این پست در حال انتشار است و امکان تغییر آن نیست.'));
  }
}

export async function createPost(tenantId: string, input: CreatePostInput, meta: ActorMeta = {}): Promise<typeof posts.$inferSelect> {
  const db = getDb();
  const body = (input.body ?? '').trim();
  if (body.length > MAX_POST_BODY_LENGTH) {
    throw new AppError(ERR.VALIDATION('متن پست پس از آماده‌سازی نباید از ۴۰۰۰ نویسه بیشتر باشد.'));
  }
  assertFooterLengths(body, input.buttons);

  const resolvedMedia = await resolvePostMediaIds(tenantId, input.mediaIds, input.mediaId);
  const mediaIds = resolvedMedia.mediaIds;
  const mediaId = resolvedMedia.mediaId;
  if (!body && mediaIds.length === 0) {
    throw new AppError(ERR.VALIDATION('پست باید حداقل متن یا رسانه داشته باشد.'));
  }

  const destinationSettingChannelIds = [...new Set([
    ...Object.keys(input.buttons?.byChannel ?? {}),
    ...Object.keys(input.buttons?.footerByChannel ?? {}),
  ])];
  if (destinationSettingChannelIds.length) {
    const ownedSettingChannels = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), inArray(channels.id, destinationSettingChannelIds)));
    if (ownedSettingChannels.length !== destinationSettingChannelIds.length) {
      throw new AppError(ERR.VALIDATION('تنظیمات اختصاصی دکمه یا متن انتهایی به یکی از کانال‌های معتبر حساب شما تعلق ندارد.'));
    }
  }

  const id = newId();
  await db.insert(posts).values({
    id,
    tenantId,
    title: input.title?.trim() || null,
    body,
    parseMode: input.parseMode ?? 'NONE',
    mediaId,
    mediaIds: mediaIds.length ? mediaIds : null,
    buttonsJson: input.buttons ?? null,
    source: input.source ?? 'MANUAL',
    state: 'DRAFT',
  });
  const post = await requireOwnedPost(tenantId, id);
  await emitEvent({ name: 'post.created', tenantId, subjectType: 'post', subjectId: id, props: { hasMedia: mediaIds.length > 0, mediaCount: mediaIds.length } });
  await audit({
    action: 'post.create',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: id,
    ip: meta.ip ?? undefined,
  });
  return post;
}

export async function publishNow(
  tenantId: string,
  postId: string,
  channelIds: string[],
  meta: ActorMeta = {}
): Promise<typeof posts.$inferSelect> {
  const post = await requireOwnedPost(tenantId, postId);
  ensurePublishableState(post.state);
  const uniqueChannels = await resolveActiveChannels(tenantId, channelIds);

  const db = getDb();
  let publishOutboxId: string | null = null;
  await db.transaction(async (tx) => {
    // Serialize quota-sensitive post mutations per tenant. The quota count is
    // evaluated while the tenant row is locked, preventing concurrent requests
    // from both consuming the last available post slot.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
    await assertWithinLimit(tenantId, 'posts');
    const flipped = await tx
      .update(posts)
      .set({ state: 'QUEUED', scheduledAt: null })
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId), eq(posts.state, post.state)));
    if (affectedRowsOf(flipped) === 0) {
      throw new AppError(ERR.CONFLICT('وضعیت پست همزمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.'));
    }
    for (const channelId of uniqueChannels) {
      await tx
        .insert(postTargets)
        .values({ id: newId(), postId, tenantId, channelId, state: 'PENDING' })
        .onDuplicateKeyUpdate({
          // Never resurrect already-delivered targets on re-publish (§23):
          // SENT stays SENT; only non-terminal states return to PENDING.
          set: {
            state: sql`IF(${postTargets.state} = 'SENT', 'SENT', 'PENDING')`,
            attempts: sql`IF(${postTargets.state} = 'SENT', ${postTargets.attempts}, 0)`,
            errorCode: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorCode}, NULL)`,
            errorMessage: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorMessage}, NULL)`,
            nextRetryAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.nextRetryAt}, NULL)`,
            sentAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.sentAt}, NULL)`,
            providerMessageId: sql`IF(${postTargets.state} = 'SENT', ${postTargets.providerMessageId}, NULL)`,
          },
        });
    }
    const outbox = outboxRow({ aggregateType: 'post', aggregateId: postId, eventType: 'post.publish', payload: {} });
    publishOutboxId = outbox.id;
    await tx.insert(outboxEvents).values(outbox);
  });

  // Fast path: enqueue pending targets immediately after commit. The durable
  // outbox remains the recovery path when Redis is temporarily unavailable.
  const pendingTargets = await db
    .select({ id: postTargets.id })
    .from(postTargets)
    .where(and(eq(postTargets.postId, postId), inArray(postTargets.state, ['PENDING', 'RETRYING'])));
  if (!publishOutboxId) throw new AppError(ERR.INTERNAL());
  for (const target of pendingTargets) {
    try {
      // The outbox id represents the publish generation. Re-publishing the same
      // post/channel must not collide with a completed BullMQ job retained in Redis.
      await enqueue('delivery', 'deliver', { targetId: target.id }, { jobId: `deliver:${target.id}:${publishOutboxId}` });
    } catch (err) {
      log.warn({ postId, targetId: target.id, errorName: err instanceof Error ? err.name : 'UnknownError', errorMessage: String(err instanceof Error ? err.message : err ?? '').slice(0, 180) }, 'publish_fast_path_enqueue_failed');
      // The post/outbox transaction is already durable; the relay will recover
      // this target when Redis becomes available again.
    }
  }
  // A publish request against destinations that are already SENT creates no
  // pending job. Restore the aggregate instead of leaving the post QUEUED forever.
  if (pendingTargets.length === 0) await refreshPostAggregate(postId);

  await audit({
    action: 'post.publish',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { channels: uniqueChannels.length },
  });
  return requireOwnedPost(tenantId, postId);
}

export async function schedulePost(
  tenantId: string,
  postId: string,
  channelIds: string[],
  scheduledAt: Date,
  meta: ActorMeta = {}
): Promise<typeof posts.$inferSelect> {
  const post = await requireOwnedPost(tenantId, postId);
  ensurePublishableState(post.state);
  if (!(scheduledAt.getTime() > Date.now())) {
    throw new AppError(ERR.VALIDATION('زمان انتشار باید در آینده باشد.'));
  }
  const uniqueChannels = await resolveActiveChannels(tenantId, channelIds);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
    await assertWithinLimit(tenantId, 'schedules');
    const flipped = await tx
      .update(posts)
      .set({ state: 'SCHEDULED', scheduledAt })
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId), eq(posts.state, post.state)));
    if (affectedRowsOf(flipped) === 0) {
      throw new AppError(ERR.CONFLICT('وضعیت پست همزمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.'));
    }
    for (const channelId of uniqueChannels) {
      await tx
        .insert(postTargets)
        .values({ id: newId(), postId, tenantId, channelId, state: 'PENDING' })
        .onDuplicateKeyUpdate({
          // Never resurrect already-delivered targets on re-publish (§23):
          // SENT stays SENT; only non-terminal states return to PENDING.
          set: {
            state: sql`IF(${postTargets.state} = 'SENT', 'SENT', 'PENDING')`,
            attempts: sql`IF(${postTargets.state} = 'SENT', ${postTargets.attempts}, 0)`,
            errorCode: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorCode}, NULL)`,
            errorMessage: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorMessage}, NULL)`,
            nextRetryAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.nextRetryAt}, NULL)`,
            sentAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.sentAt}, NULL)`,
            providerMessageId: sql`IF(${postTargets.state} = 'SENT', ${postTargets.providerMessageId}, NULL)`,
          },
        });
    }
  });

  // Scheduling a destination already marked SENT has no future work. Do not leave
  // a no-op scheduled post in SCHEDULED/QUEUED state with nothing to deliver.
  const pendingScheduledTargets = await db
    .select({ id: postTargets.id })
    .from(postTargets)
    .where(and(eq(postTargets.postId, postId), eq(postTargets.state, 'PENDING')))
    .limit(500);
  if (!pendingScheduledTargets.length) await refreshPostAggregate(postId);

  // DB is the canonical schedule clock. Do not create a delayed BullMQ job here:
  // the durable SCHEDULED row is the persisted contract, and the worker (30s) +
  // scheduler (1m) recovery lanes promote due rows into the transactional outbox.
  // This removes Redis delayed-job state from the correctness path while keeping
  // legacy `publish-scheduled` jobs idempotently supported by the delivery worker.

  await emitEvent({ name: 'post.scheduled', tenantId, subjectType: 'post', subjectId: postId });
  await audit({
    action: 'post.schedule',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { channels: uniqueChannels.length, scheduledAt: scheduledAt.toISOString() },
  });
  return requireOwnedPost(tenantId, postId);
}

/**
 * Update an upcoming scheduled post atomically. Editing is permitted only while
 * the parent is still SCHEDULED, its time is still in the future, and every
 * existing destination remains PENDING. Parent and target rows are locked so
 * the scheduler/worker cannot claim a destination halfway through the edit.
 */
export async function updateScheduledPost(
  tenantId: string,
  postId: string,
  input: UpdateScheduledPostInput,
  meta: ActorMeta = {}
): Promise<typeof posts.$inferSelect> {
  const db = getDb();
  const now = new Date();
  const body = (input.body ?? '').trim();
  const requestedTime = input.scheduledAt;

  if (body.length > MAX_POST_BODY_LENGTH) {
    throw new AppError(ERR.VALIDATION('متن پست پس از آماده‌سازی نباید از ۴۰۰۰ نویسه بیشتر باشد.'));
  }
  if (!requestedTime || Number.isNaN(requestedTime.getTime()) || requestedTime.getTime() <= now.getTime()) {
    throw new AppError(ERR.VALIDATION('زمان انتشار باید در آینده باشد.'));
  }

  const resolvedMedia = await resolvePostMediaIds(tenantId, input.mediaIds, input.mediaId);
  const mediaIds = resolvedMedia.mediaIds;
  const mediaId = resolvedMedia.mediaId;
  if (!body && mediaIds.length === 0) {
    throw new AppError(ERR.VALIDATION('پست باید حداقل متن یا رسانه داشته باشد.'));
  }
  assertFooterLengths(body, input.buttons);

  const uniqueChannels = await resolveActiveChannels(tenantId, input.channelIds);
  const selectedChannelSet = new Set(uniqueChannels);
  const destinationSettingChannelIds = [...new Set([
    ...Object.keys(input.buttons?.byChannel ?? {}),
    ...Object.keys(input.buttons?.footerByChannel ?? {}),
  ])];
  if (destinationSettingChannelIds.some((id) => !selectedChannelSet.has(id))) {
    throw new AppError(ERR.VALIDATION('دکمه‌ها و متن انتهایی فقط باید به کانال‌های انتخاب‌شده تعلق داشته باشند.'));
  }
  if (destinationSettingChannelIds.length) {
    const ownedSettingChannels = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), inArray(channels.id, destinationSettingChannelIds)));
    if (ownedSettingChannels.length !== destinationSettingChannelIds.length) {
      throw new AppError(ERR.VALIDATION('تنظیمات اختصاصی دکمه یا متن انتهایی به یکی از کانال‌های معتبر حساب شما تعلق ندارد.'));
    }
  }

  await db.transaction(async (tx) => {
    // Lock the owned post first. This serializes edits with schedule/publish/cancel.
    const [post] = await tx
      .select({ id: posts.id, state: posts.state, scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)))
      .limit(1)
      .for('update');
    if (!post) throw new AppError(ERR.NOT_FOUND('پست'));
    if (post.state !== 'SCHEDULED' || !post.scheduledAt || post.scheduledAt.getTime() <= Date.now()) {
      throw new AppError(ERR.CONFLICT('فقط پست زمان‌بندی‌شده‌ای که هنوز موعد انتشارش نرسیده قابل ویرایش است.'));
    }

    // Lock all current destinations and reject any in-flight/terminal state.
    const existingTargets = await tx
      .select({ id: postTargets.id, channelId: postTargets.channelId, state: postTargets.state })
      .from(postTargets)
      .where(and(eq(postTargets.postId, postId), eq(postTargets.tenantId, tenantId)))
      .for('update');
    // CANCELLED rows are retained as delivery history when a destination is
    // removed from an earlier edit. They are not current destinations and must
    // not permanently make the otherwise-upcoming post uneditable.
    const activeTargets = existingTargets.filter((target) => target.state !== 'CANCELLED');
    if (activeTargets.length === 0 || activeTargets.some((target) => target.state !== 'PENDING')) {
      throw new AppError(ERR.CONFLICT('این پست فقط وقتی قابل ویرایش است که همهٔ مقصدهای فعال آن هنوز در انتظار ارسال باشند.'));
    }

    const updateNow = new Date();
    if (requestedTime.getTime() <= updateNow.getTime()) {
      throw new AppError(ERR.VALIDATION('زمان انتشار باید در آینده باشد.'));
    }

    const changed = await tx
      .update(posts)
      .set({
        title: input.title?.trim() || null,
        body,
        parseMode: input.parseMode ?? 'NONE',
        mediaId,
        mediaIds: mediaIds.length ? mediaIds : null,
        buttonsJson: input.buttons ?? null,
        scheduledAt: requestedTime,
      })
      .where(and(
        eq(posts.id, postId),
        eq(posts.tenantId, tenantId),
        eq(posts.state, 'SCHEDULED'),
        gt(posts.scheduledAt, updateNow),
      ));
    if (affectedRowsOf(changed) === 0) {
      throw new AppError(ERR.CONFLICT('وضعیت پست همزمان تغییر کرده است؛ صفحه را تازه کنید.'));
    }

    const existingChannelSet = new Set(activeTargets.map((target) => target.channelId));
    const targetByChannel = new Map(existingTargets.map((target) => [target.channelId, target]));
    const removedTargetIds = activeTargets
      .filter((target) => !selectedChannelSet.has(target.channelId))
      .map((target) => target.id);
    if (removedTargetIds.length) {
      await tx
        .update(postTargets)
        .set({ state: 'CANCELLED', nextRetryAt: null })
        .where(and(inArray(postTargets.id, removedTargetIds), eq(postTargets.state, 'PENDING')));
    }

    for (const channelId of uniqueChannels) {
      if (existingChannelSet.has(channelId)) continue;
      const previousTarget = targetByChannel.get(channelId);
      if (previousTarget?.state === 'CANCELLED') {
        // A removed target may be selected again while this post is still
        // scheduled. Reactivate its existing unique row instead of colliding
        // with the (postId, channelId) unique key.
        await tx
          .update(postTargets)
          .set({
            state: 'PENDING',
            attempts: 0,
            errorCode: null,
            errorMessage: null,
            nextRetryAt: null,
            sentAt: null,
            providerMessageId: null,
          })
          .where(and(
            eq(postTargets.id, previousTarget.id),
            eq(postTargets.tenantId, tenantId),
            eq(postTargets.state, 'CANCELLED'),
          ));
        continue;
      }
      if (previousTarget) {
        throw new AppError(ERR.CONFLICT('وضعیت یکی از مقصدها همزمان تغییر کرده است؛ صفحه را تازه کنید.'));
      }
      await tx.insert(postTargets).values({
        id: newId(),
        postId,
        tenantId,
        channelId,
        state: 'PENDING',
      });
    }
  });

  await emitEvent({
    name: 'post.scheduled.updated',
    tenantId,
    subjectType: 'post',
    subjectId: postId,
    props: { channels: uniqueChannels.length, scheduledAt: requestedTime.toISOString() },
  });
  await audit({
    action: 'post.schedule.update',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { channels: uniqueChannels.length, scheduledAt: requestedTime.toISOString() },
  });
  return requireOwnedPost(tenantId, postId);
}


export interface UpdatePublishedPostTextInput {
  body: string;
  parseMode?: ParseMode;
}

export interface PublishedEditTargetResult {
  targetId: string;
  channelId: string;
  channelTitle: string;
  platform: Platform;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

function stripPublishedHtml(input: string): string {
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

function stripPublishedMarkdown(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\u0060{1,3}([^\u0060]*)\u0060{1,3}/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

function escapePublishedFooter(input: string, parseMode: ParseMode): string {
  if (parseMode === 'HTML') {
    return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (parseMode === 'MARKDOWN') {
    const special = new Set(['_', '*', '[', ']', '(', ')', '~', String.fromCharCode(96), '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\']);
    return Array.from(input, (char) => special.has(char) ? '\\' + char : char).join('');
  }
  return input;
}

function safePublishedEditError(error: unknown): string {
  if (error && typeof error === 'object' && 'userMessageFa' in error) {
    const message = (error as { userMessageFa?: unknown }).userMessageFa;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 255);
  }
  if (error instanceof Error && /message is not modified/i.test(error.message)) return '';
  return 'ویرایش در پیام‌رسان مقصد انجام نشد؛ اتصال و دسترسی ربات را بررسی کنید.';
}

/**
 * Edit only the existing text/caption of messages already delivered by Postyar.
 * This deliberately does not resend media or modify inline keyboards. Exact
 * sender/chat identifiers are required; legacy targets without them are not
 * guessed from the channel's current bot connection.
 */
export async function updatePublishedPostText(
  tenantId: string,
  postId: string,
  input: UpdatePublishedPostTextInput,
  meta: ActorMeta = {},
): Promise<{
  post: typeof posts.$inferSelect;
  results: PublishedEditTargetResult[];
  updatedCount: number;
  failedCount: number;
}> {
  const db = getDb();
  const body = input.body.trim();
  const now = new Date();
  if (body.length > MAX_POST_BODY_LENGTH) {
    throw new AppError(ERR.VALIDATION('متن جدید حداکثر ۴۰۰۰ نویسه است.'));
  }

  type PreparedEdit = {
    targetId: string;
    channelId: string;
    channelTitle: string;
    platform: Platform;
    botId: string;
    chatRef: string;
    messageId: string;
    kind: 'TEXT' | 'CAPTION';
    text: string;
    parseMode: ParseMode;
  };

  const prepared: PreparedEdit[] = [];
  const results: PublishedEditTargetResult[] = [];
  let currentPost: typeof posts.$inferSelect | null = null;
  const lockUntil = new Date(now.getTime() + 10 * 60 * 1000);

  await db.transaction(async (tx) => {
    const [post] = await tx
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)))
      .limit(1)
      .for('update');
    if (!post) throw new AppError(ERR.NOT_FOUND('پست'));
    currentPost = post;

    if (post.state !== 'PUBLISHED' && post.state !== 'PARTIAL') {
      throw new AppError(ERR.CONFLICT('ویرایش پس از انتشار فقط برای پست منتشرشده یا دارای ارسال موفق امکان‌پذیر است.'));
    }

    const hasMedia = (Array.isArray(post.mediaIds) && post.mediaIds.length > 0) || Boolean(post.mediaId);
    assertFooterLengths(body, post.buttonsJson);
    if (!body && !hasMedia) {
      throw new AppError(ERR.VALIDATION('متن پست نمی‌تواند خالی باشد؛ مگر اینکه رسانه‌ای به پست پیوست شده باشد.'));
    }

    const targets = await tx
      .select({
        targetId: postTargets.id,
        state: postTargets.state,
        channelId: channels.id,
        channelTitle: channels.title,
        platform: channels.platform,
        providerMessageId: postTargets.providerMessageId,
        providerBotId: postTargets.providerBotId,
        providerChatRef: postTargets.providerChatRef,
        providerTextMessageId: postTargets.providerTextMessageId,
        providerTextKind: postTargets.providerTextKind,
        editState: postTargets.editState,
        editLockUntil: postTargets.editLockUntil,
      })
      .from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(
        eq(postTargets.postId, postId),
        eq(postTargets.tenantId, tenantId),
        eq(channels.tenantId, tenantId),
      ))
      .orderBy(postTargets.createdAt)
      .for('update');

    const sentTargets = targets.filter((target) => target.state === 'SENT');
    if (sentTargets.length === 0) {
      throw new AppError(ERR.CONFLICT('هیچ مقصدی با وضعیت ارسال موفق برای ویرایش وجود ندارد.'));
    }

    const requestedParseMode = input.parseMode ?? post.parseMode;
    for (const target of sentTargets) {
      const platform = target.platform as Platform;
      const provider = getProvider(platform);
      const caps = provider.capabilities();

      if (target.editState === 'PROCESSING' && target.editLockUntil && target.editLockUntil.getTime() > now.getTime()) {
        throw new AppError(ERR.CONFLICT('ویرایش دیگری برای این پست در حال انجام است؛ چند لحظه بعد دوباره تلاش کنید.'));
      }

      let targetText = body;
      let targetParseMode: ParseMode = requestedParseMode;
      if (!caps.htmlParseMode) {
        if (targetParseMode === 'HTML') {
          targetText = stripPublishedHtml(targetText);
          targetParseMode = 'NONE';
        } else if (targetParseMode === 'MARKDOWN') {
          targetText = stripPublishedMarkdown(targetText);
          targetParseMode = 'NONE';
        }
      }

      const footerValue = post.buttonsJson?.footerByChannel?.[target.channelId];
      const footer = typeof footerValue === 'string' ? footerValue.trim() : '';
      if (footer) {
        const safeFooter = escapePublishedFooter(footer, targetParseMode);
        const baseText = targetText.trimEnd();
        targetText = baseText
          ? baseText + (targetParseMode === 'HTML' ? '<br><br>' : '\n\n') + safeFooter
          : safeFooter;
      }

      let messageId = target.providerTextMessageId;
      let kind = target.providerTextKind as 'TEXT' | 'CAPTION' | null;

      // Text-only fallback is safe only when exact sender/chat identity exists.
      // Telegram and Bale additionally document editing the first album caption.
      if (!messageId && !hasMedia && target.providerMessageId) {
        messageId = target.providerMessageId;
        kind = kind ?? 'TEXT';
      } else if (!messageId && hasMedia && target.providerMessageId && (platform === 'telegram' || platform === 'bale')) {
        messageId = target.providerMessageId;
        kind = kind ?? 'CAPTION';
      }

      let unsupported = '';
      let errorCode: string | null = null;
      if (!target.providerBotId || !target.providerChatRef) {
        unsupported = 'شناسهٔ دقیق ربات و مقصدِ زمان ارسال در نسخهٔ قدیمی ذخیره نشده است؛ ویرایش امن این پیام ممکن نیست.';
        errorCode = 'EDIT_METADATA_MISSING';
      } else if (!caps.editMessage || (kind === 'TEXT' && typeof provider.editMessageText !== 'function') || (kind === 'CAPTION' && typeof provider.editMessageCaption !== 'function')) {
        unsupported = 'ویرایش این نوع پیام با API رسمی پیام‌رسان مقصد در دسترس نیست.';
        errorCode = 'EDIT_METHOD_UNAVAILABLE';
      } else if (!messageId || !kind) {
        unsupported = 'شناسهٔ پیامِ حامل متن یا کپشن برای این مقصد ثبت نشده است.';
        errorCode = 'EDIT_MESSAGE_ID_MISSING';
      } else if (kind === 'CAPTION' && targetText.length > 1024) {
        unsupported = 'متن جدید برای کپشن این پیام بیش از ۱۰۲۴ نویسه است؛ این پیام باید با متن کوتاه‌تری ویرایش شود.';
        errorCode = 'EDIT_CAPTION_TOO_LONG';
      } else if (targetText.length > (kind === 'CAPTION' ? 1024 : 4096)) {
        unsupported = 'متن جدید از محدودیت پیام‌رسان مقصد بیشتر است.';
        errorCode = 'EDIT_TEXT_TOO_LONG';
      }

      if (unsupported) {
        results.push({
          targetId: target.targetId,
          channelId: target.channelId,
          channelTitle: target.channelTitle,
          platform,
          success: false,
          errorCode,
          errorMessage: unsupported,
        });
        await tx.update(postTargets)
          .set({ editErrorCode: errorCode, editErrorMessage: unsupported })
          .where(and(
            eq(postTargets.id, target.targetId),
            eq(postTargets.tenantId, tenantId),
            eq(postTargets.state, 'SENT'),
          ));
        continue;
      }

      const claim = await tx.update(postTargets)
        .set({ editState: 'PROCESSING', editLockUntil: lockUntil, editErrorCode: null, editErrorMessage: null })
        .where(and(
          eq(postTargets.id, target.targetId),
          eq(postTargets.tenantId, tenantId),
          eq(postTargets.state, 'SENT'),
          or(eq(postTargets.editState, 'IDLE'), lt(postTargets.editLockUntil, now), and(eq(postTargets.editState, 'PROCESSING'), isNull(postTargets.editLockUntil))),
        ));
      if (affectedRowsOf(claim) === 0) {
        throw new AppError(ERR.CONFLICT('وضعیت ویرایش یکی از مقصدها همزمان تغییر کرده است؛ صفحه را تازه کنید.'));
      }

      prepared.push({
        targetId: target.targetId,
        channelId: target.channelId,
        channelTitle: target.channelTitle,
        platform,
        botId: target.providerBotId!,
        chatRef: target.providerChatRef!,
        messageId: messageId!,
        kind: kind!,
        text: targetText,
        parseMode: targetParseMode,
      });
    }
  });

  let updatedCount = 0;
  for (const item of prepared) {
    try {
      const [bot] = await db
        .select({ tokenEncrypted: bots.tokenEncrypted, status: bots.status, platform: bots.platform })
        .from(bots)
        .where(and(
          eq(bots.id, item.botId),
          eq(bots.tenantId, tenantId),
          eq(bots.platform, item.platform),
        ))
        .limit(1);

      if (!bot || bot.status !== 'ACTIVE') {
        throw new Error('ربات ارسال‌کننده دیگر فعال یا در دسترس نیست.');
      }

      const provider = getProvider(item.platform);
      const token = decryptSecret(bot.tokenEncrypted);
      if (item.kind === 'CAPTION') {
        if (typeof provider.editMessageCaption !== 'function') {
          throw new Error('این پیام‌رسان ویرایش کپشن را پشتیبانی نمی‌کند.');
        }
        await provider.editMessageCaption(token, item.chatRef, item.messageId, item.text, item.parseMode);
      } else {
        if (typeof provider.editMessageText !== 'function') {
          throw new Error('این پیام‌رسان ویرایش متن را پشتیبانی نمی‌کند.');
        }
        await provider.editMessageText(token, item.chatRef, item.messageId, item.text, item.parseMode);
      }

      await db.update(postTargets)
        .set({
          editState: 'IDLE',
          editLockUntil: null,
          providerTextMessageId: item.messageId,
          providerTextKind: item.kind,
          providerText: item.text,
          providerParseMode: item.parseMode,
          editedAt: new Date(),
          editErrorCode: null,
          editErrorMessage: null,
        })
        .where(and(
          eq(postTargets.id, item.targetId),
          eq(postTargets.tenantId, tenantId),
          eq(postTargets.editState, 'PROCESSING'),
        ));

      updatedCount += 1;
      results.push({
        targetId: item.targetId,
        channelId: item.channelId,
        channelTitle: item.channelTitle,
        platform: item.platform,
        success: true,
        errorCode: null,
        errorMessage: null,
      });
    } catch (error) {
      const safeMessage = safePublishedEditError(error);
      if (!safeMessage) {
        await db.update(postTargets)
          .set({
            editState: 'IDLE',
            editLockUntil: null,
            providerTextMessageId: item.messageId,
            providerTextKind: item.kind,
            providerText: item.text,
            providerParseMode: item.parseMode,
            editedAt: new Date(),
            editErrorCode: null,
            editErrorMessage: null,
          })
          .where(and(
            eq(postTargets.id, item.targetId),
            eq(postTargets.tenantId, tenantId),
            eq(postTargets.editState, 'PROCESSING'),
          ));
        updatedCount += 1;
        results.push({
          targetId: item.targetId,
          channelId: item.channelId,
          channelTitle: item.channelTitle,
          platform: item.platform,
          success: true,
          errorCode: null,
          errorMessage: null,
        });
        continue;
      }

      await db.update(postTargets)
        .set({
          editState: 'IDLE',
          editLockUntil: null,
          editErrorCode: 'PROVIDER_EDIT_FAILED',
          editErrorMessage: safeMessage,
        })
        .where(and(
          eq(postTargets.id, item.targetId),
          eq(postTargets.tenantId, tenantId),
          eq(postTargets.editState, 'PROCESSING'),
        ));

      results.push({
        targetId: item.targetId,
        channelId: item.channelId,
        channelTitle: item.channelTitle,
        platform: item.platform,
        success: false,
        errorCode: 'PROVIDER_EDIT_FAILED',
        errorMessage: safeMessage,
      });
    }
  }

  if (updatedCount > 0) {
    const parseMode = input.parseMode ?? currentPost!.parseMode;
    await db.update(posts)
      .set({ body, parseMode })
      .where(and(
        eq(posts.id, postId),
        eq(posts.tenantId, tenantId),
        inArray(posts.state, ['PUBLISHED', 'PARTIAL']),
      ));
  }

  const failedCount = results.filter((result) => !result.success).length;
  await audit({
    action: 'post.published.edit',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { updated: updatedCount, failed: failedCount, destinations: results.length },
  });

  const updatedPost = await requireOwnedPost(tenantId, postId);
  return { post: updatedPost, results, updatedCount, failedCount };
}

export interface PostListResult {
  items: Array<typeof posts.$inferSelect & { targetSummary: Array<{ state: string; count: number }>; channelSummary: Array<{ platform: string; count: number; sentCount: number; failedCount: number }>; channelDetails: Array<{ channelId: string; title: string; platform: string; state: string }>; latestSentAt: Date | null }>;
  total: number;
  page: number;
  pageSize: number;
}

export async function listPosts(tenantId: string, query: PostListQuery): Promise<PostListResult> {
  const db = getDb();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const conditions = [eq(posts.tenantId, tenantId)];
  if (query.state) conditions.push(eq(posts.state, query.state));
  if (query.channelId) {
    conditions.push(inArray(
      posts.id,
      db.select({ postId: postTargets.postId })
        .from(postTargets)
        .where(and(eq(postTargets.tenantId, tenantId), eq(postTargets.channelId, query.channelId))),
    ));
  }
  const search = query.search ? cleanSearch(query.search) : '';
  if (search) {
    const pattern = `%${search}%`;
    const cond = or(like(posts.title, pattern), like(posts.body, pattern));
    if (cond) conditions.push(cond);
  }
  const where = and(...conditions);

  const [countRow] = await db.select({ total: sql<number>`count(*)` }).from(posts).where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select()
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const summaryRows = ids.length
    ? await db
        .select({ postId: postTargets.postId, state: postTargets.state, count: sql<number>`count(*)` })
        .from(postTargets)
        .where(inArray(postTargets.postId, ids))
        .groupBy(postTargets.postId, postTargets.state)
    : [];

  const channelRows = ids.length
    ? await db.select({ postId: postTargets.postId, channelId: postTargets.channelId, channelTitle: channels.title, state: postTargets.state, sentAt: postTargets.sentAt, platform: channels.platform })
        .from(postTargets)
        .innerJoin(channels, eq(channels.id, postTargets.channelId))
        .where(and(eq(postTargets.tenantId, tenantId), eq(channels.tenantId, tenantId), inArray(postTargets.postId, ids)))
    : [];

  const items = rows.map((row) => {
    const postTargetsForRow = channelRows.filter((target) => target.postId === row.id);
    const platformCounts = new Map<string, { platform: string; count: number; sentCount: number; failedCount: number }>();
    let latestSentAt: Date | null = null;
    for (const target of postTargetsForRow) {
      if (target.state === 'CANCELLED') continue;
      const key = String(target.platform ?? '');
      const current = platformCounts.get(key) ?? { platform: key, count: 0, sentCount: 0, failedCount: 0 };
      current.count += 1;
      if (target.state === 'SENT') current.sentCount += 1;
      if (target.state === 'FAILED') current.failedCount += 1;
      platformCounts.set(key, current);
      if (target.state === 'SENT' && target.sentAt && (!latestSentAt || target.sentAt.getTime() > latestSentAt.getTime())) latestSentAt = target.sentAt;
    }
    return {
      ...row,
      targetSummary: summaryRows.filter((s) => s.postId === row.id).map((s) => ({ state: s.state, count: Number(s.count) })),
      channelSummary: [...platformCounts.values()].sort((a, b) => a.platform.localeCompare(b.platform)),
      channelDetails: postTargetsForRow
        .filter((target) => target.state !== 'CANCELLED')
        .map((target) => ({ channelId: target.channelId, title: target.channelTitle, platform: String(target.platform ?? ''), state: target.state }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      latestSentAt,
    };
  });

  return { items, total, page, pageSize };
}

export async function getPost(
  tenantId: string,
  postId: string
): Promise<{
  post: typeof posts.$inferSelect;
  targets: TargetView[];
  /** Legacy single-media view retained for older clients. */
  media: { id: string; filename: string; mime: string; sizeBytes: number } | null;
  mediaItems: Array<{ id: string; filename: string; mime: string; sizeBytes: number }>;
}> {
  const db = getDb();
  const post = await requireOwnedPost(tenantId, postId);
  const requestedMediaIds = Array.isArray(post.mediaIds) && post.mediaIds.length
    ? post.mediaIds
    : post.mediaId ? [post.mediaId] : [];
  const mediaRows = requestedMediaIds.length
    ? await db
        .select({ id: media.id, filename: media.filename, mime: media.mime, sizeBytes: media.sizeBytes })
        .from(media)
        .where(and(eq(media.tenantId, tenantId), inArray(media.id, requestedMediaIds)))
    : [];
  const mediaById = new Map(mediaRows.map((item) => [item.id, item]));
  const mediaItems = requestedMediaIds.map((id) => mediaById.get(id)).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );
  const mediaInfo = mediaItems[0] ?? null;
  const targets = await db
    .select({
      id: postTargets.id,
      channelId: postTargets.channelId,
      state: postTargets.state,
      attempts: postTargets.attempts,
      providerMessageId: postTargets.providerMessageId,
      errorCode: postTargets.errorCode,
      errorMessage: postTargets.errorMessage,
      editErrorCode: postTargets.editErrorCode,
      editErrorMessage: postTargets.editErrorMessage,
      editedAt: postTargets.editedAt,
      sentAt: postTargets.sentAt,
      nextRetryAt: postTargets.nextRetryAt,
      platform: channels.platform,
      channelTitle: channels.title,
      channelRef: channels.channelRef,
    })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id))
    .orderBy(postTargets.createdAt);
  return { post, targets, media: mediaInfo, mediaItems };
}

export async function cancelPost(tenantId: string, postId: string, meta: ActorMeta = {}): Promise<typeof posts.$inferSelect> {
  const db = getDb();
  const post = await requireOwnedPost(tenantId, postId);
  if (post.state !== 'SCHEDULED' && post.state !== 'QUEUED') {
    throw new AppError(ERR.VALIDATION('فقط پست‌های زمان‌بندی‌شده یا در صف انتشار قابل لغو هستند.'));
  }
  await db.transaction(async (tx) => {
    const flipped = await tx
      .update(posts)
      .set({ state: 'CANCELLED' })
      .where(and(eq(posts.id, postId), inArray(posts.state, ['SCHEDULED', 'QUEUED'])));
    if (affectedRowsOf(flipped) === 0) {
      throw new AppError(ERR.CONFLICT('وضعیت پست همزمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.'));
    }
    // PENDING/RETRYING targets are cancelled; SENT ones are kept (already delivered).
    await tx
      .update(postTargets)
      .set({ state: 'CANCELLED', nextRetryAt: null })
      .where(and(eq(postTargets.postId, postId), inArray(postTargets.state, ['PENDING', 'RETRYING'])));
  });
  await audit({
    action: 'post.cancel',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
  });
  return requireOwnedPost(tenantId, postId);
}

export async function retryTarget(tenantId: string, targetId: string, meta: ActorMeta = {}): Promise<{ ok: true }> {
  const db = getDb();
  const [row] = await db
    .select({ targetId: postTargets.id, state: postTargets.state, postId: postTargets.postId, postState: posts.state })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.id, targetId), eq(posts.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('مقصدهای ارسال'));
  if (row.state !== 'FAILED') {
    throw new AppError(ERR.VALIDATION('فقط ارسال‌های ناموفق قابل تلاش مجدد هستند.'));
  }
  if (row.postState === 'CANCELLED' || row.postState === 'DRAFT') {
    throw new AppError(ERR.CONFLICT('این پست دیگر قابل تلاش مجدد نیست. ابتدا یک انتشار جدید برای پست ایجاد کنید.'));
  }
  if (row.postState === 'QUEUED' || row.postState === 'PUBLISHING' || row.postState === 'SCHEDULED') {
    throw new AppError(ERR.CONFLICT('این پست هم‌اکنون در چرخهٔ انتشار است.'));
  }

  await db.transaction(async (tx) => {
    // Atomically claim FAILED → PENDING and make the aggregate recoverable.
    const claimed = await tx
      .update(postTargets)
      .set({ state: 'PENDING', attempts: 0, nextRetryAt: null, errorCode: null, errorMessage: null })
      .where(and(eq(postTargets.id, targetId), eq(postTargets.state, 'FAILED')));
    if (affectedRowsOf(claimed) === 0) {
      throw new AppError(ERR.CONFLICT('این مقصد هم‌اکنون در حال پردازش است.'));
    }

    const flipped = await tx
      .update(posts)
      .set({ state: 'QUEUED', scheduledAt: null })
      .where(and(eq(posts.id, row.postId), eq(posts.tenantId, tenantId), inArray(posts.state, ['FAILED', 'PARTIAL'])));
    if (affectedRowsOf(flipped) === 0) {
      throw new AppError(ERR.CONFLICT('وضعیت پست برای تلاش مجدد تغییر کرده است.'));
    }

    await tx.insert(outboxEvents).values(
      outboxRow({ aggregateType: 'post', aggregateId: row.postId, eventType: 'post.publish', payload: { retryTargetId: targetId } })
    );
  });

  // Fast path. Failure here is intentionally swallowed because the DB outbox is durable.
  try {
    await enqueue('delivery', 'deliver', { targetId }, { jobId: `retry-manual:${targetId}:${newId()}` });
  } catch {
    // Scheduler/outbox relay will recover the PENDING target when Redis is available.
  }

  await audit({
    action: 'post.target.retry',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post_target',
    subjectId: targetId,
    ip: meta.ip ?? undefined,
  });
  return { ok: true };
}

/** mysql2/drizzle update result → affected rows (shape-safe, no `any`). */
export function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}
