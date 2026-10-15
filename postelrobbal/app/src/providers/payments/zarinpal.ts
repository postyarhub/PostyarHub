import { httpJson } from '../../core/http.js';
import { AppError, ERR } from '../../core/errors.js';

/**
 * Payment gateway abstraction — reference adapter: ZarinPal (§34).
 * Business controllers never contain gateway-specific logic; they call
 * PaymentGatewayAdapter. Real verification is server-to-server (§117) —
 * browser-reported success is never trusted.
 */
export interface CreatePaymentInput {
  amountRial: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
}

export interface CreatedPayment {
  authority: string;
  redirectUrl: string;
}

export interface VerifiedPayment {
  ok: boolean;
  refId?: string;
  code: number;
}

export interface PaymentGatewayAdapter {
  readonly id: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  verifyPayment(amountRial: number, authority: string): Promise<VerifiedPayment>;
}

const SANDBOX_BASE = 'https://sandbox.zarinpal.com/pg/v4/payment';
const BASE = 'https://payment.zarinpal.com/pg/v4/payment';
const START_PAY = (authority: string, sandbox: boolean) =>
  sandbox
    ? `https://sandbox.zarinpal.com/pg/StartPay/${authority}`
    : `https://payment.zarinpal.com/pg/StartPay/${authority}`;

interface ZpData { authority?: string; ref_id?: number; code?: number }
interface ZpResponse { data?: ZpData; errors?: { code?: number; message?: string } | unknown }

export class ZarinpalAdapter implements PaymentGatewayAdapter {
  readonly id = 'zarinpal';
  constructor(private readonly merchantId: string, private readonly sandbox = false) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    // Item-13 root-cause fix: an unconfigured merchant used to surface as a
    // generic 500 INTERNAL_ERROR. Degrade gracefully with a stable, actionable
    // Persian code so the frontend can fall back to card-to-card.
    if (!this.merchantId || this.merchantId.trim() === '') {
      throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    }
    const { data } = await httpJson<ZpResponse>(`${this.sandbox ? SANDBOX_BASE : BASE}/request.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: input.amountRial, // ZarinPal amounts are in Rial
        currency: 'IRR',
        description: input.description,
        callback_url: input.callbackUrl,
        ...(input.mobile ? { metadata: { mobile: input.mobile } } : {}),
      }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    const authority = data?.data?.authority;
    if (!authority) throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
    return { authority, redirectUrl: START_PAY(authority, this.sandbox) };
  }

  async verifyPayment(amountRial: number, authority: string): Promise<VerifiedPayment> {
    const { data } = await httpJson<ZpResponse>(`${this.sandbox ? SANDBOX_BASE : BASE}/verify.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ merchant_id: this.merchantId, amount: amountRial, authority }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    const code = data?.data?.code ?? -99;
    if (code === 100 || code === 101) {
      return { ok: true, refId: String(data?.data?.ref_id ?? ''), code };
    }
    return { ok: false, code };
  }
}
