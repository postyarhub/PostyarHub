import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { deleteChannelButton, listSavedButtons, saveChannelButton } from './button-library.service.js';
import { deleteSavedFooter, listSavedFooters, saveChannelFooter } from './footer-library.service.js';
import {
  listChannels, connectChannel, verifyChannel, disconnectChannel, updateChannel, ActorMeta,
  startRubikaChannelDiscovery, getRubikaChannelDiscovery,
} from './channel.service.js';

const PLATFORMS: readonly Platform[] = ['telegram', 'bale', 'rubika'];

function parsePlatform(value: unknown): Platform {
  if (typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform;
  }
  throw new AppError(ERR.VALIDATION('پلتفرم باید یکی از موارد telegram، bale یا rubika باشد.'));
}

function actor(req: FastifyRequest): ActorMeta & { tenantId: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { tenantId: req.user.id, actorId: req.user.id, actorRole: req.user.role, ip: req.ip };
}

const connectSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  channelRef: z.string().min(2).max(190),
  title: z.string().min(1).max(190),
  botId: z.string().min(10).max(26).optional(),
});

const updateSchema = z.object({ title: z.string().min(1).max(190), botId: z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/).nullable().optional() }).strict();

const channelIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/);
const savedButtonTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), value: z.string().trim().min(1).max(255) }).strict(),
  z.object({ type: z.literal('PHONE'), value: z.string().trim().min(1).max(32) }).strict(),
  z.object({ type: z.literal('TELEGRAM_ID'), value: z.string().trim().min(1).max(190) }).strict(),
  z.object({ type: z.literal('BALE_ID'), value: z.string().trim().min(1).max(190) }).strict(),
  z.object({ type: z.literal('RUBIKA_ID'), value: z.string().trim().min(1).max(190) }).strict(),
]);
const saveButtonSchema = z.object({
  label: z.string().trim().min(1).max(64),
  target: savedButtonTargetSchema,
}).strict();
const saveFooterSchema = z.object({
  text: z.string().trim().min(1).max(500),
}).strict();

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/channels', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const channels = await listChannels(tenantId);
    return { success: true, data: { channels } };
  });

  app.post('/channels', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const input = parse(connectSchema, req.body);
    const channel = await connectChannel(tenantId, input, meta);
    return { success: true, data: { channel } };
  });

  app.post('/channels/rubika/discovery', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const input = parse(z.object({ botId: z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/), publicRef: z.string().max(190).optional(), title: z.string().max(190).optional() }).strict(), req.body);
    const discovery = await startRubikaChannelDiscovery(tenantId, input);
    return { success: true, data: { discovery } };
  });

  app.get('/channels/rubika/discovery/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const id = parse(z.string().min(12).max(64), (req.params as Record<string, unknown>).id);
    const discovery = await getRubikaChannelDiscovery(tenantId, id);
    return { success: true, data: { discovery } };
  });

  // Static path before /channels/:id-style routes — capabilities for the UI.
  app.get('/channels/capabilities', { preHandler: [app.requireAuth] }, async (req) => {
    const query = (req.query ?? {}) as { platform?: unknown };
    const platform = parsePlatform(query.platform);
    return { success: true, data: { platform, capabilities: getProvider(platform).capabilities() } };
  });

  app.get('/channels/:id/saved-buttons', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const id = parse(channelIdSchema, (req.params as Record<string, unknown>).id);
    const buttons = await listSavedButtons(tenantId, id);
    return { success: true, data: { buttons } };
  });

  app.post('/channels/:id/saved-buttons', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const id = parse(channelIdSchema, (req.params as Record<string, unknown>).id);
    const input = parse(saveButtonSchema, req.body);
    const button = await saveChannelButton(tenantId, id, input);
    return { success: true, data: { button } };
  });

  app.delete('/channels/:id/saved-buttons/:buttonId', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const params = req.params as Record<string, unknown>;
    const channelId = parse(channelIdSchema, params.id);
    const buttonId = parse(channelIdSchema, params.buttonId);
    const result = await deleteChannelButton(tenantId, channelId, buttonId);
    return { success: true, data: result };
  });

  app.get('/channels/:id/saved-footers', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const id = parse(channelIdSchema, (req.params as Record<string, unknown>).id);
    const footers = await listSavedFooters(tenantId, id);
    return { success: true, data: { footers } };
  });

  app.post('/channels/:id/saved-footers', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const id = parse(channelIdSchema, (req.params as Record<string, unknown>).id);
    const input = parse(saveFooterSchema, req.body);
    const footer = await saveChannelFooter(tenantId, id, input);
    return { success: true, data: { footer } };
  });

  app.delete('/channels/:id/saved-footers/:footerId', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const params = req.params as Record<string, unknown>;
    const channelId = parse(channelIdSchema, params.id);
    const footerId = parse(channelIdSchema, params.footerId);
    const result = await deleteSavedFooter(tenantId, channelId, footerId);
    return { success: true, data: result };
  });

  app.post('/channels/:id/verify', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const channel = await verifyChannel(tenantId, id, meta);
    return { success: true, data: { channel } };
  });

  const update = async (req: FastifyRequest) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(updateSchema, req.body);
    const channel = await updateChannel(tenantId, id, input, meta);
    return { success: true, data: { channel } };
  };
  app.patch('/channels/:id', { preHandler: [app.requireAuth] }, update);
  app.post('/channels/:id', { preHandler: [app.requireAuth] }, update);

  app.delete('/channels/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const channel = await disconnectChannel(tenantId, id, meta);
    return { success: true, data: { channel } };
  });
}
