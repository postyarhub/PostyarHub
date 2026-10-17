import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { AI_PROVIDER_IDS, BUILTIN_AI_PROVIDERS } from '../../providers/ai/ai-providers.js';
import { encryptSecret, decryptSecret } from '../../security/encryption.js';
import nodemailer from 'nodemailer';

/**
 * System settings for the admin panel v2 — SMS + SMTP email.
 *
 * Storage contract: one system_settings row per key, value_json holds a NATIVE
 * JSON scalar (boolean / string / number) or object (smsConfigs), mirroring how
 * payment-settings.service stores its documents. Reads merge stored values over
 * defaults; writes validate strictly and upsert per key
 * (onDuplicateKeyUpdate on setting_key).
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function upsertSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(systemSettings)
    .values({ settingKey: key, valueJson: value as Record<string, unknown> })
    .onDuplicateKeyUpdate({ set: { valueJson: value as Record<string, unknown> } });
}

// ---------------------------------------------------------------------------
// SMS settings
// ---------------------------------------------------------------------------

export const SMS_PROVIDERS = ['smsir', 'melipayamak', 'kavenegar', 'ghasedak'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

type SmsProviderConfig = Record<string, string>;

/** Default credential fields per provider; otpTemplateId is capped at 20 chars. */
const SMS_CONFIG_DEFAULTS: Record<SmsProvider, SmsProviderConfig> = {
  smsir: { apiKey: '', line: '', otpTemplateId: '' },
  melipayamak: { username: '', password: '', from: '' },
  kavenegar: { apiKey: '', from: '' },
  ghasedak: { apiKey: '', line: '' },
};

const SMS_FIELD_MAX: Record<string, number> = { otpTemplateId: 20 };
const SMS_DEFAULT_FIELD_MAX = 128;

export interface SmsSettings {
  enabled: boolean;
  provider: SmsProvider;
  configs: Record<SmsProvider, SmsProviderConfig>;
}

export interface SmsSettingsPatch {
  enabled?: boolean;
  provider?: SmsProvider;
  configs?: {
    smsir?: { apiKey?: string; line?: string; otpTemplateId?: string };
    melipayamak?: { username?: string; password?: string; from?: string };
    kavenegar?: { apiKey?: string; from?: string };
    ghasedak?: { apiKey?: string; line?: string };
  };
}

function mergeSmsConfigs(stored: unknown): Record<SmsProvider, SmsProviderConfig> {
  const merged: Record<SmsProvider, SmsProviderConfig> = {
    smsir: { ...SMS_CONFIG_DEFAULTS.smsir },
    melipayamak: { ...SMS_CONFIG_DEFAULTS.melipayamak },
    kavenegar: { ...SMS_CONFIG_DEFAULTS.kavenegar },
    ghasedak: { ...SMS_CONFIG_DEFAULTS.ghasedak },
  };
  if (!isRecord(stored)) return merged;
  for (const provider of SMS_PROVIDERS) {
    const raw = stored[provider];
    if (!isRecord(raw)) continue;
    for (const field of Object.keys(SMS_CONFIG_DEFAULTS[provider])) {
      const v = raw[field];
      if (typeof v === 'string') {
        merged[provider][field] = v.slice(0, SMS_FIELD_MAX[field] ?? SMS_DEFAULT_FIELD_MAX);
      }
    }
  }
  return merged;
}

export async function getSmsSettings(): Promise<SmsSettings> {
  const db = getDb();
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, ['smsEnabled', 'smsProvider', 'smsConfigs']));

  let enabled = true;
  let provider: SmsProvider = 'smsir';
  let storedConfigs: unknown;
  for (const row of rows) {
    if (row.settingKey === 'smsEnabled') {
      if (typeof row.valueJson === 'boolean') enabled = row.valueJson;
    } else if (row.settingKey === 'smsProvider') {
      if (typeof row.valueJson === 'string' && (SMS_PROVIDERS as readonly string[]).includes(row.valueJson)) {
        provider = row.valueJson as SmsProvider;
      }
    } else if (row.settingKey === 'smsConfigs') {
      storedConfigs = row.valueJson;
    }
  }
  return { enabled, provider, configs: mergeSmsConfigs(storedConfigs) };
}

/** Strict string-field validation — numbers never coerce to strings. */
function ensureSmsField(provider: SmsProvider, field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» برای «${provider}» باید متن باشد.`));
  }
  const max = SMS_FIELD_MAX[field] ?? SMS_DEFAULT_FIELD_MAX;
  if (value.trim().length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» بیش از حد مجاز است.`));
  }
  return value.trim();
}

