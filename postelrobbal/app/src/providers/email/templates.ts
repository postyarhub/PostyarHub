export interface EmailDetail {
  label: string;
  value: string;
}

export const EMAIL_TEMPLATE_KEYS = [
  'registration',
  'admin_alert',
  'payment_success',
  'payment_failed',
  'subscription',
  'ticket_created',
  'ticket_reply',
  'password_reset',
  'test_email',
  'generic',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplateOverride {
  subject?: string;
  preheader?: string;
  title?: string;
  greeting?: string;
  paragraphs?: string;
  buttonLabel?: string;
  footerNote?: string;
}

export type EmailTemplateSettings = Partial<Record<EmailTemplateKey, EmailTemplateOverride>>;

export interface EmailTemplateInput {
  templateKey?: EmailTemplateKey;
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
const TEMPLATE_KEY_SET = new Set<string>(EMAIL_TEMPLATE_KEYS);

export function isEmailNotificationPayload(value: unknown): value is EmailNotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'EMAIL_NOTIFICATION' || typeof v.to !== 'string' || !EMAIL_RE.test(v.to)) return false;
  if (v.templateKey !== undefined && (typeof v.templateKey !== 'string' || !TEMPLATE_KEY_SET.has(v.templateKey))) return false;
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

function tokenValues(input: EmailTemplateInput): Record<string, string> {
  const values: Record<string, string> = {
    subject: input.subject,
    preheader: input.preheader,
    title: input.title,
    greeting: input.greeting ?? '',
    paragraphs: input.paragraphs.join('\n\n'),
    buttonLabel: input.buttonLabel ?? '',
    footerNote: input.footerNote ?? '',
  };
  for (const detail of input.details ?? []) {
    values['detail:' + detail.label] = detail.value;
  }
  return values;
}

function resolveTemplateText(value: string, input: EmailTemplateInput): string {
  const values = tokenValues(input);
  return value.replace(/\{\{([^{}]+)\}\}/g, (match, rawToken: string) => {
    const token = rawToken.trim();
    return Object.prototype.hasOwnProperty.call(values, token) ? values[token] : match;
  });
}

function applyTemplateOverrides(input: EmailTemplateInput, override?: EmailTemplateOverride): EmailTemplateInput {
  if (!override) return input;
  const resolved: EmailTemplateInput = { ...input };
  const content = (value: string | undefined): string | undefined =>
    typeof value === 'string' && value.trim() ? resolveTemplateText(value, input) : undefined;

  const subject = content(override.subject);
  const preheader = content(override.preheader);
  const title = content(override.title);
  const greeting = content(override.greeting);
  const paragraphs = content(override.paragraphs);
  const buttonLabel = content(override.buttonLabel);
  const footerNote = content(override.footerNote);

  if (subject) resolved.subject = subject.trim().replace(/[\r\n]+/g, ' ').slice(0, 190);
  if (preheader) resolved.preheader = preheader.slice(0, 180);
  if (title) resolved.title = title.slice(0, 160);
  if (greeting) resolved.greeting = greeting.slice(0, 180);
  if (paragraphs) {
    const lines = paragraphs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) resolved.paragraphs = lines.slice(0, 12).map((line) => line.slice(0, 2000));
  }
  if (buttonLabel) resolved.buttonLabel = buttonLabel.slice(0, 100);
  if (footerNote) resolved.footerNote = footerNote.slice(0, 300);
  return resolved;
}

