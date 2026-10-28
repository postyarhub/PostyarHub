/**
 * Typed API client. Session = HttpOnly cookie (never localStorage, §40).
 * CSRF token (not auth material) held in memory/sessionStorage.
 */
export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  constructor(code: string, message: string, status: number, requestId?: string | null) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.requestId = requestId ?? undefined;
  }
}

let csrfToken: string | null = sessionStorage.getItem('py_csrf');

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? null;
  if (token) sessionStorage.setItem('py_csrf', token);
  else sessionStorage.removeItem('py_csrf');
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = csrfToken;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.formData
        ? options.formData
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch {
    throw new ApiRequestError(
      'NETWORK_ERROR',
      'ارتباط با سرور برقرار نشد. اتصال را بررسی کرده و دوباره تلاش کنید.',
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(
      err?.code ?? (res.status === 401 ? 'AUTH_REQUIRED' : res.status === 403 ? 'FORBIDDEN' : res.status === 404 ? 'NOT_FOUND' : res.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR'),
      err?.code === 'INTERNAL_ERROR' ? 'این عملیات در سرور کامل نشد؛ دوباره از همین بخش تلاش کنید و در صورت تکرار شناسه پیگیری را به پشتیبانی بدهید.' : (err?.message ?? (res.status === 401 ? 'نشست شما منقضی شده است؛ دوباره وارد شوید.' : res.status === 403 ? 'دسترسی به این بخش مجاز نیست.' : res.status === 404 ? 'منبع موردنظر یافت نشد.' : res.status === 429 ? 'تعداد درخواست‌ها زیاد است؛ چند لحظه بعد دوباره تلاش کنید.' : 'عملیات در سرور کامل نشد؛ دوباره تلاش کنید.')),
      res.status,
      err?.requestId
    );
  }
  // A same-origin proxy or an expired runtime can return a successful HTTP
  // status with an empty/non-JSON body. Do not let a null dereference in the
  // caller collapse into the generic analytics error.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiRequestError(
      'INVALID_API_RESPONSE',
      'پاسخ سرور قابل‌خواندن نیست. ممکن است سرویس موقتاً در دسترس نباشد؛ دوباره تلاش کنید.',
      502,
    );
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
    const err = (payload as { error?: ApiError }).error;
    throw new ApiRequestError(
      'INVALID_API_RESPONSE',
      err?.message ?? 'قالب پاسخ سرور با قرارداد API سازگار نیست. در صورت تکرار، این خطا را به پشتیبانی گزارش کنید.',
      502,
      err?.requestId,
    );
  }

  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  /** Multipart upload (support attachments, payment receipts). The browser
   *  sets the multipart boundary header; never set content-type manually. */
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Shared types mirroring the API contract (§84). */
export interface MeResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    businessName: string;
    role: string;
    timezone?: string;
    /* Task 17-b avatar fields (avatarKind 'character' | 'photo'). */
    avatarKind?: 'character' | 'photo';
    avatarValue?: string;
    avatarMediaId?: string | null;
  };
  subscription: { id: string; state: string; expiresAt: string; planName: string; planCode: string } | null;
  csrfToken: string;
}

/** Same-origin URL of a user's photo avatar (cookies ride along). */
export function avatarPhotoUrl(userId: string, avatarMediaId?: string | null): string | undefined {
  const bust = avatarMediaId ? `?v=${encodeURIComponent(avatarMediaId)}` : '';
  return `/api/v1/users/${userId}/avatar${bust}`;
}

export interface PlanPricing {
  renewalDiscountPercent: number;
  durationDiscounts: Record<string, number>;
}

export interface PlanDto {
  id: string;
  code: string;
  nameFa: string;
  priceRial: number;
  periodDays: number;
  limitsJson: { max_channels: number; max_posts: number; max_bots: number; max_schedules: number; ai_monthly: number; storage_mb: number };
  featuresJson: { gold_ticker: boolean; auto_responder: boolean; woocommerce: boolean; wordpress_campaigns?: boolean; content_summarization?: boolean };
  pricingJson?: PlanPricing;
}

export interface ChannelDto {
  id: string;
  platform: 'telegram' | 'bale' | 'rubika';
  channelRef: string;
  title: string;
  status: 'PENDING_VERIFY' | 'ACTIVE' | 'DISABLED' | 'ERROR';
  createdAt: string;
}

export interface BotDto {
  id: string;
  platform: 'telegram' | 'bale' | 'rubika';
  username: string | null;
  title: string;
  status: string;
  mode: 'WEBHOOK' | 'POLLING';
  tokenMasked: string;
  aiEnabled: boolean;
  aiSystemPrompt?: string | null;
  lastEventAt?: string | null;
  healthJson?: Record<string, unknown> | null;
  createdAt: string;
}

export interface BotButtonDto {
  label: string;
  url?: string;
  callback?: string;
}

export interface BotActivityDto {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND' | string;
  platform: string;
  text: string | null;
  actionType: string | null;
  status: string;
  senderRef: string | null;
  createdAt: string;
}

export interface BotStatsDto {
  eventsByKind: Array<{ kind: string; count: number }>;
  messagesSent30d: number;
  messagesReceived30d: number;
  commandsMatched30d: number;
  workflowsRun30d: number;
  userCount: number;
  recentActivity: BotActivityDto[];
}

export interface BotUserDto {
  id: string;
  platformUserId: string;
  username: string | null;
  displayName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface BotConversationDto {
  id: string;
  platform: 'telegram' | 'bale' | 'rubika' | string;
  chatRef: string;
  platformUserId: string;
  username: string | null;
  displayName: string | null;
  lastActivityAt: string;
}

export interface BotMessageDto {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND' | string;
  platformMessageId: string | null;
  senderRef: string | null;
  text: string | null;
  actionType: string | null;
  actionRef: string | null;
  status: 'RECEIVED' | 'SENT' | 'FAILED' | string;
  createdAt: string;
}

export interface PostDto {
  id: string;
  title: string | null;
  body: string;
  state: string;
  source: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  targetSummary?: Array<{ state: string; count: number }>;
  channelSummary?: Array<{ platform: string; count: number; sentCount: number; failedCount: number }>;
  channelDetails?: Array<{ channelId: string; title: string; platform: string; state: string }>;
  latestSentAt?: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NotificationDto {
  id: string;
  kind: string;
  titleFa: string;
  bodyFa: string;
  readAt: string | null;
  createdAt: string;
}
