import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { channelSavedButtons, channels, type PostButtonTarget } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { normalizeButtonTargetValue } from '../../core/button-target.js';
import { audit } from '../../core/audit.js';

export interface SavedButtonInput {
  label: string;
  target: PostButtonTarget;
}

function normalizeSavedTarget(target: PostButtonTarget): PostButtonTarget {
  try {
    return { type: target.type, value: normalizeButtonTargetValue(target.type, target.value) } as PostButtonTarget;
  } catch {
    throw new AppError(ERR.VALIDATION('مقصد دکمه معتبر نیست. لینک باید http/https باشد و شماره یا شناسه نیز باید در قالب درست وارد شود.'));
  }
}

async function requireOwnedChannel(tenantId: string, channelId: string): Promise<void> {
  const [channel] = await getDb().select({ id: channels.id }).from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId))).limit(1);
  if (!channel) throw new AppError(ERR.NOT_FOUND('کانال'));
}

function view(row: typeof channelSavedButtons.$inferSelect) {
  return {
    id: row.id,
    channelId: row.channelId,
    label: row.label,
    target: { type: row.targetType as PostButtonTarget['type'], value: row.targetValue },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSavedButtons(tenantId: string, channelId: string) {
  await requireOwnedChannel(tenantId, channelId);
  const rows = await getDb().select().from(channelSavedButtons)
    .where(and(eq(channelSavedButtons.tenantId, tenantId), eq(channelSavedButtons.channelId, channelId)))
    .orderBy(asc(channelSavedButtons.label), asc(channelSavedButtons.createdAt));
  return rows.map(view);
}

export async function saveChannelButton(tenantId: string, channelId: string, input: SavedButtonInput) {
  await requireOwnedChannel(tenantId, channelId);
  const label = input.label.trim();
  if (!label || label.length > 64) throw new AppError(ERR.VALIDATION('عنوان دکمه باید بین ۱ تا ۶۴ نویسه باشد.'));
  const target = normalizeSavedTarget(input.target);
  const db = getDb();
  const [existing] = await db.select().from(channelSavedButtons).where(and(
    eq(channelSavedButtons.tenantId, tenantId),
    eq(channelSavedButtons.channelId, channelId),
    eq(channelSavedButtons.label, label),
  )).limit(1);

  if (existing) {
    await db.update(channelSavedButtons).set({
      targetType: target.type,
      targetValue: target.value,
      updatedAt: new Date(),
    }).where(and(eq(channelSavedButtons.id, existing.id), eq(channelSavedButtons.tenantId, tenantId), eq(channelSavedButtons.channelId, channelId)));
    await audit({ action: 'channel.button_library.updated', actorId: tenantId, subjectType: 'channel_saved_button', subjectId: existing.id, meta: { channelId, label } });
    const [updated] = await db.select().from(channelSavedButtons).where(and(eq(channelSavedButtons.id, existing.id), eq(channelSavedButtons.tenantId, tenantId))).limit(1);
    if (!updated) throw new AppError(ERR.INTERNAL());
    return view(updated);
  }

  const id = newId();
  await db.insert(channelSavedButtons).values({
    id,
    tenantId,
    channelId,
    label,
    targetType: target.type,
    targetValue: target.value,
  });
  await audit({ action: 'channel.button_library.created', actorId: tenantId, subjectType: 'channel_saved_button', subjectId: id, meta: { channelId, label } });
  const [created] = await db.select().from(channelSavedButtons).where(and(eq(channelSavedButtons.id, id), eq(channelSavedButtons.tenantId, tenantId))).limit(1);
  if (!created) throw new AppError(ERR.INTERNAL());
  return view(created);
}

export async function deleteChannelButton(tenantId: string, channelId: string, buttonId: string) {
  await requireOwnedChannel(tenantId, channelId);
  const db = getDb();
  const [button] = await db.select({ id: channelSavedButtons.id, label: channelSavedButtons.label }).from(channelSavedButtons).where(and(
    eq(channelSavedButtons.id, buttonId),
    eq(channelSavedButtons.tenantId, tenantId),
    eq(channelSavedButtons.channelId, channelId),
  )).limit(1);
  if (!button) throw new AppError(ERR.NOT_FOUND('دکمهٔ ذخیره‌شده'));
  await db.delete(channelSavedButtons).where(and(
    eq(channelSavedButtons.id, buttonId),
    eq(channelSavedButtons.tenantId, tenantId),
    eq(channelSavedButtons.channelId, channelId),
  ));
  await audit({ action: 'channel.button_library.deleted', actorId: tenantId, subjectType: 'channel_saved_button', subjectId: buttonId, meta: { channelId, label: button.label } });
  return { id: buttonId, deleted: true };
}
