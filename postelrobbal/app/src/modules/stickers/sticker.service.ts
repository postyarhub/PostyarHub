import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bots, telegramStickerSets, telegramStickers } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { httpBuffer } from '../../core/http.js';
import { getOwnedBot } from '../bots/bot.service.js';
import { decryptSecret } from '../../security/encryption.js';
import { getProvider } from '../../providers/index.js';
import type { TelegramAdapter } from '../../providers/telegram/telegram.js';

type ImportedSticker = { file_id: string; file_unique_id: string; type: string; width?: number; height?: number; is_animated?: boolean; is_video?: boolean; thumbnail?: { file_id: string }; emoji?: string; custom_emoji_id?: string };


export const BUILTIN_STICKER_CATALOG = [
  { slug: 'chalughadamodionline_by_tgemodzibot', title: 'Chalughadamodionline', source: 'stickers.wiki', url: 'https://stickers.wiki/telegram-emojis/chalughadamodionline_by_tgemodzibot/', importable: true },
  { slug: 'changex_3', title: 'Change X 3', source: 'stickers.wiki', url: 'https://stickers.wiki/telegram-emojis/changex_3/', importable: true },
  { slug: 'cryptobundle', title: 'Crypto Bundle', source: 'stickers.wiki', url: 'https://stickers.wiki/telegram-emojis/cryptobundle/', importable: true },
  { slug: 'crazy_emoji_nakroshil_petrushki_by_e4zybot', title: 'Crazy Emoji', source: 'stickers.wiki', url: 'https://stickers.wiki/telegram-emojis/crazy_emoji_nakroshil_petrushki_by_e4zybot/', importable: true },
  { slug: 'rhymestg', title: 'Rhymes TG', source: 'stickers.wiki', url: 'https://stickers.wiki/telegram-emojis/rhymestg/', importable: true },
  { slug: '__source_emojipedia__', title: 'مخزن مرجع ایموجی Telegram', source: 'Emojipedia', url: 'https://emojipedia.org/telegram', importable: false },
  { slug: '__source_tgbot_collection__', title: 'ابزار دانلود مجموعه‌های Telegram', source: 'GitHub', url: 'https://github.com/tgbot-collection/stickers', importable: false },
  { slug: '__source_chpic__', title: 'کتابخانه CHPIC', source: 'CHPIC', url: 'https://chpic.su/', importable: false },
  { slug: '__source_stickers_wiki__', title: 'کاتالوگ کامل Stickers.wiki', source: 'Stickers.wiki', url: 'https://stickers.wiki/', importable: false },
] as const;

export function listBuiltinStickerCatalog() {
  return BUILTIN_STICKER_CATALOG;
}
export async function listTelegramStickerSets(tenantId: string) {
  const db = getDb();
  const sets = await db.select().from(telegramStickerSets).where(eq(telegramStickerSets.tenantId, tenantId)).orderBy(desc(telegramStickerSets.updatedAt));
  return Promise.all(sets.map(async (set) => {
    const [preview] = await db.select({ id: telegramStickers.id, emoji: telegramStickers.emoji })
      .from(telegramStickers)
      .where(and(eq(telegramStickers.tenantId, tenantId), eq(telegramStickers.setId, set.id)))
      .orderBy(asc(telegramStickers.positionIndex))
      .limit(1);
    return { ...set, previewStickerId: preview?.id ?? null, previewEmoji: preview?.emoji ?? null };
  }));
}

export async function listTelegramStickers(tenantId: string, setId: string) {
  const db = getDb();
  const [set] = await db.select().from(telegramStickerSets).where(and(eq(telegramStickerSets.id, setId), eq(telegramStickerSets.tenantId, tenantId))).limit(1);
  if (!set) throw new AppError(ERR.NOT_FOUND('مجموعه استیکر'));
  const stickers = await db.select().from(telegramStickers).where(and(eq(telegramStickers.tenantId, tenantId), eq(telegramStickers.setId, set.id))).orderBy(asc(telegramStickers.positionIndex));
  return { set, stickers };
}

