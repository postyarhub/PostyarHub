import { httpJson } from '../../core/http.js';
import { AppError, ERR } from '../../core/errors.js';
import type { CreatePaymentInput, CreatedPayment, PaymentGatewayAdapter, VerifiedPayment } from './zarinpal.js';

/**
 * Zibal payment gateway adapter (admin-panel v2 gateway settings).
 *
 * Zibal amounts are in RIAL — matches the platform's amountRial convention, so
 * values pass through unchanged (same as ZarinpalAdapter). Zibal uses a single
 * gateway host for both modes: the sandbox is selected by the merchant value,
 * whose well-known public test merchant is the literal string 'zibal'.
 * Real verification is server-to-server (§117).
 */
const BASE = 'https://gateway.zibal.ir/v1';
const START_PAY = 'https://gateway.zibal.ir/start';

interface ZibalRequestResponse {
  tracked?: number;
  trackId?: number;
  message?: string;
}

interface ZibalVerifyResponse {
  result?: number;
  message?: string;
  refNumber?: number | string;
  amount?: number;
}

export class ZibalAdapter implements PaymentGatewayAdapter {
  readonly id = 'zibal';
  constructor(private readonly merchantId: string, private readonly sandbox = false) {}

  /** Sandbox with no configured merchant degrades to the public test merchant. */
  private merchant(): string {
    if ((!this.merchantId || this.merchantId.trim() === '') && this.sandbox) return 'zibal';
    return this.merchantId.trim();
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const merchant = this.merchant();
    if (!merchant) {
      throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    }
    const { data } = await httpJson<ZibalRequestResponse>(`${BASE}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        merchant,
        amount: input.amountRial, // Zibal amounts are in Rial
        callbackUrl: input.callbackUrl,
        description: input.description,
        ...(input.mobile ? { mobile: input.mobile } : {}),
      }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    // tracked === 100 means the request was accepted; anything else is a
    // gateway-side rejection (invalid merchant, blocked account, ...).
    if (data?.tracked !== 100 || !data.trackId) {
      throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
    }
    return {
      authority: String(data.trackId),
      redirectUrl: `${START_PAY}/${data.trackId}`,
    };
  }

  async verifyPayment(amountRial: number, authority: string): Promise<VerifiedPayment> {
    void amountRial; // zibal verify echoes the amount; the trackId is authoritative
    const merchant = this.merchant();
    if (!merchant) {
      throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    }
    const { data } = await httpJson<ZibalVerifyResponse>(`${BASE}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ merchant, trackId: Number(authority) }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    const code = data?.result ?? -99;
    // 100 = verified; 201 = already verified (idempotent re-verify)
    if (code === 100 || code === 201) {
      return { ok: true, refId: String(data?.refNumber ?? ''), code };
    }
    return { ok: false, code };
  }
}
