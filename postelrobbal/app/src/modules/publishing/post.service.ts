import { and, desc, eq, gt, inArray, like, or, sql } from 'drizzle-orm';
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
