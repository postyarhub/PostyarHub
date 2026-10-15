import { httpJson } from '../../core/http.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { CreatePaymentInput, CreatedPayment, PaymentGatewayAdapter, VerifiedPayment } from './zarinpal.js';

/**
 * IDPay payment gateway adapter (admin-panel v2 gateway settings).
 *
 * Amounts are in RIAL — matches the platform's amountRial convention, so values
 * pass through unchanged (same as ZarinpalAdapter). Sandbox mode is selected
 * with the X-SANDBOX header and still requires a panel-issued API key.
 * Real verification is server-to-server (§117).
 */
const BASE = 'https://api.idpay.ir/v1.1';

interface IdpayCreateResponse {
  id?: string;
  link?: string;
  error_message?: string;
  error_code?: number;
}

interface IdpayVerifyResponse {
  status?: number;
  track_id?: number | string;
  id?: string;
  order_id?: string;
  amount?: string | number;
  error_message?: string;
  error_code?: number;
}

export class IdpayAdapter implements PaymentGatewayAdapter {
  readonly id = 'idpay';
  constructor(private readonly apiKey: string, private readonly sandbox = false) {}

  private credential(): string {
    return this.apiKey.trim();
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const apiKey = this.credential();
    if (!apiKey) {
      throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    }
    const { data } = await httpJson<IdpayCreateResponse>(`${BASE}/payment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-API-KEY': apiKey,
        'X-SANDBOX': this.sandbox ? 'true' : 'false',
      },
      body: JSON.stringify({
        order_id: newId(),
        amount: input.amountRial, // IDPay amounts are in Rial
        callback: input.callbackUrl,
        ...(input.description ? { desc: input.description.slice(0, 255) } : {}),
      }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    if (!data?.id || !data.link) {
      throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
    }
    return { authority: data.id, redirectUrl: data.link };
  }

  async verifyPayment(amountRial: number, authority: string): Promise<VerifiedPayment> {
    void amountRial; // IDPay verify echoes the amount; the id/track_id are authoritative
    const apiKey = this.credential();
    if (!apiKey) {
      throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    }
    const { data } = await httpJson<IdpayVerifyResponse>(`${BASE}/payment/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-API-KEY': apiKey,
        'X-SANDBOX': this.sandbox ? 'true' : 'false',
      },
      body: JSON.stringify({ id: authority }),
      timeoutMs: 20_000,
    }).catch(() => {
      throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    });
    const code = data?.status ?? -99;
    // 100 = verified; 101 = already verified (idempotent re-verify)
    if (code === 100 || code === 101) {
      return { ok: true, refId: String(data?.track_id ?? ''), code };
    }
    return { ok: false, code };
  }
}
