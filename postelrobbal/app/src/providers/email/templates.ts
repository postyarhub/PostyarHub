export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailTemplateInput {
  subject: string;
  preheader: string;
  title: string;
  greeting?: string;
  paragraphs: string[];
  details?: EmailDetail[];
  buttonLabel?: string;
  buttonPath?: string;
  footerNote?: string;
}

export interface EmailNotificationPayload extends EmailTemplateInput {
  kind: 'EMAIL_NOTIFICATION';
  to: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmailNotificationPayload(value: unknown): value is EmailNotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'EMAIL_NOTIFICATION' || typeof v.to !== 'string' || !EMAIL_RE.test(v.to)) return false;
  if (typeof v.subject !== 'string' || !v.subject || v.subject.length > 190) return false;
  if (typeof v.preheader !== 'string' || typeof v.title !== 'string' || !Array.isArray(v.paragraphs)) return false;
  if (!v.paragraphs.every((p) => typeof p === 'string' && p.length <= 2000)) return false;
  if (v.greeting !== undefined && typeof v.greeting !== 'string') return false;
  if (v.footerNote !== undefined && typeof v.footerNote !== 'string') return false;
  if (v.buttonLabel !== undefined && typeof v.buttonLabel !== 'string') return false;
  if (v.buttonPath !== undefined && typeof v.buttonPath !== 'string') return false;
  if (v.details !== undefined) {
    if (!Array.isArray(v.details) || !v.details.every((d) =>
      Boolean(d) && typeof d === 'object' &&
      typeof (d as Record<string, unknown>).label === 'string' &&
      typeof (d as Record<string, unknown>).value === 'string'
    )) return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAppUrl(appUrl: string): URL {
  const base = new URL(appUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('EMAIL_APP_URL_MUST_USE_HTTPS');
  }
  return base;
}

function resolveButtonUrl(path: string | undefined, appUrl: string): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path)) {
    throw new Error('EMAIL_BUTTON_PATH_MUST_BE_RELATIVE');
  }
  const base = safeAppUrl(appUrl);
  const result = new URL(path, base);
  if (result.origin !== base.origin || result.username || result.password) {
    throw new Error('EMAIL_BUTTON_PATH_ORIGIN_MISMATCH');
  }
  return result.toString();
}

export function renderEmailTemplate(input: EmailTemplateInput, appUrl: string): { html: string; text: string } {
  const base = safeAppUrl(appUrl);
  const buttonUrl = resolveButtonUrl(input.buttonPath, appUrl);
  const subject = input.subject.trim().replace(/[\r\n]+/g, ' ').slice(0, 190);
  if (!subject) throw new Error('EMAIL_SUBJECT_REQUIRED');
  if (input.paragraphs.length > 12 || (input.details?.length ?? 0) > 12) {
    throw new Error('EMAIL_TEMPLATE_CONTENT_LIMIT_EXCEEDED');
  }

  const paragraphs = input.paragraphs.map((p) =>
    '<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.95;">' + escapeHtml(p) + '</p>'
  ).join('');
  const details = (input.details ?? []).map((item) =>
    '<tr><td style="padding:10px 12px;border-bottom:1px solid #e8edf5;color:#64748b;font-size:13px;text-align:right;">' +
    escapeHtml(item.label) +
    '</td><td style="padding:10px 12px;border-bottom:1px solid #e8edf5;color:#172033;font-size:13px;font-weight:600;text-align:left;direction:auto;">' +
    escapeHtml(item.value) + '</td></tr>'
  ).join('');
  const detailBlock = details
    ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0;background:#f8fafc;border:1px solid #e8edf5;border-radius:12px;">' + details + '</table>'
    : '';
  const button = buttonUrl && input.buttonLabel
    ? '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px;"><tr><td bgcolor="#3949ab" style="border-radius:10px;"><a href="' +
      escapeHtml(buttonUrl) +
      '" style="display:inline-block;padding:13px 23px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">' +
      escapeHtml(input.buttonLabel) + '</a></td></tr></table>'
    : '';
  const greeting = input.greeting
    ? '<p style="margin:0 0 16px;color:#172033;font-size:15px;font-weight:700;">' + escapeHtml(input.greeting) + '</p>'
    : '';
  const footerNote = input.footerNote
    ? '<p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.9;">' + escapeHtml(input.footerNote) + '</p>'
    : '';
  const preheader = escapeHtml(input.preheader.slice(0, 180));
  const html = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' +
    escapeHtml(subject) +
    '</title></head><body dir="rtl" style="margin:0;padding:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#172033;">' +
    '<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">' + preheader + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 10px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e5eaf3;border-radius:18px;overflow:hidden;">' +
    '<tr><td style="padding:22px 28px;background:#172554;color:#ffffff;text-align:right;">' +
    '<div style="font-size:22px;font-weight:800;letter-spacing:-.3px;">پُست‌یار</div>' +
    '<div style="margin-top:6px;font-size:12px;line-height:1.8;color:#dbeafe;">مدیریت یکپارچهٔ انتشار محتوا</div>' +
    '</td></tr><tr><td style="padding:30px 28px 24px;text-align:right;">' +
    '<div style="font-size:21px;line-height:1.8;font-weight:800;color:#172033;margin:0 0 22px;">' + escapeHtml(input.title) + '</div>' +
    greeting + paragraphs + detailBlock + button + footerNote +
    '</td></tr><tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e8edf5;text-align:center;">' +
    '<div style="font-size:12px;color:#64748b;line-height:1.9;">این پیام به‌صورت خودکار از طرف پُست‌یار ارسال شده است.</div>' +
    '<div style="margin-top:4px;font-size:11px;color:#94a3b8;"><a href="' + escapeHtml(base.origin) + '" style="color:#64748b;text-decoration:none;">postyarhub.ir</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';

  const textLines = [input.title, '', ...(input.greeting ? [input.greeting, ''] : []), ...input.paragraphs, ''];
  if (input.details?.length) {
    for (const item of input.details) textLines.push(item.label + ': ' + item.value);
    textLines.push('');
  }
  if (buttonUrl && input.buttonLabel) textLines.push(input.buttonLabel + ': ' + buttonUrl, '');
  if (input.footerNote) textLines.push(input.footerNote, '');
  textLines.push('پُست‌یار — مدیریت یکپارچهٔ انتشار محتوا', base.origin);
  return { html, text: textLines.join('\n') };
}