export async function putSmsSettings(patch: SmsSettingsPatch): Promise<string[]> {
  const updated: string[] = [];
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «enabled» باید بولی باشد.'));
    }
    await upsertSetting('smsEnabled', patch.enabled);
    updated.push('smsEnabled');
  }
  if (patch.provider !== undefined) {
    if (!(SMS_PROVIDERS as readonly string[]).includes(patch.provider)) {
      throw new AppError(ERR.VALIDATION('سرویس‌دهنده پیامک معتبر نیست.'));
    }
    await upsertSetting('smsProvider', patch.provider);
    updated.push('smsProvider');
  }
  if (patch.configs !== undefined) {
    const db = getDb();
    const [row] = await db
      .select({ valueJson: systemSettings.valueJson })
      .from(systemSettings)
      .where(eq(systemSettings.settingKey, 'smsConfigs'))
      .limit(1);
    const merged = mergeSmsConfigs(row?.valueJson);
    for (const provider of SMS_PROVIDERS) {
      const providerPatch = patch.configs[provider];
      if (!providerPatch) continue;
      for (const [field, value] of Object.entries(providerPatch)) {
        if (value === undefined) continue;
        if (!(field in SMS_CONFIG_DEFAULTS[provider])) {
          throw new AppError(ERR.VALIDATION(`فیلد «${field}» برای «${provider}» معتبر نیست.`));
        }
        merged[provider][field] = ensureSmsField(provider, field, value);
      }
    }
    await upsertSetting('smsConfigs', merged);
    updated.push('smsConfigs');
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Email (SMTP) settings
// ---------------------------------------------------------------------------

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

const EMAIL_DEFAULTS: EmailSettings = {
  enabled: true,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  fromName: 'پُست‌یار',
  fromEmail: '',
};

const EMAIL_KEYS = [
  'emailEnabled',
  'smtpHost',
  'smtpPort',
  'smtpSecure',
  'smtpUser',
  'smtpPass',
  'fromName',
  'fromEmail',
] as const;

export interface EmailSettingsPatch {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromName?: string;
  fromEmail?: string;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const db = getDb();
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, [...EMAIL_KEYS]));

  const settings: EmailSettings = { ...EMAIL_DEFAULTS };
  for (const row of rows) {
    const v: unknown = row.valueJson; // JSON column: native scalar at runtime
    switch (row.settingKey) {
      case 'emailEnabled':
        if (typeof v === 'boolean') settings.enabled = v;
        break;
      case 'smtpHost':
        if (typeof v === 'string') settings.host = v;
        break;
      case 'smtpPort':
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535) settings.port = v;
        break;
      case 'smtpSecure':
        if (typeof v === 'boolean') settings.secure = v;
        break;
      case 'smtpUser':
        if (typeof v === 'string') settings.user = v;
        break;
      case 'smtpPass':
        if (typeof v === 'string') {
          if (v.startsWith('v1.')) {
            try { settings.pass = decryptSecret(v); } catch { settings.pass = ''; }
          } else {
            // Legacy value remains readable; every newly saved secret is encrypted.
            settings.pass = v;
          }
        }
        break;
      case 'fromName':
        if (typeof v === 'string' && v.trim() !== '') settings.fromName = v;
        break;
      case 'fromEmail':
        if (typeof v === 'string') settings.fromEmail = v;
        break;
    }
  }
  return settings;
}

export async function getPublicEmailSettings(): Promise<Omit<EmailSettings, 'pass'> & { pass: ''; passwordConfigured: boolean }> {
  const settings = await getEmailSettings();
  return { ...settings, pass: '', passwordConfigured: Boolean(settings.pass) };
}

function ensureEmailStr(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید متن باشد.`));
  }
  if (value.trim().length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» بیش از حد مجاز است.`));
  }
  return value.trim();
}