export async function importTelegramStickerSet(tenantId: string, botId: string, name: string) {
  const bot = await getOwnedBot(tenantId, botId);
  if (bot.platform !== 'telegram') throw new AppError(ERR.VALIDATION('برای دریافت استیکر، باید ربات تلگرام را انتخاب کنید.'));
  if (bot.status !== 'ACTIVE') throw new AppError(ERR.VALIDATION('ربات تلگرام فعال نیست.'));
  const stickerName = name.trim().replace(/^https?:\/\/t\.me\/(?:addstickers|addemoji)\//i, '').replace(/^@/, '').split(/[?#/]/)[0];
  if (!stickerName || !/^[A-Za-z0-9_\-]{2,255}$/.test(stickerName)) throw new AppError(ERR.VALIDATION('نام مجموعه استیکر تلگرام معتبر نیست.'));
  const provider = getProvider('telegram') as TelegramAdapter;
  const set = await provider.getStickerSet(decryptSecret(bot.tokenEncrypted), stickerName);
  if (!set?.stickers?.length) throw new AppError(ERR.VALIDATION('این مجموعه استیکر خالی است یا پیدا نشد.'));
  const db = getDb();
  const existing = await db.select({ id: telegramStickerSets.id }).from(telegramStickerSets).where(and(eq(telegramStickerSets.tenantId, tenantId), eq(telegramStickerSets.telegramName, set.name))).limit(1);
  const setId = existing[0]?.id ?? newId();
  await db.insert(telegramStickerSets).values({ id: setId, tenantId, botId, telegramName: set.name, title: set.title, stickerType: set.sticker_type }).onDuplicateKeyUpdate({ set: { botId, title: set.title, stickerType: set.sticker_type } });
  for (let i = 0; i < set.stickers.length; i++) {
    const sticker = set.stickers[i] as ImportedSticker;
    await db.insert(telegramStickers).values({ id: newId(), tenantId, setId, fileId: sticker.file_id, fileUniqueId: sticker.file_unique_id, stickerType: sticker.type, emoji: sticker.emoji ?? null, width: sticker.width ?? null, height: sticker.height ?? null, isAnimated: sticker.is_animated ? 1 : 0, isVideo: sticker.is_video ? 1 : 0, thumbnailFileId: sticker.thumbnail?.file_id ?? null, customEmojiId: sticker.custom_emoji_id ?? null, positionIndex: i }).onDuplicateKeyUpdate({ set: { fileId: sticker.file_id, stickerType: sticker.type, emoji: sticker.emoji ?? null, width: sticker.width ?? null, height: sticker.height ?? null, isAnimated: sticker.is_animated ? 1 : 0, isVideo: sticker.is_video ? 1 : 0, thumbnailFileId: sticker.thumbnail?.file_id ?? null, customEmojiId: sticker.custom_emoji_id ?? null, positionIndex: i } });
  }
  return listTelegramStickers(tenantId, setId);
}


export async function fetchTelegramStickerFile(tenantId: string, stickerId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const db = getDb();
  const [sticker] = await db.select().from(telegramStickers).where(and(eq(telegramStickers.id, stickerId), eq(telegramStickers.tenantId, tenantId))).limit(1);
  if (!sticker) throw new AppError(ERR.NOT_FOUND('استیکر'));
  const [set] = await db.select().from(telegramStickerSets).where(and(eq(telegramStickerSets.id, sticker.setId), eq(telegramStickerSets.tenantId, tenantId))).limit(1);
  const botQuery = set?.botId
    ? db.select().from(bots).where(and(eq(bots.id, set.botId), eq(bots.tenantId, tenantId), eq(bots.platform, 'telegram'))).limit(1)
    : db.select().from(bots).where(and(eq(bots.tenantId, tenantId), eq(bots.platform, 'telegram'), eq(bots.status, 'ACTIVE'))).orderBy(desc(bots.updatedAt)).limit(1);
  const [bot] = await botQuery;
  if (!bot) throw new AppError(ERR.NOT_FOUND('ربات تلگرام مرتبط با این مجموعه'));
  const provider = getProvider('telegram') as TelegramAdapter;
  const token = decryptSecret(bot.tokenEncrypted);
  let file = await provider.getFile(token, sticker.fileId);
  if (!file.file_path) throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  let targetType: 'main' | 'thumbnail' = 'main';
  const mainPath = String(file.file_path).toLowerCase();
  if ((sticker.isAnimated || mainPath.endsWith('.tgs')) && sticker.thumbnailFileId) {
    const thumbnail = await provider.getFile(token, sticker.thumbnailFileId);
    if (thumbnail.file_path) { file = thumbnail; targetType = 'thumbnail'; }
  }
  const filePath = file.file_path;
  if (!filePath) throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  const fetched = await httpBuffer(`https://api.telegram.org/file/bot${token}/${filePath}`, { timeoutMs: 15_000 });
  if (fetched.status < 200 || fetched.status >= 300) throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  const buffer = fetched.body;
  const headerType = fetched.contentType?.split(';')[0]?.trim();
  const pathLower = filePath.toLowerCase();
  const contentType = targetType === 'thumbnail' ? (headerType?.startsWith('image/') ? headerType : 'image/webp') : (
    headerType || (pathLower.endsWith('.webm') || sticker.isVideo ? 'video/webm' : pathLower.endsWith('.tgs') || sticker.isAnimated ? 'application/x-tgsticker' : 'image/webp')
  );
  return { buffer, contentType, fileName: filePath.split('/').pop() || `${sticker.id}.${targetType === 'thumbnail' ? 'webp' : 'webm'}` };
}
