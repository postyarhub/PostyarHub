import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { listTelegramStickerSets, listTelegramStickers, importTelegramStickerSet, fetchTelegramStickerFile, listBuiltinStickerCatalog } from './sticker.service.js';

export async function registerStickerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stickers/catalog', { preHandler: [app.requireAuth] }, async () => {
    return { success: true, data: { packs: listBuiltinStickerCatalog() } };
  });

  app.get('/stickers/telegram/sets', { preHandler: [app.requireAuth] }, async (req) => {
    const user = req.user; if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const sets = await listTelegramStickerSets(user.id);
    return { success: true, data: { sets } };
  });

  app.get('/stickers/telegram/sets/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const user = req.user; if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const { id } = req.params as { id: string };
    return { success: true, data: await listTelegramStickers(user.id, id) };
  });

  app.get('/stickers/telegram/:id/file', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const user = req.user; if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const { id } = req.params as { id: string };
    const file = await fetchTelegramStickerFile(user.id, id);
    reply.header('Content-Type', file.contentType).header('Cache-Control', 'private, max-age=86400').header('Content-Disposition', `inline; filename=\"${file.fileName.replace(/\"/g, '')}\"`);
    return reply.send(file.buffer);
  });

  app.post('/stickers/telegram/import', { preHandler: [app.requireAuth] }, async (req) => {
    const user = req.user; if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const input = parseWith(z.object({ botId: z.string().min(10).max(26), setName: z.string().min(2).max(255) }).strict(), req.body);
    const result = await importTelegramStickerSet(user.id, input.botId, input.setName);
    return { success: true, data: result };
  });
}