export async function putEmailSettings(patch: EmailSettingsPatch): Promise<string[]> {
  const updated: string[] = [];
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «enabled» باید بولی باشد.'));
    }
    await upsertSetting('emailEnabled', patch.enabled);
    updated.push('emailEnabled');
  }
  if (patch.host !== undefined) {
    await upsertSetting('smtpHost', ensureEmailStr(patch.host, 'host', 190));
    updated.push('smtpHost');
  }
  if (patch.port !== undefined) {
    if (typeof patch.port !== 'number' || !Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
      throw new AppError(ERR.VALIDATION('مقدار «port» باید عددی بین ۱ تا ۶۵۵۳۵ باشد.'));
    }
    await upsertSetting('smtpPort', patch.port);
    updated.push('smtpPort');
  }
  if (patch.secure !== undefined) {
    if (typeof patch.secure !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «secure» باید بولی باشد.'));
    }
    await upsertSetting('smtpSecure', patch.secure);
    updated.push('smtpSecure');
  }
  if (patch.user !== undefined) {
    await upsertSetting('smtpUser', ensureEmailStr(patch.user, 'user', 190));
    updated.push('smtpUser');
  }
  if (patch.pass !== undefined) {
    const password = ensureEmailStr(patch.pass, 'pass', 190);
    // Blank input means "preserve saved password"; non-empty secrets are encrypted.
    if (password) {
      await upsertSetting('smtpPass', encryptSecret(password));
      updated.push('smtpPass');
    }
  }
  if (patch.fromName !== undefined) {
    await upsertSetting('fromName', ensureEmailStr(patch.fromName, 'fromName', 80));
    updated.push('fromName');
  }
  if (patch.fromEmail !== undefined) {
    const email = ensureEmailStr(patch.fromEmail, 'fromEmail', 190);
    if (email !== '' && !email.includes('@')) {
      throw new AppError(ERR.VALIDATION('ایمیل فرستنده معتبر نیست.'));
    }
    await upsertSetting('fromEmail', email);
    updated.push('fromEmail');
  }
  return updated;
}

/**
 * Sends a test email through the SAVED SMTP settings (nodemailer).
 * Never leaks credentials in errors — only the SMTP response line is surfaced.
 */
export async function sendTestEmail(actorId: string, to: string): Promise<{ ok: true; messageId: string }> {
  const settings = await getEmailSettings();
  if (!settings.enabled || !settings.host || !settings.user || !settings.pass) {
    throw new AppError(ERR.VALIDATION('ایمیل را فعال کنید و تنظیمات SMTP، نام کاربری و رمز عبور را کامل و ذخیره کنید.'));
  }
  const secure = settings.port === 465 ? true : settings.port === 587 ? false : settings.secure;
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure,
    requireTLS: !secure,
    auth: { user: settings.user, pass: settings.pass },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({
      from: { name: settings.fromName, address: settings.fromEmail || settings.user },
      to,
      subject: 'ایمیل آزمایشی پُست‌یار',
      text: 'تنظیمات SMTP پُست‌یار با موفقیت آزموده شد. اگر این ایمیل را دریافت کرده‌اید، ارسال ایمیل فعال است.',
      html: '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body dir="rtl" style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;padding:28px 10px;"><table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5eaf3;border-radius:16px;padding:28px;"><tr><td style="color:#172554;font-size:22px;font-weight:800;">پُست‌یار</td></tr><tr><td style="padding-top:20px;color:#172033;font-size:20px;font-weight:700;">ایمیل آزمایشی پُست‌یار</td></tr><tr><td style="padding-top:14px;color:#475569;font-size:15px;line-height:1.9;">تنظیمات SMTP با موفقیت آزموده شد. اگر این پیام را دریافت کرده‌اید، ارسال ایمیل پُست‌یار کار می‌کند.</td></tr></table></body></html>',
    });
    await audit({ action: 'admin.email_test', actorId, meta: { to } });
    return { ok: true, messageId: String(info.messageId ?? '') };
  } catch {
    throw new AppError(ERR.VALIDATION('ارسال ایمیل آزمایشی ناموفق بود. میزبان، پورت، نوع اتصال امن و اعتبارنامه‌های SMTP را بررسی کنید.'));
  } finally {
    transport.close();
  }
}

// ---------------------------------------------------------------------------
// Round 17 — dedicated form-shaped settings: general / ai / referral / security
//
// One system_settings key per namespace; value_json holds the whole document.
// Reads merge stored values over defaults (type-checked per field, so a
// hand-edited row can never crash the API); writes validate strictly with
// Persian messages and upsert per key. The 'ai' document field name is
// load-bearing: ai.service.resolveProvider() reads valueJson['default_provider'].
// ---------------------------------------------------------------------------

async function readSettingDoc(key: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, key))
    .limit(1);
  return isRecord(row?.valueJson) ? row.valueJson : {};
}

/** Strict string-field validation — numbers never coerce to strings. */
function ensureDocStr(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید متن باشد.`));
  }
  const v = value.trim();
  if (v.length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید حداکثر ${max} کاراکتر باشد.`));
  }
  return v;
}

function ensureDocBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید بولی باشد.`));
  }
  return value;
}

// ---- general settings (site identity, support contacts, maintenance) ----

export interface GeneralSettings {
  siteNameFa: string;
  siteTaglineFa: string;
  supportEmail: string;
  supportPhone: string;
  supportTelegramUrl: string;
  supportBaleUrl: string;
  termsNoteFa: string;
  maintenanceEnabled: boolean;
  maintenanceMessageFa: string;
}

const GENERAL_LIMITS: Record<'siteNameFa' | 'siteTaglineFa' | 'supportEmail' | 'supportPhone' | 'supportTelegramUrl' | 'supportBaleUrl' | 'termsNoteFa' | 'maintenanceMessageFa', number> = {
  siteNameFa: 60,
  siteTaglineFa: 120,
  supportEmail: 190,
  supportPhone: 20,
  supportTelegramUrl: 190,
  supportBaleUrl: 190,
  termsNoteFa: 300,
  maintenanceMessageFa: 300,
};

const GENERAL_DEFAULTS: GeneralSettings = {
  siteNameFa: 'پُست‌یار',
  siteTaglineFa: '',
  supportEmail: '',
  supportPhone: '',
  supportTelegramUrl: '',
  supportBaleUrl: '',
  termsNoteFa: '',
  maintenanceEnabled: false,
  maintenanceMessageFa: '',
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const doc = await readSettingDoc('general');
  const s: GeneralSettings = { ...GENERAL_DEFAULTS };
  const str = (k: keyof typeof GENERAL_LIMITS): string | undefined => {
    const v = doc[k];
    return typeof v === 'string' ? v.trim().slice(0, GENERAL_LIMITS[k]) : undefined;
  };
  const siteName = str('siteNameFa');
  if (siteName) s.siteNameFa = siteName; // default is non-empty — never blank
  s.siteTaglineFa = str('siteTaglineFa') ?? s.siteTaglineFa;
  s.supportEmail = str('supportEmail') ?? s.supportEmail;
  s.supportPhone = str('supportPhone') ?? s.supportPhone;
  s.supportTelegramUrl = str('supportTelegramUrl') ?? s.supportTelegramUrl;
  s.supportBaleUrl = str('supportBaleUrl') ?? s.supportBaleUrl;
  s.termsNoteFa = str('termsNoteFa') ?? s.termsNoteFa;
  if (typeof doc['maintenanceEnabled'] === 'boolean') s.maintenanceEnabled = doc['maintenanceEnabled'];
  s.maintenanceMessageFa = str('maintenanceMessageFa') ?? s.maintenanceMessageFa;
  return s;
}

export interface GeneralSettingsPatch {
  siteNameFa?: string;
  siteTaglineFa?: string;
  supportEmail?: string;
  supportPhone?: string;
  supportTelegramUrl?: string;
  supportBaleUrl?: string;
  termsNoteFa?: string;
  maintenanceEnabled?: boolean;
  maintenanceMessageFa?: string;
}

export async function putGeneralSettings(patch: GeneralSettingsPatch): Promise<string[]> {
  const merged: GeneralSettings = await getGeneralSettings();
  const updated: string[] = [];
  if (patch.siteNameFa !== undefined) {
    const v = ensureDocStr(patch.siteNameFa, 'siteNameFa', GENERAL_LIMITS.siteNameFa);
    if (v === '') throw new AppError(ERR.VALIDATION('نام سایت الزامی است.'));
    merged.siteNameFa = v;
    updated.push('siteNameFa');
  }
  if (patch.siteTaglineFa !== undefined) {
    merged.siteTaglineFa = ensureDocStr(patch.siteTaglineFa, 'siteTaglineFa', GENERAL_LIMITS.siteTaglineFa);
    updated.push('siteTaglineFa');
  }
  if (patch.supportEmail !== undefined) {
    const v = ensureDocStr(patch.supportEmail, 'supportEmail', GENERAL_LIMITS.supportEmail);
    if (v !== '' && !v.includes('@')) throw new AppError(ERR.VALIDATION('ایمیل پشتیبانی معتبر نیست.'));
    merged.supportEmail = v;
    updated.push('supportEmail');
  }
  if (patch.supportPhone !== undefined) {
    merged.supportPhone = ensureDocStr(patch.supportPhone, 'supportPhone', GENERAL_LIMITS.supportPhone);
    updated.push('supportPhone');
  }
  if (patch.supportTelegramUrl !== undefined) {
    const v = ensureDocStr(patch.supportTelegramUrl, 'supportTelegramUrl', GENERAL_LIMITS.supportTelegramUrl);
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس تلگرام باید با https:// شروع شود.'));
    }
    merged.supportTelegramUrl = v;
    updated.push('supportTelegramUrl');
  }
  if (patch.supportBaleUrl !== undefined) {
    const v = ensureDocStr(patch.supportBaleUrl, 'supportBaleUrl', GENERAL_LIMITS.supportBaleUrl);
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس بله باید با https:// شروع شود.'));
    }
    merged.supportBaleUrl = v;
    updated.push('supportBaleUrl');
  }
  if (patch.termsNoteFa !== undefined) {
    merged.termsNoteFa = ensureDocStr(patch.termsNoteFa, 'termsNoteFa', GENERAL_LIMITS.termsNoteFa);
    updated.push('termsNoteFa');
  }
  if (patch.maintenanceEnabled !== undefined) {
    merged.maintenanceEnabled = ensureDocBool(patch.maintenanceEnabled, 'maintenanceEnabled');
    updated.push('maintenanceEnabled');
  }
  if (patch.maintenanceMessageFa !== undefined) {
    merged.maintenanceMessageFa = ensureDocStr(patch.maintenanceMessageFa, 'maintenanceMessageFa', GENERAL_LIMITS.maintenanceMessageFa);
    updated.push('maintenanceMessageFa');
  }
  await upsertSetting('general', merged);
  return updated;
}

// ---- ai settings -----------------------------------------------------------

export interface StoredAiProvider {
  id: string;
  title: string;
  kind: 'openai-compatible' | 'gemini' | 'anthropic';
  baseUrl: string;
  models: string[];
  selectedModel: string;
  apiKeyEncrypted?: string;
  builtIn?: boolean;
}
export interface AiSettings { defaultProvider: string; providers: Array<StoredAiProvider & { hasApiKey: boolean; apiKeyMasked: string }> }
export interface AiSettingsPatch { default_provider?: string }

const AI_SAFE_ID=/^[a-z0-9][a-z0-9_-]{1,39}$/;
const AI_SAFE_MODEL=/^[^\s]{1,120}$/;

function builtinProviders(): StoredAiProvider[] {
  return BUILTIN_AI_PROVIDERS.map(p=>({id:p.id,title:p.title,kind:p.kind,baseUrl:p.baseUrl,models:[...p.models],selectedModel:p.models[0] ?? '',builtIn:true}));
}
function normalizeUrl(url:string):string {
  let u: URL;
  try { u = new URL(url); } catch { throw new AppError(ERR.VALIDATION('آدرس سرویس‌دهنده معتبر نیست.')); }
  if(u.protocol!=='https:') throw new AppError(ERR.VALIDATION('آدرس سرویس‌دهنده باید HTTPS باشد.'));
  if(u.username||u.password) throw new AppError(ERR.VALIDATION('آدرس سرویس‌دهنده نباید نام کاربری یا رمز عبور داشته باشد.'));
  const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  const privateV4=/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/;
  const privateV6=host==='::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
  if(host==='localhost' || host.endsWith('.local') || privateV4.test(host) || privateV6) throw new AppError(ERR.VALIDATION('آدرس سرویس‌دهندهٔ داخلی مجاز نیست.'));
  return u.toString().replace(/\/$/,'');
}
function sanitizeProvider(raw:unknown):StoredAiProvider|null {
  if(!isRecord(raw)||typeof raw.id!=='string'||typeof raw.title!=='string'||typeof raw.kind!=='string'||typeof raw.baseUrl!=='string'||!Array.isArray(raw.models)) return null;
  if(!AI_SAFE_ID.test(raw.id) || typeof raw.selectedModel!=='string' || !['openai-compatible','gemini','anthropic'].includes(raw.kind)) return null;
  const models=raw.models.filter((v):v is string=>typeof v==='string'&&AI_SAFE_MODEL.test(v)).slice(0,100); if(!models.length) return null;
  try{const baseUrl=normalizeUrl(raw.baseUrl); const selected=models.includes(raw.selectedModel)?raw.selectedModel:(models[0] ?? ''); const out:StoredAiProvider={id:raw.id,title:raw.title.trim().slice(0,100),kind:raw.kind as StoredAiProvider['kind'],baseUrl,models,selectedModel:selected,builtIn:raw.builtIn===true}; if(typeof raw.apiKeyEncrypted==='string'&&raw.apiKeyEncrypted.trim()) out.apiKeyEncrypted=raw.apiKeyEncrypted; return out;}catch{return null;}
}
function readProviders(doc:Record<string,unknown>):StoredAiProvider[]{
  const raw=doc['providers']; const out:StoredAiProvider[]=[];
  if(Array.isArray(raw)) for(const item of raw){const p=sanitizeProvider(item);if(p)out.push(p);}
  for(const b of builtinProviders()) if(!out.some(p=>p.id===b.id)) out.push(b); return out;
}

export async function getAiSettings():Promise<AiSettings>{
  const doc=await readSettingDoc('ai'); const providers=readProviders(doc);
  const defaultProvider=typeof doc.default_provider==='string'&&providers.some(p=>p.id===doc.default_provider)?doc.default_provider:providers[0]?.id??'openai';
  return {defaultProvider,providers:providers.map(p=>({...p,hasApiKey:Boolean(p.apiKeyEncrypted),apiKeyMasked:p.apiKeyEncrypted?'کلید ذخیره‌شده':'کلید محیط سرور',apiKeyEncrypted:undefined}))};
}

export async function putAiSettings(patch:AiSettingsPatch):Promise<string[]>{
  if(patch.default_provider!==undefined){const settings=await getAiSettings();if(!settings.providers.some(p=>p.id===patch.default_provider))throw new AppError(ERR.VALIDATION('سرویس‌دهندهٔ هوش مصنوعی معتبر نیست.')); const doc=await readSettingDoc('ai');doc.default_provider=patch.default_provider;await upsertSetting('ai',doc);return ['default_provider'];}
  return [];
}

export interface AiProviderUpsert { id?: string; title:string; kind:'openai-compatible'|'gemini'|'anthropic'; baseUrl:string; models:string[]; selectedModel:string; apiKey?:string }
export async function upsertAiProvider(input:AiProviderUpsert):Promise<AiSettings>{
  const id=input.id?.trim().toLowerCase()||`custom-${Date.now().toString(36)}`; if(!AI_SAFE_ID.test(id)) throw new AppError(ERR.VALIDATION('شناسهٔ سرویس‌دهنده معتبر نیست.'));
  const baseUrl=normalizeUrl(input.baseUrl); const models=[...new Set(input.models.map(x=>x.trim()).filter(x=>AI_SAFE_MODEL.test(x)))].slice(0,100); if(!models.length) throw new AppError(ERR.VALIDATION('حداقل یک نام مدل معتبر وارد کنید.')); if(!models.includes(input.selectedModel)) throw new AppError(ERR.VALIDATION('مدل انتخاب‌شده باید در فهرست مدل‌ها باشد.'));
  const doc=await readSettingDoc('ai'); const providers=readProviders(doc); const existing=providers.find(p=>p.id===id);
  const builtin=BUILTIN_AI_PROVIDERS.find(p=>p.id===id);
  if(builtin){
    if(input.kind!==builtin.kind || normalizeUrl(input.baseUrl)!==builtin.baseUrl) throw new AppError(ERR.VALIDATION('پیکربندی پایهٔ این سرویس‌دهنده معتبر نیست.'));
    if(!builtin.models.includes(input.selectedModel as never)) throw new AppError(ERR.VALIDATION('مدل انتخاب‌شده برای این سرویس‌دهنده معتبر نیست.'));
    const next:StoredAiProvider={id,title:builtin.title,kind:builtin.kind,baseUrl:builtin.baseUrl,models:[...builtin.models],selectedModel:input.selectedModel.trim(),builtIn:true};
    if(input.apiKey!==undefined){if(input.apiKey.length>190)throw new AppError(ERR.VALIDATION('کلید سرویس‌دهنده بیش از حد مجاز است.')); if(input.apiKey.trim()) next.apiKeyEncrypted=encryptSecret(input.apiKey.trim());}
    else if(existing?.apiKeyEncrypted) next.apiKeyEncrypted=existing.apiKeyEncrypted;
    const index=providers.findIndex(p=>p.id===id); if(index>=0) providers[index]=next; else providers.push(next);
    doc.providers=providers; await upsertSetting('ai',doc); return getAiSettings();
  }
  const next:StoredAiProvider={id,title:input.title.trim().slice(0,100),kind:input.kind,baseUrl,models,selectedModel:input.selectedModel.trim(),builtIn:false};
  if(input.apiKey!==undefined){if(input.apiKey.length>190)throw new AppError(ERR.VALIDATION('کلید سرویس‌دهنده بیش از حد مجاز است.')); if(input.apiKey.trim()) next.apiKeyEncrypted=encryptSecret(input.apiKey.trim());}
  else if(existing?.apiKeyEncrypted) next.apiKeyEncrypted=existing.apiKeyEncrypted;
  const index=providers.findIndex(p=>p.id===id); if(index>=0) providers[index]=next; else providers.push(next);
  doc.providers=providers; await upsertSetting('ai',doc); return getAiSettings();
}
export async function deleteAiProvider(id:string):Promise<AiSettings>{
  const doc=await readSettingDoc('ai'); const providers=readProviders(doc); const target=providers.find(p=>p.id===id); if(!target) throw new AppError(ERR.NOT_FOUND('سرویس‌دهندهٔ هوش مصنوعی')); if(target.builtIn) throw new AppError(ERR.CONFLICT('سرویس‌دهندهٔ پایه حذف نمی‌شود.')); const next=providers.filter(p=>p.id!==id); doc.providers=next; if(doc.default_provider===id) doc.default_provider=next[0]?.id??'openai'; await upsertSetting('ai',doc); return getAiSettings();
}

export interface AiRuntimeOverride { key?:string; baseUrl?:string; model?:string; kind?:'openai-compatible'|'gemini'|'anthropic' }
export async function resolveAiRuntimeOverride(provider:string):Promise<AiRuntimeOverride>{
  const doc=await readSettingDoc('ai'); const found=readProviders(doc).find(p=>p.id===provider.toLowerCase()); if(!found) return {};
  const out:AiRuntimeOverride={baseUrl:found.baseUrl,model:found.selectedModel,kind:found.kind};
  if(found.apiKeyEncrypted){try{out.key=decryptSecret(found.apiKeyEncrypted);}catch{throw new AppError(ERR.PROVIDER_UNAVAILABLE());}}
  return out;
}

// ---- referral settings (register reward, first-purchase percent) ---------

export interface ReferralSettings {
  registerRewardPoints: number;
  enabled: boolean;
  firstPurchasePercent: number;
}

export const REFERRAL_POINTS_MIN = 0;
export const REFERRAL_POINTS_MAX = 100000;
export const REFERRAL_PERCENT_MIN = 0;
export const REFERRAL_PERCENT_MAX = 50;
const REFERRAL_DEFAULTS: ReferralSettings = { registerRewardPoints: 100, enabled: true, firstPurchasePercent: 10 };

export async function getReferralSettings(): Promise<ReferralSettings> {
  const doc = await readSettingDoc('referral');
  const s: ReferralSettings = { ...REFERRAL_DEFAULTS };
  const rawPoints = doc['registerRewardPoints'];
  if (
    typeof rawPoints === 'number' &&
    Number.isInteger(rawPoints) &&
    rawPoints >= REFERRAL_POINTS_MIN &&
    rawPoints <= REFERRAL_POINTS_MAX
  ) {
    s.registerRewardPoints = rawPoints;
  }
  if (typeof doc['enabled'] === 'boolean') s.enabled = doc['enabled'];
  const rawPercent = doc['firstPurchasePercent'];
  if (
    typeof rawPercent === 'number' &&
    Number.isInteger(rawPercent) &&
    rawPercent >= REFERRAL_PERCENT_MIN &&
    rawPercent <= REFERRAL_PERCENT_MAX
  ) {
    s.firstPurchasePercent = rawPercent;
  }
  return s;
}

export interface ReferralSettingsPatch {
  registerRewardPoints?: number;
  enabled?: boolean;
  firstPurchasePercent?: number;
}

export async function putReferralSettings(patch: ReferralSettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('referral')) };
  const updated: string[] = [];
  if (patch.registerRewardPoints !== undefined) {
    const v = patch.registerRewardPoints;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < REFERRAL_POINTS_MIN || v > REFERRAL_POINTS_MAX) {
      throw new AppError(ERR.VALIDATION('امتیاز پاداش معرفی باید عدد صحیح بین ۰ تا ۱۰۰۰۰۰ باشد.'));
    }
    merged['registerRewardPoints'] = v;
    updated.push('registerRewardPoints');
  }
  if (patch.enabled !== undefined) {
    merged['enabled'] = ensureDocBool(patch.enabled, 'enabled');
    updated.push('enabled');
  }
  if (patch.firstPurchasePercent !== undefined) {
    const v = patch.firstPurchasePercent;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < REFERRAL_PERCENT_MIN || v > REFERRAL_PERCENT_MAX) {
      throw new AppError(ERR.VALIDATION('درصد پاداش خرید اول باید عددی بین ۰ تا ۵۰ باشد.'));
    }
    merged['firstPurchasePercent'] = v;
    updated.push('firstPurchasePercent');
  }
  await upsertSetting('referral', merged);
  return updated;
}

// ---- gold ticker bot defaults (asovin «تنظیمات ربات طلا» parity) ---------

export interface GoldSettings {
  defaultSourceUrl: string;
  defaultFrequencyMinutes: number;
  defaultTemplateFa: string;
}

const GOLD_DEFAULTS: GoldSettings = { defaultSourceUrl: '', defaultFrequencyMinutes: 60, defaultTemplateFa: '' };
const GOLD_LIMITS = { defaultSourceUrl: 190, defaultTemplateFa: 2000 } as const;
const GOLD_FREQUENCY_MIN = 15;
const GOLD_FREQUENCY_MAX = 1440;

export async function getGoldSettings(): Promise<GoldSettings> {
  const doc = await readSettingDoc('gold');
  const s: GoldSettings = { ...GOLD_DEFAULTS };
  const rawUrl = doc['defaultSourceUrl'];
  if (typeof rawUrl === 'string') s.defaultSourceUrl = rawUrl.trim().slice(0, GOLD_LIMITS.defaultSourceUrl);
  const rawFreq = doc['defaultFrequencyMinutes'];
  if (
    typeof rawFreq === 'number' &&
    Number.isInteger(rawFreq) &&
    rawFreq >= GOLD_FREQUENCY_MIN &&
    rawFreq <= GOLD_FREQUENCY_MAX
  ) {
    s.defaultFrequencyMinutes = rawFreq;
  }
  const rawTemplate = doc['defaultTemplateFa'];
  if (typeof rawTemplate === 'string') s.defaultTemplateFa = rawTemplate.slice(0, GOLD_LIMITS.defaultTemplateFa);
  return s;
}

export interface GoldSettingsPatch {
  defaultSourceUrl?: string;
  defaultFrequencyMinutes?: number;
  defaultTemplateFa?: string;
}

export async function putGoldSettings(patch: GoldSettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('gold')) };
  const updated: string[] = [];
  if (patch.defaultSourceUrl !== undefined) {
    const v = ensureDocStr(patch.defaultSourceUrl, 'defaultSourceUrl', GOLD_LIMITS.defaultSourceUrl);
    // Scheme-only validation here: the FULL SSRF check (assertSafeUrl) still
    // happens on the user-side save paths in gold.service.saveGoldConfig.
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس منبع پیش‌فرض باید با https:// شروع شود.'));
    }
    merged['defaultSourceUrl'] = v;
    updated.push('defaultSourceUrl');
  }
  if (patch.defaultFrequencyMinutes !== undefined) {
    const v = patch.defaultFrequencyMinutes;
    if (
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      v < GOLD_FREQUENCY_MIN ||
      v > GOLD_FREQUENCY_MAX
    ) {
      throw new AppError(ERR.VALIDATION('فاصلهٔ به‌روزرسانی پیش‌فرض باید بین ۱۵ تا ۱۴۴۰ دقیقه باشد.'));
    }
    merged['defaultFrequencyMinutes'] = v;
    updated.push('defaultFrequencyMinutes');
  }
  if (patch.defaultTemplateFa !== undefined) {
    merged['defaultTemplateFa'] = ensureDocStr(patch.defaultTemplateFa, 'defaultTemplateFa', GOLD_LIMITS.defaultTemplateFa);
    updated.push('defaultTemplateFa');
  }
  await upsertSetting('gold', merged);
  return updated;
}

// ---- security settings (registration toggle, captcha toggle) -------------

export interface SecuritySettings {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
}

const SECURITY_DEFAULTS: SecuritySettings = { registrationEnabled: true, captchaEnabled: true };

export async function getSecuritySettings(): Promise<SecuritySettings> {
  try {
    const doc = await readSettingDoc('security');
    const s: SecuritySettings = { ...SECURITY_DEFAULTS };
    if (typeof doc['registrationEnabled'] === 'boolean') s.registrationEnabled = doc['registrationEnabled'];
    if (typeof doc['captchaEnabled'] === 'boolean') s.captchaEnabled = doc['captchaEnabled'];
    return s;
  } catch {
    return { ...SECURITY_DEFAULTS };
  }
}

export interface SecuritySettingsPatch {
  registrationEnabled?: boolean;
  captchaEnabled?: boolean;
}

export async function putSecuritySettings(patch: SecuritySettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('security')) };
  const updated: string[] = [];
  if (patch.registrationEnabled !== undefined) {
    merged['registrationEnabled'] = ensureDocBool(patch.registrationEnabled, 'registrationEnabled');
    updated.push('registrationEnabled');
  }
  if (patch.captchaEnabled !== undefined) {
    merged['captchaEnabled'] = ensureDocBool(patch.captchaEnabled, 'captchaEnabled');
    updated.push('captchaEnabled');
  }
  await upsertSetting('security', merged);
  return updated;
}
