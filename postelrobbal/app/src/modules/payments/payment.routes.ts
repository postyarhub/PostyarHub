import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { loadEnv } from '../../config/env.js';
import { createWalletTopup, handleCallback } from './payment.service.js';
import { listPayments, createSubscriptionIntent, attachReceipt } from './payment.service.js';
import { parseWith } from '../../core/validation.js';
import { uploadMedia } from '../media/media.service.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const topupSchema = z.object({
  amountRial: z.coerce.number().int().min(100_000).max(2_000_000_000),
  method: z.enum(['online', 'card_to_card']).optional(),
});

const intentSchema = z.object({
  kind: z.literal('subscription'),
  planId: z.string().min(1).max(64),
  method: z.enum(['online', 'card_to_card', 'wallet']),
  months: z.coerce.number().int().min(1).max(12).optional(),
});

const RECEIPT_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const ulidish = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerPaymentRoutes(app: FastifyInstance): Promise<void> {
  // Authenticated payment methods used by the dashboard checkout.
  app.get('/payments/methods', { preHandler: [app.requireAuth] }, async () => {
    const { getPaymentSettings } = await import('./payment-settings.service.js');
    const settings = await getPaymentSettings();
    return {
      success: true,
      data: {
        onlineEnabled: settings.onlineEnabled,
        provider: settings.provider,
        cardToCardEnabled: settings.cardToCardEnabled,
        cards: settings.cards.map((c) => ({ id: c.id, bankName: c.bankName, cardNumber: c.cardNumber, holderName: c.holderName })),
      },
    };
  });

  app.post('/payments/wallet-topup', { preHandler: [app.requireAuth], config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.user?.id ?? req.ip } } }, async (req) => {
    const input = parse(topupSchema, req.body);
    const result = await createWalletTopup(auth(req).id, input.amountRial, input.method);
    return { success: true, data: result };
  });

  // Unified purchase intent (contract 14-contract item 3):
  //   online       → {paymentId, redirectUrl} (existing Zarinpal path)
  //   card_to_card → {paymentId, reference, cards}  (admin-reviewed receipt)
  app.post('/payments/intent', { preHandler: [app.requireAuth], config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.user?.id ?? req.ip } } }, async (req) => {
    const input = parse(intentSchema, req.body);
    const result = await createSubscriptionIntent(auth(req).id, input);
    return { success: true, data: result };
  });

  // Card-to-card receipt upload (multipart "file" ≤5MB, JPG/PNG/WebP/PDF,
  // magic-byte verified, private storage). Payment must belong to the caller.
  app.post('/payments/:id/receipt', { preHandler: [app.requireAuth], config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: (req) => req.user?.id ?? req.ip } } }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    if (!ulidish.test(id)) throw new AppError(ERR.VALIDATION('شناسه معتبر نیست.'));
    if (!req.isMultipart()) {
      throw new AppError(ERR.PAYMENT_RECEIPT_INVALID('ارسال رسید باید به‌صورت multipart با فیلد «file» انجام شود.'));
    }

    let filePart: { buffer: Buffer; mime: string } | null = null;
    let note: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (filePart) continue; // multipart limit is files:1 — defensive
        const mime = part.mimetype.toLowerCase();
        if (!RECEIPT_MIME_ALLOWED.has(mime)) {
          throw new AppError(ERR.PAYMENT_RECEIPT_INVALID('فرمت فایل مجاز نیست. تصویر (JPG، PNG، WebP) یا PDF ارسال کنید.'));
        }
        let buffer: Buffer;
        try {
          buffer = await part.toBuffer();
        } catch {
          throw new AppError(ERR.PAYMENT_RECEIPT_INVALID('حجم فایل بیش از حد مجاز است.'));
        }
        if (buffer.length > RECEIPT_MAX_BYTES) {
          throw new AppError(ERR.PAYMENT_RECEIPT_INVALID('حجم فایل باید حداکثر ۵ مگابایت باشد.'));
        }
        filePart = { buffer, mime };
      } else if (part.fieldname === 'note' && typeof part.value === 'string') {
        note = part.value;
      }
    }
    if (!filePart) throw new AppError(ERR.PAYMENT_RECEIPT_INVALID('فایلی ارسال نشده است.'));

    // uploadMedia re-validates size + declared-vs-actual magic bytes.
    const media = await uploadMedia(me.id, {
      buffer: filePart.buffer,
      mimeType: filePart.mime,
      maxBytes: RECEIPT_MAX_BYTES,
    });
    const result = await attachReceipt(me.id, id, { mediaId: media.id, note });
    return { success: true, data: result };
  });

  // Payment history (no authority/gateway refs exposed)
  app.get('/payments', { preHandler: [app.requireAuth] }, async (req) => {
    const q = (req.query ?? {}) as { page?: string; pageSize?: string };
    const page = Number.parseInt(q.page ?? '1', 10) || 1;
    const pageSize = Number.parseInt(q.pageSize ?? '20', 10) || 20;
    const data = await listPayments(auth(req).id, page, pageSize);
    return { success: true, data };
  });

  /**
   * Gateway return (PUBLIC, CSRF-exempt — buildApp skips /api/v1/payments/callback).
   * Never returns JSON to a browser: always 302 back to the dashboard.
   */
  const gatewayCallback = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const env = loadEnv();
    const query = (req.query ?? {}) as Record<string, unknown>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const value = (key: string): string | undefined => {
      const raw = body[key] ?? query[key];
      if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : undefined;
      return typeof raw === 'string' ? raw : undefined;
    };
    const paymentId = value('paymentId') ?? value('InvoiceID') ?? '';
    if (!paymentId) {
      return reply.redirect(`${env.APP_URL}/payment/result?payment=failed`);
    }
    const result = await handleCallback({
      paymentId,
      Authority: value('Authority'),
      Status: value('Status') ?? value('PaymentStatus'),
      trackId: value('trackId'),
      id: value('id'),
      status: value('status'),
    });
    const flag = result.ok ? 'ok' : 'failed';
    return reply.redirect(`${env.APP_URL}/dashboard/wallet?payment=${flag}`);
  };

  app.get('/payments/callback', gatewayCallback);
  app.post('/payments/callback', gatewayCallback);
}
