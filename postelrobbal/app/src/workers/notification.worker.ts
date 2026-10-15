import { Job } from 'bullmq';
import { createWorker } from '../queue/connection.js';
import { createLogger } from '../core/logger.js';
import { loadEnv } from '../config/env.js';
import { notifyTenant, deliverChannelNotification } from '../modules/notifications/delivery.js';
import { sendEmail } from '../providers/email/email.js';

/**
 * Notifications worker (§27): in-app rows are already written synchronously;
 * this worker performs the outbound channel deliveries (expiry warnings) and
 * password-reset emails — honestly: when SMTP is not configured, no fake
 * success is reported and the user gets a generic in-app notice instead.
 * Reset tokens are NEVER logged (§62, §179).
 */

const log = createLogger('notification-worker');

interface ExpiryWarningJob {
  outboundKind: string;
  subjectId: string;
  destination: string;
  platform: 'telegram' | 'bale' | 'rubika';
  channelId: string;
  channelRef: string;
  tenantId: string;
  title: string;
  body: string;
}

interface PasswordResetJob {
  kind: 'PASSWORD_RESET';
  tenantId: string;
  email: string;
  mobile: string;
  token: string;
}

function isExpiryWarningJob(data: unknown): data is ExpiryWarningJob {
  const d = data as ExpiryWarningJob;
  return (
    typeof d?.outboundKind === 'string' &&
    typeof d?.subjectId === 'string' &&
    typeof d?.destination === 'string' &&
    (d?.platform === 'telegram' || d?.platform === 'bale' || d?.platform === 'rubika') &&
    typeof d?.channelId === 'string' &&
    typeof d?.channelRef === 'string' &&
    typeof d?.tenantId === 'string' &&
    typeof d?.title === 'string' &&
    typeof d?.body === 'string'
  );
}

function isPasswordResetJob(data: unknown): data is PasswordResetJob {
  const d = data as PasswordResetJob;
  return d?.kind === 'PASSWORD_RESET' && typeof d?.tenantId === 'string' && typeof d?.email === 'string' && typeof d?.token === 'string';
}

async function handleExpiryWarning(job: Job): Promise<void> {
  if (!isExpiryWarningJob(job.data)) {
    log.warn({ jobId: job.id }, 'expiry_warning_job_malformed');
    throw new Error('MALFORMED_EXPIRY_WARNING_JOB');
  }
  await deliverChannelNotification(job.data);
}

async function handlePasswordReset(job: Job): Promise<void> {
  if (!isPasswordResetJob(job.data)) {
    log.warn({ jobId: job.id }, 'password_reset_job_malformed');
    throw new Error('MALFORMED_PASSWORD_RESET_JOB');
  }
  const env = loadEnv();
  const { tenantId, email, token } = job.data;

  if (!env.MAIL_HOST) {
    // Honest v1 (OPERATIONS.md): no SMTP configured → no email, no fake success.
    // The reset link is NOT logged; the user gets a generic in-app notice.
    log.warn({ event: 'password_reset_email_skipped_no_smtp', tenantId }, 'password_reset_email_skipped_no_smtp');
    await notifyTenant({
      tenantId,
      kind: 'PASSWORD_RESET',
      titleFa: 'بازیابی رمز عبور',
      bodyFa: 'درخواست بازیابی رمز عبور شما ثبت شد؛ اما سرویس‌دهندهٔ ایمیل فعال نیست. لطفاً با پشتیبانی تماس بگیرید.',
    }).catch(() => undefined);
    return;
  }

  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
  const result = await sendEmail({
    to: email,
    subject: 'بازیابی رمز عبور پُست‌یار',
    text: `سلام,\n\nبرای بازیابی رمز عبور خود در پُست‌یار، روی لینک زیر کلیک کنید (اعتبار: ۳۰ دقیقه):\n${resetUrl}\n\nاگر این درخواست را شما انجام نداده‌اید، این پیام را نادیده بگیرید.`,
  });

  if (!result.ok) {
    log.warn({ event: 'password_reset_email_failed', reason: result.reason ?? 'UNKNOWN', tenantId }, 'password_reset_email_failed');
    await notifyTenant({
      tenantId,
      kind: 'PASSWORD_RESET',
      titleFa: 'بازیابی رمز عبور',
      bodyFa: 'ارسال راهنمای بازیابی رمز عبور ناموفق بود. لطفاً پس از چند دقیقه دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.',
    }).catch(() => undefined);
  }
}

export function startNotificationWorker() {
  // createWorker's processor parameter resolves to `never` due to a broken
  // conditional type in queue/connection.ts — bridge it without losing typing.
  const processor = async (job: Job): Promise<void> => {
    try {
      if (job.name === 'expiry-warning') {
        await handleExpiryWarning(job);
      } else if (job.name === 'password-reset') {
        await handlePasswordReset(job);
      } else {
        log.error({ jobName: job.name, jobId: job.id }, 'unknown_notification_job');
        throw new Error(`UNKNOWN_NOTIFICATION_JOB: ${job.name}`);
      }
    } catch (err) {
      log.error({ err, jobName: job.name, jobId: job.id }, 'notification_job_failed');
      throw err; // BullMQ retry policy applies
    }
  };
  return createWorker('notifications', processor as unknown as never, { concurrency: 2 });
}
