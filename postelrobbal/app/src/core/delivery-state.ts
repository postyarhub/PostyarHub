/** Delivery state machine (§22) + Persian labels (§43-44). */
export type DeliveryState =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'RETRYING'
  | 'FAILED'
  | 'CANCELLED';

export const DELIVERY_LABELS_FA: Record<DeliveryState, string> = {
  PENDING: 'در انتظار ارسال',
  PROCESSING: 'در حال پردازش',
  SENT: 'ارسال شد',
  RETRYING: 'در حال تلاش مجدد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

export const POST_STATE_LABELS_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  SCHEDULED: 'زمان‌بندی‌شده',
  QUEUED: 'در صف انتشار',
  PUBLISHING: 'در حال انتشار',
  PUBLISHED: 'منتشر شد',
  PARTIAL: 'منتشر شد (برخی مقصدها ناموفق)',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

const ALLOWED: Record<DeliveryState, DeliveryState[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SENT', 'RETRYING', 'FAILED', 'CANCELLED'],
  RETRYING: ['PROCESSING', 'CANCELLED'],
  SENT: [],
  FAILED: ['PENDING'], // explicit user retry
  CANCELLED: [],
};

export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: DeliveryState, to: DeliveryState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal delivery transition ${from} -> ${to}`);
  }
}

/** Retry classification (§86): bounded, classified, idempotent. */
export const RETRY_POLICY = {
  maxAttempts: 5,
  backoffSeconds: [30, 120, 600, 1800],
};

export function nextRetryDelaySeconds(attempts: number): number | null {
  if (attempts >= RETRY_POLICY.maxAttempts) return null;
  return RETRY_POLICY.backoffSeconds[Math.min(attempts - 1, RETRY_POLICY.backoffSeconds.length - 1)] ?? 1800;
}