export function renderEmailTemplate(
  input: EmailTemplateInput,
  appUrl: string,
  templateSettings: EmailTemplateSettings = {},
): { subject: string; html: string; text: string } {
  const base = safeAppUrl(appUrl);
  const effective = applyTemplateOverrides(input, templateSettings[input.templateKey ?? 'generic']);
  const buttonUrl = resolveButtonUrl(effective.buttonPath, appUrl);
  const subject = effective.subject.trim().replace(/[\r\n]+/g, ' ').slice(0, 190);
  if (!subject) throw new Error('EMAIL_SUBJECT_REQUIRED');
  if (effective.paragraphs.length > 12 || (effective.details?.length ?? 0) > 12) {
    throw new Error('EMAIL_TEMPLATE_CONTENT_LIMIT_EXCEEDED');
  }

  const font = "font-family:'Vazirmatn',Tahoma,Arial,sans-serif;";
  const paragraphs = effective.paragraphs.map((p) =>
    '<p style="margin:0 0 14px;color:#344054;font-size:15px;line-height:2;' + font + 'white-space:normal;overflow-wrap:anywhere;">' + escapeHtml(p) + '</p>'
  ).join('');
  const details = (effective.details ?? []).map((item) =>
    '<tr><td style="padding:12px 14px;border-bottom:1px solid #edf0f7;color:#68738b;font-size:13px;text-align:right;' + font + 'width:42%;">' +
    escapeHtml(item.label) +
    '</td><td dir="auto" style="padding:12px 14px;border-bottom:1px solid #edf0f7;color:#1b2444;font-size:13px;font-weight:700;text-align:right;' + font + 'overflow-wrap:anywhere;">' +
    escapeHtml(item.value) + '</td></tr>'
  ).join('');
  const detailBlock = details
    ? '<table class="psy-email-details" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:22px 0;background:#f8f9fd;border:1px solid #e8ebf5;border-radius:12px;overflow:hidden;' + font + '">' + details + '</table>'
    : '';
  const button = buttonUrl && effective.buttonLabel
    ? '<table class="psy-email-btn" role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px;border-collapse:separate;"><tr><td bgcolor="#3949ab" style="border-radius:12px;background:#3949ab;"><a href="' +
      escapeHtml(buttonUrl) +
      '" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;line-height:1.6;border-radius:12px;' + font + '">' +
      escapeHtml(effective.buttonLabel) + '</a></td></tr></table>'
    : '';
  const greeting = effective.greeting
    ? '<p style="margin:0 0 18px;color:#202b4d;font-size:15px;font-weight:700;line-height:1.9;' + font + '">' + escapeHtml(effective.greeting) + '</p>'
    : '';
  const footerNote = effective.footerNote
    ? '<p style="margin:20px 0 0;color:#68738b;font-size:12px;line-height:1.9;' + font + '">' + escapeHtml(effective.footerNote) + '</p>'
    : '';
  const preheader = escapeHtml(effective.preheader.slice(0, 180));
  const logoUrl = base.origin + '/email-assets/postyar-logo-mark.webp';
  const html = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' +
    escapeHtml(subject) +
    '</title><style>' +
    '@font-face{font-family:Vazirmatn;src:url(https://postyarhub.ir/fonts/Vazirmatn-Regular.woff2) format("woff2");font-style:normal;font-weight:400;}' +
    '@font-face{font-family:Vazirmatn;src:url(https://postyarhub.ir/fonts/Vazirmatn-Medium.woff2) format("woff2");font-style:normal;font-weight:500;}' +
    '@font-face{font-family:Vazirmatn;src:url(https://postyarhub.ir/fonts/Vazirmatn-SemiBold.woff2) format("woff2");font-style:normal;font-weight:600;}' +
    '@font-face{font-family:Vazirmatn;src:url(https://postyarhub.ir/fonts/Vazirmatn-Bold.woff2) format("woff2");font-style:normal;font-weight:700;}' +
    '@font-face{font-family:Vazirmatn;src:url(https://postyarhub.ir/fonts/Vazirmatn-Black.woff2) format("woff2");font-style:normal;font-weight:900;}' +
    '@media only screen and (max-width:600px){.psy-email-outer{padding:12px 6px!important}.psy-email-card{border-radius:14px!important}.psy-email-header{padding:18px 18px!important}.psy-email-content{padding:22px 18px!important}.psy-email-title{font-size:20px!important}.psy-email-details td{padding:10px 9px!important;font-size:12px!important}.psy-email-footer{padding:16px 18px!important}.psy-email-btn a{display:block!important;text-align:center!important}}' +
    '</style></head><body dir="rtl" style="margin:0;padding:0;background:#f2f4fa;color:#1b2444;' + font + '">' +
    '<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">' + preheader + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="psy-email-outer" style="width:100%;background:#f2f4fa;padding:30px 12px;border-collapse:collapse;' + font + '"><tr><td align="center">' +
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" class="psy-email-card" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e5e9f3;border-radius:20px;overflow:hidden;' + font + '">' +
    '<tr><td class="psy-email-header" style="padding:22px 30px 20px;background:#ffffff;border-top:5px solid #f28c28;border-bottom:1px solid #edf0f6;text-align:right;' + font + '">' +
    '<table role="presentation" cellspacing="0" cellpadding="0" dir="rtl" style="border-collapse:collapse;' + font + '"><tr><td valign="middle" width="62" style="width:62px;padding-left:12px;">' +
    '<img src="' + escapeHtml(logoUrl) + '" width="52" alt="لوگوی رسمی پُست‌یار" style="display:block;width:52px;max-width:52px;height:auto;border:0;outline:none;text-decoration:none;" />' +
    '</td><td valign="middle" style="text-align:right;' + font + '">' +
    '<div style="font-size:22px;font-weight:900;line-height:1.5;color:#202b61;' + font + '">پُست‌یار</div>' +
    '<div style="margin-top:3px;font-size:12px;line-height:1.8;color:#68738b;' + font + '">مدیریت یکپارچهٔ انتشار محتوا</div>' +
    '</td></tr></table></td></tr>' +
    '<tr><td class="psy-email-content" style="padding:32px 30px 28px;text-align:right;' + font + '">' +
    '<div class="psy-email-title" style="font-size:23px;line-height:1.8;font-weight:900;color:#1b2444;margin:0 0 22px;' + font + 'overflow-wrap:anywhere;">' + escapeHtml(effective.title) + '</div>' +
    greeting + paragraphs + detailBlock + button + footerNote +
    '</td></tr><tr><td class="psy-email-footer" style="padding:19px 28px;background:#f8f9fd;border-top:1px solid #e8ebf4;text-align:center;' + font + '">' +
    '<div style="font-size:12px;color:#68738b;line-height:2;' + font + '">این پیام به‌صورت خودکار از طرف پُست‌یار ارسال شده است.</div>' +
    '<div style="margin-top:4px;font-size:11px;color:#8d96ab;line-height:1.9;' + font + '">' +
    '<a href="' + escapeHtml(base.origin) + '" style="color:#4b57a5;text-decoration:none;' + font + '">postyarhub.ir</a>' +
    ' <span style="color:#b4bbcb;">&nbsp;•&nbsp;</span> ' +
    '<a href="mailto:support@postyarhub.ir" style="color:#4b57a5;text-decoration:none;' + font + '">پشتیبانی</a>' +
    '</div></td></tr></table></td></tr></table></body></html>';

  const textLines = [effective.title, '', ...(effective.greeting ? [effective.greeting, ''] : []), ...effective.paragraphs, ''];
  if (effective.details?.length) {
    for (const item of effective.details) textLines.push(item.label + ': ' + item.value);
    textLines.push('');
  }
  if (buttonUrl && effective.buttonLabel) textLines.push(effective.buttonLabel + ': ' + buttonUrl, '');
  if (effective.footerNote) textLines.push(effective.footerNote, '');
  textLines.push('پُست‌یار — مدیریت یکپارچهٔ انتشار محتوا', base.origin, 'پشتیبانی: support@postyarhub.ir');
  return { subject, html, text: textLines.join('\n') };
}
