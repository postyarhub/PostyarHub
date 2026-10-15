/**
 * Error contract (§57-58, §114).
 * Stable machine codes + safe Persian messages + classification.
 * Nothing internal (stack/SQL/paths/tokens) ever reaches the client.
 */
export type ErrorClass =
  | 'Transient'
  | 'Permanent'
  | 'Validation'
  | 'Authentication'
  | 'Authorization'
  | 'RateLimited'
  | 'Provider'
  | 'Network'
  | 'Internal';

export interface AppErrorShape {
  code: string;
  message: string; // safe Persian message
  httpStatus: number;
  class: ErrorClass;
  retryable: boolean;
  meta?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly errorClass: ErrorClass;
  readonly retryable: boolean;
  readonly meta?: Record<string, unknown>;

  constructor(shape: AppErrorShape) {
    super(`${shape.code}: ${shape.message}`);
    this.name = 'AppError';
    this.code = shape.code;
    this.userMessage = shape.message;
    this.httpStatus = shape.httpStatus;
    this.errorClass = shape.class;
    this.retryable = shape.retryable;
    this.meta = shape.meta;
  }
}

const E = (
  code: string,
  message: string,
  httpStatus: number,
  errorClass: ErrorClass,
  retryable = false
): AppErrorShape => ({ code, message, httpStatus, class: errorClass, retryable });

// ---- generic ----
export const ERR = {
  INTERNAL: () => E('INTERNAL_ERROR', 'خطای غیرمنتظره در سرور رخ داد. لطفاً بعداً تلاش کنید.', 500, 'Internal'),
  VALIDATION: (msg?: string) =>
    E('VALIDATION_ERROR', msg ?? 'اطلاعات ارسالی معتبر نیست.', 422, 'Validation'),
  NOT_FOUND: (what = 'مورد') => E('NOT_FOUND', `${what} مورد نظر یافت نشد.`, 404, 'Permanent'),
  CONFLICT: (msg: string) => E('CONFLICT', msg, 409, 'Permanent'),
  RATE_LIMITED: () =>
    E('RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.', 429, 'RateLimited', true),

  // auth
  AUTH_REQUIRED: () => E('AUTH_REQUIRED', 'برای انجام این کار باید وارد حساب خود شوید.', 401, 'Authentication'),
  AUTH_INVALID: () => E('AUTH_INVALID', 'ایمیل یا رمز عبور نادرست است.', 401, 'Authentication'),
  AUTH_SUSPENDED: () => E('AUTH_SUSPENDED', 'حساب شما غیرفعال شده است. با پشتیبانی تماس بگیرید.', 403, 'Authorization'),
  FORBIDDEN: () => E('FORBIDDEN', 'شما اجازهٔ انجام این کار را ندارید.', 403, 'Authorization'),
  CSRF_INVALID: () => E('CSRF_INVALID', 'درخواست امن نیست. صفحه را تازه‌سازی کنید.', 403, 'Authentication'),
  SESSION_EXPIRED: () => E('SESSION_EXPIRED', 'نشست شما منقضی شده است. دوباره وارد شوید.', 401, 'Authentication'),
  WEAK_PASSWORD: () => E('WEAK_PASSWORD', 'رمز عبور باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد.', 422, 'Validation'),
  DUPLICATE: (what: string) => E('DUPLICATE', `${what} قبلاً ثبت شده است.`, 409, 'Permanent'),

  // providers / delivery
  PROVIDER_UNAUTHORIZED: () =>
    E('PROVIDER_UNAUTHORIZED', 'اعتبارنامهٔ کانال یا ربات نامعتبر است. آن را بررسی کنید.', 502, 'Provider'),
  PROVIDER_NOT_SUPPORTED: () =>
    E('PROVIDER_NOT_SUPPORTED', 'این عملیات توسط این پلتفرم پشتیبانی نمی‌شود.', 400, 'Permanent'),
  PROVIDER_RATE_LIMITED: () =>
    E('PROVIDER_RATE_LIMITED', 'محدودیت ارسال پلتفرم؛ تلاش مجدد به‌صورت خودکار انجام می‌شود.', 429, 'RateLimited', true),
  PROVIDER_UNAVAILABLE: () =>
    E('PROVIDER_UNAVAILABLE', 'پلتفرم مقصد موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', 502, 'Transient', true),
  CHANNEL_LIMIT: () =>
    E('CHANNEL_LIMIT', 'ظرفیت کانال‌ها در پلن فعلی شما تکمیل شده است.', 403, 'Authorization'),
  QUOTA_EXCEEDED: (what: string) =>
    E('QUOTA_EXCEEDED', `سهمیهٔ ${what} در پلن فعلی شما به پایان رسیده است.`, 403, 'Authorization'),
  PLAN_FEATURE_REQUIRED: (what: string) =>
    E('PLAN_FEATURE_REQUIRED', `برای دسترسی به قابلیت «${what}» باید اشتراک خود را ارتقا دهید.`, 403, 'Authorization'),

  // financial
  PAYMENT_CREATE_FAILED: (code?: number) =>
    E(
      'PAYMENT_CREATE_FAILED',
      code === undefined ? 'ایجاد تراکنش پرداخت ناموفق بود. دوباره تلاش کنید.' : `ایجاد تراکنش پرداخت توسط درگاه رد شد. کد پاسخ: ${code}`,
      502,
      'Provider',
      true,
    ),
  PAYMENT_VERIFY_FAILED: () =>
    E('PAYMENT_VERIFY_FAILED', 'تأیید پرداخت ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگردانده می‌شود.', 400, 'Permanent'),
  WALLET_INSUFFICIENT: () =>
    E('WALLET_INSUFFICIENT', 'موجودی کیف پول کافی نیست.', 400, 'Validation'),

  // payment methods (0003 review flow)
  PAYMENT_METHOD_DISABLED: () =>
    E('PAYMENT_METHOD_DISABLED', 'این روش پرداخت در حال حاضر غیرفعال است. لطفاً روش پرداخت دیگری را انتخاب کنید.', 403, 'Permanent'),
  GATEWAY_NOT_CONFIGURED: () =>
    E('GATEWAY_NOT_CONFIGURED', 'درگاه پرداخت آنلاین هنوز پیکربندی نشده است. لطفاً از روش پرداخت کارت به کارت استفاده کنید یا بعداً تلاش کنید.', 400, 'Permanent'),
  PAYMENT_RECEIPT_INVALID: (msg?: string) =>
    E('PAYMENT_RECEIPT_INVALID', msg ?? 'رسید بارگذاری‌شده معتبر نیست. تصویر (JPG، PNG، WebP) یا PDF با حداکثر حجم ۵ مگابایت ارسال کنید.', 422, 'Validation'),
} as const;

export function toPublicError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError(ERR.INTERNAL());
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.retryable;
  return false;
}
