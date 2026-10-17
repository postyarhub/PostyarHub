import nodemailer from 'nodemailer';
import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../core/logger.js';
import { getEmailSettings } from '../../modules/admin/system-settings.service.js';

const log = createLogger('email-provider');
const SMTP_TIMEOUT_MS = 20_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  ok: boolean;
  reason?: string;
}

interface RuntimeMailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

type RuntimeConfigResult = { config: RuntimeMailConfig } | { reason: 'DISABLED' | 'NOT_CONFIGURED' };

async function runtimeMailConfig(): Promise<RuntimeConfigResult> {
  const settings = await getEmailSettings();
  if (!settings.enabled) return { reason: 'DISABLED' };
  const env = loadEnv();
  const host = settings.host.trim() || (env.MAIL_HOST ?? '').trim();
  const port = settings.host.trim() ? settings.port : (env.MAIL_PORT ?? settings.port);
  const user = settings.user.trim() || (env.MAIL_USER ?? '').trim();
  const pass = settings.pass || env.MAIL_PASSWORD || '';
  if (!host || !user || !pass) return { reason: 'NOT_CONFIGURED' };

  const secure = port === 465 ? true : port === 587 ? false : settings.secure;
  return {
    config: {
      host,
      port,
      secure,
      user,
      pass,
      fromName: settings.fromName.trim() || 'پُست‌یار',
      fromEmail: settings.fromEmail.trim() || user,
    },
  };
}

export async function isEmailDeliveryConfigured(): Promise<boolean> {
  const result = await runtimeMailConfig();
  return 'config' in result;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!input.to || input.to.length > 190 || !EMAIL_RE.test(input.to) || /[\r\n]/.test(input.to)) {
    return { ok: false, reason: 'INVALID_RECIPIENT' };
  }
  const subject = input.subject.trim().replace(/[\r\n]+/g, ' ').slice(0, 190);
  if (!subject || (!input.text && !input.html) || input.text.length > 200_000 || (input.html?.length ?? 0) > 500_000) {
    return { ok: false, reason: 'INVALID_MESSAGE' };
  }

  let result: RuntimeConfigResult;
  try {
    result = await runtimeMailConfig();
  } catch {
    log.warn({ reason: 'EMAIL_CONFIGURATION_UNAVAILABLE' }, 'email_configuration_unavailable');
    return { ok: false, reason: 'EMAIL_CONFIGURATION_UNAVAILABLE' };
  }
  if (!('config' in result)) return { ok: false, reason: result.reason };
  const config = result.config;

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: 10_000,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  try {
    const info = await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: input.to,
      subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0 || (Array.isArray(info.rejected) && info.rejected.length > 0)) {
      return { ok: false, reason: 'SMTP_RECIPIENT_REJECTED' };
    }
    return { ok: true };
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string'
      ? String((err as { code: string }).code).replace(/[^A-Z0-9_-]/gi, '').slice(0, 40)
      : 'SMTP_ERROR';
    log.warn({ reason: code || 'SMTP_ERROR' }, 'email_send_failed');
    return { ok: false, reason: code || 'SMTP_ERROR' };
  } finally {
    transport.close();
  }
}
