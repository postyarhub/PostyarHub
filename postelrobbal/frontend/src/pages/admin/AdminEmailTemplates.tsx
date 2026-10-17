import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';

type TemplateKey =
  | 'registration'
  | 'admin_alert'
  | 'payment_success'
  | 'payment_failed'
  | 'subscription'
  | 'ticket_created'
  | 'ticket_reply'
  | 'password_reset'
  | 'test_email'
  | 'generic';

interface TemplateDraft {
  subject: string;
  preheader: string;
  title: string;
  greeting: string;
  paragraphs: string;
  buttonLabel: string;
  footerNote: string;
}

type TemplateSettings = Partial<Record<TemplateKey, Partial<TemplateDraft>>>;

const EMPTY_DRAFT: TemplateDraft = {
  subject: '',
  preheader: '',
  title: '',
  greeting: '',
  paragraphs: '',
  buttonLabel: '',
  footerNote: '',
};

const TEMPLATE_META: Array<{
  key: TemplateKey;
  label: string;
  description: string;
  subject: string;
  title: string;
  greeting: string;
  paragraphs: string;
  buttonLabel: string;
}> = [
  {
    key: 'registration',
    label: 'خوش‌آمدگویی و ثبت‌نام',
    description: 'ایمیل خوش‌آمدگویی که پس از ساخت حساب برای کاربر فرستاده می‌شود.',
    subject: 'ثبت‌نام شما در پُست‌یار انجام شد',
    title: 'به پُست‌یار خوش آمدید',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'ثبت‌نام شما با موفقیت انجام شد. از این پس می‌توانید انتشار محتوای کانال‌هایتان را از پنل پُست‌یار مدیریت کنید.\nاگر این حساب را شما ایجاد نکرده‌اید، لطفاً با پشتیبانی تماس بگیرید.',
    buttonLabel: 'ورود به پنل پُست‌یار',
  },
  {
    key: 'admin_alert',
    label: 'اعلان‌های مدیریتی',
    description: 'اعلان ثبت‌نام، پرداخت، اشتراک و تیکت‌هایی که برای مدیر یا تیم پشتیبانی ارسال می‌شوند.',
    subject: 'اعلان جدید از پُست‌یار',
    title: 'رویداد جدید در سامانه',
    greeting: '',
    paragraphs: 'یک رویداد جدید در پُست‌یار ثبت شده است. برای مشاهدهٔ جزئیات، وارد پنل مدیریت شوید.',
    buttonLabel: 'مشاهده در پنل مدیریت',
  },
  {
    key: 'payment_success',
    label: 'پرداخت موفق و شارژ کیف پول',
    description: 'رسید اطلاع‌رسانی برای پرداخت موفق یا شارژ کیف پول.',
    subject: 'رسید شارژ کیف پول پُست‌یار',
    title: 'شارژ کیف پول موفق بود',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'شارژ کیف پول پُست‌یار با موفقیت ثبت شد. این ایمیل رسید اطلاع‌رسانی عملیات است.',
    buttonLabel: 'مشاهده کیف پول',
  },
  {
    key: 'payment_failed',
    label: 'پرداخت ناموفق',
    description: 'پیام مربوط به پرداختی که از طرف درگاه تأیید نشده است.',
    subject: 'پرداخت شما در پُست‌یار تأیید نشد',
    title: 'پرداخت تأیید نشد',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'تأیید پرداخت انجام نشد. اگر مبلغی از حساب شما کسر شده است، وضعیت را از پنل پیگیری کنید یا با پشتیبانی تماس بگیرید.',
    buttonLabel: 'پیگیری در پنل',
  },
  {
    key: 'subscription',
    label: 'وضعیت اشتراک',
    description: 'فعال‌سازی، تمدید و یادآوری پایان اعتبار اشتراک.',
    subject: 'به‌روزرسانی اشتراک | پُست‌یار',
    title: 'وضعیت اشتراک شما به‌روزرسانی شد',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'اشتراک شما با موفقیت فعال شد. وضعیت و تاریخ پایان اشتراک را از پنل بررسی کنید.',
    buttonLabel: 'مشاهده اشتراک',
  },
  {
    key: 'ticket_created',
    label: 'ثبت تیکت پشتیبانی',
    description: 'تأیید دریافت درخواست پشتیبانی برای کاربر.',
    subject: 'تیکت شما در پُست‌یار ثبت شد',
    title: 'تیکت شما ثبت شد',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'درخواست شما ثبت شد. پاسخ و ادامهٔ گفتگو از داخل پنل پُست‌یار در دسترس خواهد بود.',
    buttonLabel: 'مشاهده تیکت',
  },
  {
    key: 'ticket_reply',
    label: 'پاسخ پشتیبانی',
    description: 'اطلاع‌رسانی دربارهٔ پاسخ پشتیبانی به تیکت کاربر.',
    subject: 'پاسخ جدید تیکت شما',
    title: 'پاسخ جدید به تیکت شما',
    greeting: 'سلام کاربر گرامی،',
    paragraphs: 'تیم پشتیبانی به تیکت شما پاسخ داده است. برای مشاهدهٔ پاسخ، وارد پنل پُست‌یار شوید.',
    buttonLabel: 'مشاهده تیکت',
  },
  {
    key: 'password_reset',
    label: 'بازیابی رمز عبور',
    description: 'ایمیل امنیتی برای تعیین رمز عبور جدید؛ مسیر و مهلت اعتبار لینک قابل ویرایش نیست.',
    subject: 'بازیابی رمز عبور پُست‌یار',
    title: 'بازیابی رمز عبور',
    greeting: 'سلام،',
    paragraphs: 'برای تعیین رمز عبور جدید، دکمهٔ زیر را انتخاب کنید. این لینک فقط ۳۰ دقیقه اعتبار دارد و یک‌بار قابل استفاده است.\nاگر این درخواست را شما انجام نداده‌اید، این پیام را نادیده بگیرید.',
    buttonLabel: 'تعیین رمز عبور جدید',
  },
  {
    key: 'test_email',
    label: 'ایمیل آزمایشی',
    description: 'قالبی که برای بررسی تنظیمات SMTP به نشانی انتخاب‌شده فرستاده می‌شود.',
    subject: 'ایمیل آزمایشی پُست‌یار',
    title: 'ارسال ایمیل آماده است',
    greeting: 'سلام،',
    paragraphs: 'تنظیمات SMTP با موفقیت آزموده شد. اگر این پیام را دریافت کرده‌اید، ارسال ایمیل پُست‌یار کار می‌کند.',
    buttonLabel: 'ورود به پنل پُست‌یار',
  },
  {
    key: 'generic',
    label: 'سایر اعلان‌ها',
    description: 'قالب پیش‌فرض برای اعلان‌هایی که در دسته‌های بالا قرار نمی‌گیرند.',
    subject: 'اطلاع‌رسانی از پُست‌یار',
    title: 'اطلاع‌رسانی',
    greeting: 'سلام،',
    paragraphs: 'اطلاع‌رسانی تازه‌ای در پنل پُست‌یار برای شما ثبت شده است.',
    buttonLabel: 'ورود به پنل پُست‌یار',
  },
];

