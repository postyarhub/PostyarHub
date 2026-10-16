import { appendFile, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { httpRaw } from '../../core/http.js';
import { AppError, ERR } from '../../core/errors.js';
import type { CreatePaymentInput, CreatedPayment, PaymentGatewayAdapter, VerifiedPayment } from './zarinpal.js';

/**
 * WinaPay gateway adapter.
 *
 * Amounts are integer Toman at the provider boundary. Postyar stores all money
 * as Rial, so values must be divisible by 10 and are converted exactly.
 */
const BASE = 'https://winapay.io/webservice/rest';
const START = 'https://winapay.io/startPay';
const DIAGNOSTIC_DIRECTORY = path.resolve(__dirname, '../../../../logs');
const DIAGNOSTIC_FILE = `${DIAGNOSTIC_DIRECTORY}/winapay-provider-diagnostics.jsonl`;

interface WinaResponse {
  Status?: number | string;
  Authority?: string;
  PaymentUrl?: string;
  RefID?: string | number;
  Message?: string;
}

interface WinaHttpResult {
  data: WinaResponse;
  httpStatus: number;
  contentType: string;
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/(merchantid|merchant_id|authority|invoiceid|paymenturl|callbackurl|api[_-]?key|token|secret|password)(\s*["']?\s*[:=]\s*["']?)[^&\s"'<>]+/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[OPAQUE_ID]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
}

function classifyNonJsonBody(body: string): string {
  const sample = body.slice(0, 5000).toLowerCase();
  if (!sample.trim()) return 'empty';
  if (sample.includes('cloudflare') || sample.includes('cf-ray')) return 'cloudflare_edge';
  if (/access denied|\bforbidden\b|request blocked/.test(sample)) return 'access_denied';
  if (/bad gateway|gateway timeout|upstream connect error/.test(sample)) return 'upstream_gateway_error';
  if (/<html\b|<!doctype html/.test(sample)) return 'html';
  return 'non_json_text';
}

function htmlTitle(body: string): string | undefined {
  const match = body.slice(0, 5000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  return redactDiagnosticText(match[1].replace(/<[^>]+>/g, ' '));
}

async function writeWinaPayDiagnostic(record: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(DIAGNOSTIC_DIRECTORY, { recursive: true, mode: 0o700 });
    await appendFile(
      DIAGNOSTIC_FILE,
      `${JSON.stringify({ timestamp: new Date().toISOString(), provider: 'winapay', ...record })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await chmod(DIAGNOSTIC_FILE, 0o600);
  } catch {
    // Diagnostic logging must never break the payment request path.
  }
}

async function requestWinaPay(operation: string, url: string, body: string): Promise<WinaHttpResult> {
  let response;
  try {
    response = await httpRaw(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      timeoutMs: 20_000,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = (err as NodeJS.ErrnoException).code;
    await writeWinaPayDiagnostic({
      event: 'transport_failure',
      operation,
      errorName: err.name.slice(0, 80),
      ...(typeof code === 'string' ? { errorCode: code.slice(0, 80) } : {}),
      errorMessage: redactDiagnosticText(err.message),
    });
    throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    await writeWinaPayDiagnostic({
      event: 'non_json_response',
      operation,
      httpStatus: response.status,
      contentType: response.contentType.slice(0, 100),
      responseBytes: Buffer.byteLength(response.body, 'utf8'),
      responseKind: classifyNonJsonBody(response.body),
      ...(htmlTitle(response.body) ? { htmlTitle: htmlTitle(response.body) } : {}),
    });
    throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    await writeWinaPayDiagnostic({
      event: 'invalid_json_shape',
      operation,
      httpStatus: response.status,
      contentType: response.contentType.slice(0, 100),
      responseBytes: Buffer.byteLength(response.body, 'utf8'),
    });
    throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  }

  const data = parsed as WinaResponse;
  if (response.status < 200 || response.status >= 300) {
    const rawStatus = data.Status === undefined ? null : Number(data.Status);
    await writeWinaPayDiagnostic({
      event: 'http_non_success_json',
      operation,
      httpStatus: response.status,
      contentType: response.contentType.slice(0, 100),
      providerStatus: rawStatus !== null && Number.isFinite(rawStatus) ? rawStatus : null,
      providerMessagePresent: typeof data.Message === 'string' && data.Message.length > 0,
    });
  }

  return { data, httpStatus: response.status, contentType: response.contentType };
}

function toToman(amountRial: number): number {
  if (!Number.isSafeInteger(amountRial) || amountRial <= 0 || amountRial % 10 !== 0) {
    throw new AppError(ERR.VALIDATION('مبلغ این پرداخت برای ویناپی باید مضربی از ۱۰ ریال باشد.'));
  }
  const toman = amountRial / 10;
  if (toman < 100) throw new AppError(ERR.VALIDATION('حداقل مبلغ پرداخت ویناپی ۱۰۰ تومان است.'));
  return toman;
}

export class WinaPayAdapter implements PaymentGatewayAdapter {
  readonly id = 'winapay';

  constructor(private readonly merchantId: string) {}

  private merchant(): string {
    const value = this.merchantId.trim();
    if (!value) throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
    return value;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const merchantId = this.merchant();
    const amount = toToman(input.amountRial);
    const invoiceId = (() => {
      try {
        return new URL(input.callbackUrl).searchParams.get('paymentId')?.trim() || undefined;
      } catch {
        return undefined;
      }
    })();
    const params = new URLSearchParams({
      MerchantID: merchantId,
      Amount: String(amount),
      ...(invoiceId ? { InvoiceID: invoiceId } : {}),
      Description: input.description.slice(0, 255),
      CallbackURL: input.callbackUrl,
    });
    const { data, httpStatus, contentType } = await requestWinaPay('PaymentRequest', `${BASE}/PaymentRequest`, params.toString());
    const status = data?.Status === undefined ? undefined : Number(data.Status);
    const authority = typeof data?.Authority === 'string' ? data.Authority.trim() : '';
    if (status !== 100 || authority.length !== 32) {
      await writeWinaPayDiagnostic({
        event: 'payment_request_rejected',
        httpStatus,
        contentType: contentType.slice(0, 100),
        providerStatus: status !== undefined && Number.isFinite(status) ? status : null,
        authorityLength: authority.length,
        paymentUrlPresent: typeof data?.PaymentUrl === 'string' && data.PaymentUrl.trim() !== '',
        providerMessagePresent: typeof data?.Message === 'string' && data.Message.length > 0,
      });
      throw new AppError(ERR.PAYMENT_CREATE_FAILED(Number.isFinite(status) ? status : undefined));
    }
    // Never redirect a customer to an arbitrary URL returned in a provider
    // response. Only accept HTTPS URLs on WinaPay's exact trusted hostname;
    // otherwise construct the documented redirect locally from the authority.
    const fallbackUrl = `${START}/${authority}`;
    let paymentUrl = fallbackUrl;
    if (typeof data?.PaymentUrl === 'string' && data.PaymentUrl.trim() !== '') {
      try {
        const candidate = new URL(data.PaymentUrl.trim());
        if (candidate.protocol === 'https:' && candidate.hostname.toLowerCase() === 'winapay.io' &&
            !candidate.username && !candidate.password) {
          paymentUrl = candidate.toString();
        }
      } catch {
        // Keep the trusted local fallback when the provider URL is malformed.
      }
    }
    return { authority, redirectUrl: paymentUrl };
  }

  async verifyPayment(amountRial: number, authority: string): Promise<VerifiedPayment> {
    const merchantId = this.merchant();
    const amount = toToman(amountRial);
    const normalizedAuthority = authority.trim();
    if (normalizedAuthority.length !== 32) {
      throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
    }
    const params = new URLSearchParams({ MerchantID: merchantId, Authority: normalizedAuthority, Amount: String(amount) });
    const { data, httpStatus, contentType } = await requestWinaPay('PaymentVerification', `${BASE}/PaymentVerification`, params.toString());
    const status = data.Status === undefined ? -99 : Number(data.Status);
    const refId = data.RefID !== undefined ? String(data.RefID).trim() : '';
    if (status === 100) return { ok: true, ...(refId ? { refId } : {}), code: 100 };
    await writeWinaPayDiagnostic({
      event: 'payment_verification_rejected',
      httpStatus,
      contentType: contentType.slice(0, 100),
      providerStatus: Number.isFinite(status) ? status : -99,
      providerMessagePresent: typeof data.Message === 'string' && data.Message.length > 0,
    });
    return { ok: false, code: Number.isFinite(status) ? status : -99 };
  }
}

