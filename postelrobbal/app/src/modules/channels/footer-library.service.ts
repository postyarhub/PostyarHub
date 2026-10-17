import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { channelSavedFooters, channels } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';

export interface SavedFooterInput {
  text: string;
}

async function requireOwnedChannel(tenantId: string, channelId: string): Promise<void> {
  const [channel] = await getDb().select({ id: channels.id }).from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId))).limit(1);
  if (!channel) throw new AppError(ERR.NOT_FOUND('کانال'));
}

function view(row: typeof channelSavedFooters.$inferSelect) {
  return {
    id: row.id,
    channelId: row.channelId,
    text: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSavedFooters(tenantId: string, channelId: string) {
  await requireOwnedChannel(tenantId, channelId);
  const rows = await getDb().select().from(channelSavedFooters)
    .where(and(eq(channelSavedFooters.tenantId, tenantId), eq(channelSavedFooters.channelId, channelId)))
    .orderBy(desc(channelSavedFooters.createdAt), asc(channelSavedFooters.id));
  return rows.map(view);
}

export async function saveChannelFooter(tenantId: string, channelId: string, input: SavedFooterInput) {
  await requireOwnedChannel(tenantId, channelId);
  const text = input.text.trim();
  if (!text || text.length > 500) throw new AppError(ERR.VALIDATION('متن انتهایی باید بین ۱ تا ۵۰۰ نویسه باشد.'));
  const db = getDb();
  const contentHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const [existing] = await db.select().from(channelSavedFooters).where(and(
    eq(channelSavedFooters.tenantId, tenantId),
    eq(channelSavedFooters.channelId, channelId),
    eq(channelSavedFooters.contentHash, contentHash),
  )).limit(1);
  if (existing) {
    if (existing.content !== text) throw new AppError(ERR.INTERNAL());
    await audit({ action: 'channel.footer_library.reused', actorId: tenantId, subjectType: 'channel_saved_footer', subjectId: existing.id, meta: { channelId, length: text.length } });
    return view(existing);
  }

  const id = newId();
  await db.insert(channelSavedFooters).values({ id, tenantId, channelId, content: text, contentHash });
  await audit({ action: 'channel.footer_library.created', actorId: tenantId, subjectType: 'channel_saved_footer', subjectId: id, meta: { channelId, length: text.length } });
  const [created] = await db.select().from(channelSavedFooters).where(and(
    eq(channelSavedFooters.id, id),
    eq(channelSavedFooters.tenantId, tenantId),
    eq(channelSavedFooters.channelId, channelId),
  )).limit(1);
  if (!created) throw new AppError(ERR.INTERNAL());
  return view(created);
}

export async function deleteSavedFooter(tenantId: string, channelId: string, footerId: string) {
  await requireOwnedChannel(tenantId, channelId);
  const db = getDb();
  const [footer] = await db.select({ id: channelSavedFooters.id, content: channelSavedFooters.content }).from(channelSavedFooters).where(and(
    eq(channelSavedFooters.id, footerId),
    eq(channelSavedFooters.tenantId, tenantId),
    eq(channelSavedFooters.channelId, channelId),
  )).limit(1);
  if (!footer) throw new AppError(ERR.NOT_FOUND('متن انتهایی ذخیره‌شده'));
  await db.delete(channelSavedFooters).where(and(
    eq(channelSavedFooters.id, footerId),
    eq(channelSavedFooters.tenantId, tenantId),
    eq(channelSavedFooters.channelId, channelId),
  ));
  await audit({ action: 'channel.footer_library.deleted', actorId: tenantId, subjectType: 'channel_saved_footer', subjectId: footerId, meta: { channelId, length: footer.content.length } });
  return { id: footerId, deleted: true };
}