const FIELDS: Array<{ key: keyof TemplateDraft; label: string; hint: string; rows?: number; maxLength: number }> = [
  { key: 'subject', label: 'موضوع ایمیل', hint: 'عنوانی که در صندوق ورودی گیرنده دیده می‌شود.', maxLength: 190 },
  { key: 'preheader', label: 'متن پیش‌نمایش', hint: 'خلاصهٔ کوتاهی که کنار موضوع در بسیاری از صندوق‌های ورودی دیده می‌شود.', maxLength: 180 },
  { key: 'title', label: 'عنوان داخل پیام', hint: 'تیتر اصلی ایمیل.', maxLength: 160 },
  { key: 'greeting', label: 'خطاب ابتدایی', hint: 'برای حفظ نام واقعی گیرنده از {{greeting}} استفاده کنید.', maxLength: 180 },
  { key: 'paragraphs', label: 'متن پیام', hint: 'هر خط یک بند جداگانه است. برای نگه‌داشتن متن پویا از {{paragraphs}} و برای درج یک مقدار جزئیات از {{detail:مبلغ}} یا برچسب دقیق آن استفاده کنید.', rows: 5, maxLength: 4000 },
  { key: 'buttonLabel', label: 'متن دکمهٔ اصلی', hint: 'نشانی و مقصد دکمه به‌صورت امن توسط سامانه تعیین می‌شود و از این صفحه قابل تغییر نیست.', maxLength: 100 },
  { key: 'footerNote', label: 'یادداشت پایانی', hint: 'متن تکمیلی در پایین محتوای پیام.', maxLength: 300 },
];

function normalizeDraft(value?: Partial<TemplateDraft>): TemplateDraft {
  return { ...EMPTY_DRAFT, ...(value ?? {}) };
}

function previewText(value: string, values: Record<string, string>): string {
  return value.replace(/\{\{([^{}]+)\}\}/g, (_match, token: string) => values[token.trim()] ?? _match);
}

export default function AdminEmailTemplates() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<TemplateKey>('registration');
  const [templates, setTemplates] = useState<Record<TemplateKey, TemplateDraft>>(() => {
    const result = {} as Record<TemplateKey, TemplateDraft>;
    for (const meta of TEMPLATE_META) result[meta.key] = { ...EMPTY_DRAFT };
    return result;
  });
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [mobilePreview, setMobilePreview] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await api.get<TemplateSettings>('/api/v1/admin/settings/email/templates');
        const normalized = {} as Record<TemplateKey, TemplateDraft>;
        for (const meta of TEMPLATE_META) normalized[meta.key] = normalizeDraft(response[meta.key]);
        if (alive) {
          setTemplates(normalized);
          setDraft(normalized.registration);
        }
      } catch (err) {
        if (alive) toast.error(err instanceof Error ? err.message : 'دریافت قالب‌های ایمیل ناموفق بود.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = TEMPLATE_META.find((item) => item.key === selected) ?? TEMPLATE_META[0];
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(templates[selected] ?? EMPTY_DRAFT), [draft, templates, selected]);
  const displayValues = {
    subject: draft.subject.trim() || meta.subject,
    preheader: draft.preheader.trim() || 'اطلاع‌رسانی رسمی از پُست‌یار.',
    title: draft.title.trim() || meta.title,
    greeting: draft.greeting.trim() || meta.greeting,
    paragraphs: draft.paragraphs.trim() || meta.paragraphs,
    buttonLabel: draft.buttonLabel.trim() || meta.buttonLabel,
    footerNote: draft.footerNote.trim() || 'این پیام به‌صورت خودکار از طرف پُست‌یار ارسال شده است.',
  };
  const previewBody = previewText(displayValues.paragraphs, displayValues).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const chooseTemplate = (value: string) => {
    const key = value as TemplateKey;
    if (dirty && !window.confirm('تغییرات ذخیره‌نشده کنار گذاشته شوند؟')) return;
    setSelected(key);
    setDraft(templates[key] ?? { ...EMPTY_DRAFT });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/email/templates/' + selected, draft);
      setTemplates((previous) => ({ ...previous, [selected]: { ...draft } }));
      toast.success('قالب ایمیل ذخیره شد.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ذخیرهٔ قالب ایمیل ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <Card>
      <div className="adm-card-head"><strong>قالب‌های ایمیل تراکنشی</strong></div>
      <p style={{ margin: '0 0 16px', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.9 }}>
        متن ایمیل‌های ثبت‌نام، پرداخت، اشتراک، تیکت و بازیابی رمز عبور را در همین صفحه مدیریت کنید. طراحی رسمی، لوگو، فونت و چیدمان سازگار با موبایل یکپارچه باقی می‌مانند؛ فقط محتوای متنی قالب قابل ویرایش است.
      </p>

      <Field label="قالب موردنظر">
        <select className="input" value={selected} onChange={(event) => chooseTemplate(event.target.value)} style={{ width: '100%' }}>
          {TEMPLATE_META.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
        </select>
      </Field>
      <p style={{ margin: '0 0 18px', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.8 }}>{meta.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))', gap: 18, alignItems: 'start' }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 12 }}>
          {FIELDS.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint}>
              {field.key === 'paragraphs' ? (
                <textarea
                  className="textarea"
                  rows={field.rows ?? 3}
                  maxLength={field.maxLength}
                  value={draft[field.key]}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  placeholder={'برای استفاده از متن پیش‌فرض، این قسمت را خالی بگذارید.'}
                  style={{ width: '100%', resize: 'vertical', lineHeight: 1.9 }}
                />
              ) : (
                <input
                  className="input"
                  type="text"
                  maxLength={field.maxLength}
                  value={draft[field.key]}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  placeholder="خالی بماند: استفاده از متن پیش‌فرض"
                  style={{ width: '100%' }}
                />
              )}
            </Field>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>ذخیرهٔ قالب</Button>
            <Button variant="soft" disabled={!dirty || saving} onClick={() => setDraft(templates[selected] ?? { ...EMPTY_DRAFT })}>لغو تغییرات</Button>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{dirty ? 'تغییرات ذخیره نشده‌اند.' : 'آخرین تغییرات ذخیره شده‌اند.'}</span>
          </div>
        </div>

        <div style={{ minWidth: 0, border: '1px solid var(--border)', borderRadius: 16, padding: 14, background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <strong style={{ fontSize: 13.5 }}>پیش‌نمایش قالب</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant={mobilePreview ? 'soft' : 'primary'} onClick={() => setMobilePreview(false)}>دسکتاپ</Button>
              <Button size="sm" variant={mobilePreview ? 'primary' : 'soft'} onClick={() => setMobilePreview(true)}>موبایل</Button>
            </div>
          </div>
          <div style={{ width: '100%', maxWidth: mobilePreview ? 360 : 560, margin: '0 auto', transition: 'max-width .2s ease', background: '#f2f4fa', padding: mobilePreview ? 7 : 12, borderRadius: 14, boxSizing: 'border-box' }}>
            <div style={{ border: '1px solid #e5e9f3', borderTop: '4px solid #f28c28', borderRadius: 15, overflow: 'hidden', background: '#fff', color: '#1b2444', fontFamily: 'Vazirmatn,Tahoma,Arial,sans-serif' }}>
              <div style={{ padding: mobilePreview ? '15px 14px' : '20px 22px', borderBottom: '1px solid #edf0f6', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <img src="/email-assets/postyar-logo-mark.webp" alt="لوگوی رسمی پُست‌یار" style={{ width: 42, height: 'auto', flex: '0 0 auto' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.5, color: '#202b61' }}>پُست‌یار</div>
                  <div style={{ fontSize: 11.5, color: '#68738b', lineHeight: 1.8 }}>مدیریت یکپارچهٔ انتشار محتوا</div>
                </div>
              </div>
              <div style={{ padding: mobilePreview ? '20px 14px' : '28px 22px', overflowWrap: 'anywhere' }}>
                <div style={{ fontSize: 11.5, color: '#69748c', marginBottom: 7 }}>موضوع: {displayValues.subject}</div>
                <div style={{ fontSize: mobilePreview ? 19 : 22, fontWeight: 900, lineHeight: 1.8, marginBottom: 18 }}>{displayValues.title}</div>
                {displayValues.greeting && <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.9, marginBottom: 12 }}>{previewText(displayValues.greeting, displayValues)}</div>}
                {previewBody.map((line, i) => <p key={i} style={{ fontSize: 13.5, lineHeight: 2, margin: '0 0 12px', color: '#344054', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{previewText(line, displayValues)}</p>)}
                {!!displayValues.buttonLabel && <div style={{ display: 'inline-block', maxWidth: '100%', margin: '10px 0 16px', padding: '11px 18px', borderRadius: 10, color: '#fff', background: '#3949ab', fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{displayValues.buttonLabel}</div>}
                <div style={{ fontSize: 11.5, color: '#68738b', lineHeight: 1.9, borderTop: '1px solid #e8ebf4', paddingTop: 12 }}>{previewText(displayValues.footerNote, displayValues)}</div>
              </div>
              <div style={{ background: '#f8f9fd', padding: '13px 12px', textAlign: 'center', borderTop: '1px solid #e8ebf4', fontSize: 11, lineHeight: 1.9, color: '#68738b' }}>
                این پیام به‌صورت خودکار از طرف پُست‌یار ارسال شده است.<br />
                <span>postyarhub.ir · support@postyarhub.ir</span>
              </div>
            </div>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, lineHeight: 1.8, color: 'var(--text-2)' }}>
            پیش‌نمایش برای بررسی چیدمان است؛ برای تأیید واقعی، پس از ذخیره از بخش «ارسال ایمیل آزمایشی» استفاده کنید.
          </p>
        </div>
      </div>
    </Card>
  );
}
