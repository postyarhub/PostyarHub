import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { messageTemplates } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { audit } from '../../core/audit.js';

export interface TemplateTag {
  code: string;
  label: string;
  description: string;
  category: 'محتوا' | 'ووکامرس' | 'وردپرس' | 'پویا';
}

export const TEMPLATE_TAGS: TemplateTag[] = [
  { code: '{title}', label: 'عنوان', description: 'عنوان اصلی محتوا یا محصول', category: 'محتوا' },
  { code: '{description}', label: 'توضیحات', description: 'توضیحات کوتاه؛ برای سازگاری با قالب‌های فعلی پُست‌یار', category: 'محتوا' },
  { code: '{excerpt}', label: 'خلاصه', description: 'خلاصه یا چکیده محتوا', category: 'وردپرس' },
  { code: '{content}', label: 'متن کامل', description: 'متن اصلی محتوا', category: 'محتوا' },
  { code: '{link}', label: 'لینک', description: 'نشانی صفحه یا محتوای مرتبط', category: 'محتوا' },
  { code: '{date}', label: 'تاریخ', description: 'تاریخ انتشار یا تاریخ مرتبط', category: 'محتوا' },
  { code: '{author}', label: 'نویسنده', description: 'نام نویسنده محتوا', category: 'وردپرس' },
  { code: '{site_name}', label: 'نام سایت', description: 'نام سایت یا فروشگاه', category: 'وردپرس' },
  { code: '{post_type}', label: 'نوع محتوا', description: 'نوع محتوای وردپرس/محصول', category: 'وردپرس' },
  { code: '{featured_image}', label: 'تصویر شاخص', description: 'نشانی تصویر شاخص', category: 'محتوا' },
  { code: '{site_url}', label: 'نشانی سایت', description: 'آدرس اصلی سایت یا فروشگاه؛ نمونه: https://example.com', category: 'وردپرس' },
  { code: '{product_id}', label: 'شناسه محصول', description: 'شناسه محصول ووکامرس؛ برای درج شناسه داخلی محصول', category: 'ووکامرس' },
  { code: '{discount_percent}', label: 'درصد تخفیف', description: 'درصد تخفیف محاسبه‌شده از قیمت عادی و قیمت تخفیفی', category: 'ووکامرس' },
  { code: '{event_type}', label: 'نوع رویداد', description: 'نوع رویداد یا اقدام کمپین', category: 'پویا' },
  { code: '{price}', label: 'قیمت', description: 'قیمت نهایی محصول', category: 'ووکامرس' },
  { code: '{regular_price}', label: 'قیمت عادی', description: 'قیمت عادی محصول', category: 'ووکامرس' },
  { code: '{sale_price}', label: 'قیمت تخفیفی', description: 'قیمت فروش ویژه محصول', category: 'ووکامرس' },
  { code: '{old_price}', label: 'قیمت قبلی', description: 'قیمت قبلی یا قیمت قبل از تخفیف', category: 'ووکامرس' },
  { code: '{sku}', label: 'کد محصول', description: 'SKU یا کد کالا', category: 'ووکامرس' },
  { code: '{stock_status}', label: 'وضعیت موجودی', description: 'موجود، ناموجود یا پیش‌خرید', category: 'ووکامرس' },
  { code: '{meta:field_name}', label: 'فیلد سفارشی', description: 'مقدار فیلد سفارشی وردپرس', category: 'پویا' },
  { code: '{acf:field_name}', label: 'فیلد ACF', description: 'مقدار فیلد ACF', category: 'پویا' },
  { code: '{jet:field_name}', label: 'فیلد JetEngine', description: 'مقدار فیلد JetEngine', category: 'پویا' },
];

interface BuiltinTemplate {
  name: string;
  description: string;
  category: string;
  body: string;
  eventType: 'new' | 'update' | 'product_price' | 'product_stock';
  cta?: { label: string; url: string } | null;
};

const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { name: 'معرفی محصول', description: 'معرفی استاندارد محصول با قیمت و لینک', category: 'فروش', eventType: 'new', cta: null, body: '🛍️ {title}\n\n{description}\n\n💰 قیمت: {price}\n🔗 {link}' },
  { name: 'فروش ویژه', description: 'قالب کمپین فروش و تخفیف', category: 'فروش', eventType: 'product_price', cta: null, body: '🔥 فروش ویژه\n\n{title}\n{description}\n\n💥 قیمت ویژه: {sale_price}\n💰 قیمت قبل: {regular_price}\n🔗 {link}' },
  { name: 'موجودی محدود', description: 'اعلام موجودی و دعوت به خرید', category: 'فروش', eventType: 'product_stock', cta: null, body: '⚡ موجودی محدود\n\n{title}\n\n{description}\n\n💰 {price}\n🔗 برای خرید: {link}' },
  { name: 'محصول جدید', description: 'اعلام محصول تازه', category: 'فروش', eventType: 'new', cta: null, body: '✨ محصول جدید\n\n{title}\n\n{description}\n\n💰 {price}\n🔗 {link}' },
  { name: 'پرفروش‌ها', description: 'قالب معرفی محصول پرفروش', category: 'فروش', eventType: 'new', cta: null, body: '🏆 پرفروش\n\n{title}\n\n{description}\n\n💰 {price}\n🔗 {link}' },
  { name: 'کاهش قیمت', description: 'اعلام کاهش قیمت محصول', category: 'فروش', eventType: 'product_price', cta: null, body: '📉 کاهش قیمت\n\n{title}\n\nقیمت جدید: {price}\nقیمت قبلی: {old_price}\n{discount_percent}% تخفیف\n🔗 {link}' },
  { name: 'مقاله جدید', description: 'انتشار مقاله یا مطلب جدید', category: 'محتوا', eventType: 'new', cta: null, body: '📰 مقاله جدید\n\n{title}\n\n{excerpt}\n\nمطالعه کامل: {link}' },
  { name: 'آموزش کوتاه', description: 'قالب محتوای آموزشی', category: 'محتوا', eventType: 'new', cta: null, body: '📚 آموزش\n\n{title}\n\n{description}\n\n🔗 مطالعه کامل: {link}' },
  { name: 'اطلاعیه رسمی', description: 'قالب اطلاع‌رسانی رسمی', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '📣 اطلاعیه رسمی\n\n{title}\n\n{description}\n\n🔗 {link}' },
  { name: 'رویداد', description: 'قالب اطلاع‌رسانی رویداد', category: 'مناسبتی', eventType: 'new', cta: null, body: '🎉 رویداد\n\n{title}\n\n{description}\n\n📅 {date}\n🔗 {link}' },
  { name: 'کوتاه و سریع', description: 'قالب جمع‌وجور برای ارسال سریع', category: 'عمومی', eventType: 'new', cta: null, body: '⚡ {title}\n💰 {price}\n🔗 {link}' },
  { name: 'مینیمال', description: 'عنوان، توضیحات و لینک بدون تزئینات اضافه', category: 'عمومی', eventType: 'new', cta: null, body: '{title}\n\n{description}\n\n{link}' },
  { name: 'موجود شد', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_stock', cta: null, body: '✅ دوباره موجود شد\n\n{title}\n\nبرای سفارش: {link}' },
  { name: 'ناموجود شد', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'product_stock', cta: null, body: '⛔ اطلاع‌رسانی موجودی\n\n{title}\nاین محصول موقتاً ناموجود است؛ پس از شارژ مجدد اطلاع می‌دهیم.' },
  { name: 'رونمایی محصول', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '🚀 رونمایی\n\n{title}\n\n{description}\n\n📅 {date}\n🔗 {link}' },
  { name: 'پیشنهاد ویژه', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_price', cta: null, body: '🎁 پیشنهاد ویژه برای شما\n\n{title}\n{description}\n\n💰 {price}\n⏳ اعتبار: {date}\n🔗 {link}' },
  { name: 'اعلام قیمت', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_price', cta: null, body: '💰 قیمت روز\n\n{title}\n\nقیمت: {price}\n\n🔗 {link}' },
  { name: 'معرفی سریع', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '🔎 {title}\n\n{description}\n\n💰 {price}\n🔗 مشاهده جزئیات: {link}' },
  { name: 'معرفی مطلب', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'محتوا', eventType: 'new', cta: null, body: '✍️ مطلب جدید\n\n{title}\n\n{description}\n\nادامه مطلب: {link}' },
  { name: 'معرفی و بررسی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'محتوا', eventType: 'new', cta: null, body: '⭐ بررسی\n\n{title}\n\n{description}\n\n🔗 جزئیات: {link}' },
  { name: 'خبر کوتاه', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '📢 اطلاعیه\n\n{title}\n\n{description}' },
  { name: 'به‌روزرسانی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'update', cta: null, body: '🔄 به‌روزرسانی\n\n{title}\n\n{description}\n\n🔗 {link}' },
  { name: 'یادآوری', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '⏰ یادآوری\n\n{title}\n\n{description}\n\n📅 {date}' },
  { name: 'اعلامیه رسمی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '📣 اطلاعیه رسمی\n\n{title}\n\n{description}\n\n🔗 {link}' },
  { name: 'خوش‌آمدگویی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'مناسبتی', eventType: 'new', cta: null, body: '👋 خوش آمدید\n\n{title}\n\n{description}\n\n🔗 {link}' },
  { name: 'مناسبتی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'مناسبتی', eventType: 'new', cta: null, body: '🌟 {title}\n\n{description}\n\n📅 {date}\n🔗 {link}' },
  { name: 'عنوان + لینک', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'عمومی', eventType: 'new', cta: null, body: '{title}\n\n{description}\n\n🔗 {link}' },
  { name: 'مطلب وردپرسی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'محتوا', eventType: 'new', cta: null, body: '📝 {title}\n\n{excerpt}\n\n✍️ نویسنده: {author}\n🔗 {link}' },
  { name: 'متن کامل', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'محتوا', eventType: 'new', cta: null, body: '📄 {title}\n\n{content}\n\n🔗 منبع: {link}' },
  { name: 'خبر سایت', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '🗞️ {site_name}\n\n{title}\n\n{description}\n\n📅 {date}\n🔗 {link}' },
  { name: 'به‌روزرسانی رسمی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'update', cta: null, body: '📌 به‌روزرسانی رسمی\n\n{title}\n{description}\n\n🔄 {event_type}\n🔗 {link}' },
  { name: 'قیمت محصول', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_price', cta: null, body: '🏷️ {title}\n\nقیمت عادی: {regular_price}\nقیمت ویژه: {sale_price}\nقیمت فعلی: {price}\n\n🔗 {link}' },
  { name: 'وضعیت موجودی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_stock', cta: null, body: '📦 وضعیت موجودی\n\n{title}\n\nوضعیت: {stock_status}\n💰 {price}\n🔗 {link}' },
  { name: 'محصول + کد', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '🧾 {title}\n\nکد محصول: {sku}\nقیمت: {price}\n\n🔗 {link}' },
  { name: 'فروش با قیمت قبل', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'product_price', cta: null, body: '💥 پیشنهاد فروش\n\n{title}\n\nقیمت قبلی: {old_price}\nقیمت ویژه: {sale_price}\nقیمت فعلی: {price}\n\n🔗 خرید: {link}' },
  { name: 'محصول منتخب', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '⭐ محصول منتخب\n\n{title}\n\n{description}\n\n💰 {price}\n🔗 {link}' },
  { name: 'کمپین عمومی', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '🎯 {event_type}\n\n{title}\n{description}\n\n💰 {price}\n🔗 {link}' },
  { name: 'معرفی پرفروش', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'فروش', eventType: 'new', cta: null, body: '🏆 انتخاب محبوب\n\n{title}\n\n{description}\n\n💰 {price}\n🔗 {link}' },
  { name: 'رویداد سایت', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'مناسبتی', eventType: 'new', cta: null, body: '📅 {title}\n\n{description}\n\nسایت: {site_name}\nتاریخ: {date}\n🔗 {link}' },
  { name: 'اعلام کوتاه', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'اطلاع‌رسانی', eventType: 'new', cta: null, body: '🔔 {title}\n\n{description}' },
  { name: 'کارت لینک', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'عمومی', eventType: 'new', cta: null, body: '🔗 {title}\n\n{description}\n\nمشاهده: {link}' },
  { name: 'مطلب + نویسنده', description: 'قالب آمادهٔ منتقل‌شده از بخش ارسال پست', category: 'محتوا', eventType: 'new', cta: null, body: '✍️ {title}\n\n{description}\n\nنویسنده: {author}\n🔗 {link}' },
  { name: 'محصول جدید ووکامرس', description: 'معرفی محصول جدید همراه قیمت و لینک خرید.', category: 'فروش', eventType: 'new', cta: { label: 'مشاهده و خرید', url: '{link}' }, body: '✨ محصول جدید در {site_name}\n\n🛍 {title}\n\n{excerpt}\n\n💰 قیمت: {price}\n\n🔗 مشاهده و خرید:\n{link}' },
  { name: 'محصول تخفیف‌دار', description: 'مناسب اطلاع‌رسانی کاهش قیمت و تخفیف.', category: 'فروش', eventType: 'product_price', cta: { label: 'خرید محصول', url: '{link}' }, body: '🔥 تخفیف ویژه فعال شد\n\n🛍 {title}\n\n💰 قیمت قبل: {regular_price}\n✅ قیمت جدید: {price}\n\n🛒 خرید محصول:\n{link}' },
  { name: 'بروزرسانی محصول دیجیتال', description: 'مناسب افزونه، قالب، فایل دیجیتال و محصولات نسخه‌دار.', category: 'فروش', eventType: 'update', cta: { label: 'مشاهده بروزرسانی', url: '{link}' }, body: '🔄 بروزرسانی محصول\n\n🛍 {title}\n\n🧩 نسخه جدید: {meta:_hw_version}\n\n📝 تغییرات:\n{meta:_hw_changelog}\n\n🔗 دریافت/مشاهده:\n{link}' },
  { name: 'نوشته جدید', description: 'برای انتشار مقاله و محتوای وبلاگ.', category: 'محتوا', eventType: 'new', cta: { label: 'ادامه مطلب', url: '{link}' }, body: '📝 مطلب جدید در {site_name}\n\n{title}\n\n{excerpt}\n\nادامه مطلب:\n{link}' },
  { name: 'اطلاعیه عمومی', description: 'مناسب برگه‌ها، اطلاعیه‌ها و خبرهای عمومی.', category: 'اطلاع‌رسانی', eventType: 'new', cta: { label: 'مشاهده', url: '{link}' }, body: '📢 اطلاعیه جدید\n\n{title}\n\n{excerpt}\n\nمشاهده:\n{link}' },
  { name: 'کوتاه و مینیمال', description: 'قالب ساده برای کانال‌های مینیمال.', category: 'عمومی', eventType: 'new', cta: { label: 'مشاهده', url: '{link}' }, body: '{title}\n\n{link}' },
  { name: 'کانال فروشگاهی', description: 'معرفی فروشگاهی همراه قیمت و موجودی.', category: 'فروش', eventType: 'new', cta: { label: 'جزئیات محصول', url: '{link}' }, body: '🛒 پیشنهاد امروز\n\n{title}\n\n💰 قیمت: {price}\n📦 وضعیت: {stock_status}\n\nبرای مشاهده جزئیات:\n{link}' },
  { name: 'آپدیت افزونه/قالب', description: 'قالب اختصاصی بروزرسانی افزونه و قالب وردپرس.', category: 'فروش', eventType: 'update', cta: { label: 'مشاهده محصول', url: '{link}' }, body: '🚀 نسخه جدید منتشر شد\n\nمحصول: {title}\nنسخه: {meta:_hw_version}\n\nتغییرات:\n{meta:_hw_changelog}\n\nلینک:\n{link}' },
  { name: 'تغییر موجودی محصول', description: 'اعلام تغییر وضعیت موجودی محصول.', category: 'فروش', eventType: 'product_stock', cta: { label: 'مشاهده محصول', url: '{link}' }, body: '📦 تغییر وضعیت موجودی\n\n{title}\nوضعیت: {stock_status}\n\n🔗 {link}' },
];

export interface TemplateInput {
  name: string;
  description?: string | null;
  body: string;
  category?: string;
  isDefault?: boolean;
  settingsJson?: Record<string, unknown> | null;
}

async function ensureBuiltins(tenantId: string): Promise<void> {
  const db = getDb();
  const existingRows = await db.select({ id: messageTemplates.id, name: messageTemplates.name, isDefault: messageTemplates.isDefault, settingsJson: messageTemplates.settingsJson }).from(messageTemplates).where(eq(messageTemplates.tenantId, tenantId));
  const names = new Set(existingRows.map((r) => r.name));
  for (const builtin of BUILTIN_TEMPLATES) {
    const current = existingRows.find((r) => r.name === builtin.name);
    if (current && current.isDefault) {
      const currentSettings = current.settingsJson && typeof current.settingsJson === 'object' ? current.settingsJson as Record<string, unknown> : {};
      const nextSettings = { ...currentSettings, builtin: true, eventType: builtin.eventType, ...(builtin.cta ? { cta: builtin.cta } : {}) };
      const currentCta = currentSettings.cta && typeof currentSettings.cta === 'object' ? JSON.stringify(currentSettings.cta) : null;
      const nextCta = builtin.cta ? JSON.stringify(builtin.cta) : null;
      if (currentSettings.eventType !== builtin.eventType || currentSettings.builtin !== true || (builtin.cta && currentCta !== nextCta)) {
        try { await db.update(messageTemplates).set({ settingsJson: nextSettings }).where(and(eq(messageTemplates.id, current.id), eq(messageTemplates.tenantId, tenantId))); } catch {}
      }
    }
    if (names.has(builtin.name)) continue;
    try {
      await db.insert(messageTemplates).values({
        id: newId(),
        tenantId,
        name: builtin.name,
        description: builtin.description,
        body: builtin.body,
        category: builtin.category,
        isDefault: 1,
        settingsJson: { builtin: true, source: builtin.name === 'محصول جدید ووکامرس' ? 'hamresan-template-library' : 'postyar-template-library', eventType: builtin.eventType, ...(builtin.cta ? { cta: builtin.cta } : {}) },
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code !== 'ER_DUP_ENTRY' && !/Duplicate entry/i.test(String(e?.message ?? ''))) throw err;
    }
  }
}

export async function listTemplates(tenantId: string) {
  await ensureBuiltins(tenantId);
  const db = getDb();
  return db
    .select({
      id: messageTemplates.id,
      name: messageTemplates.name,
      description: messageTemplates.description,
      body: messageTemplates.body,
      category: messageTemplates.category,
      isDefault: messageTemplates.isDefault,
      settingsJson: messageTemplates.settingsJson,
      createdAt: messageTemplates.createdAt,
      updatedAt: messageTemplates.updatedAt,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.tenantId, tenantId))
    .orderBy(desc(messageTemplates.isDefault), asc(messageTemplates.name));
}

export async function createTemplate(tenantId: string, input: TemplateInput) {
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name || !body) throw new AppError(ERR.VALIDATION('نام و متن قالب الزامی است.'));
  const db = getDb();
  const id = newId();
  try {
    await db.insert(messageTemplates).values({
      id,
      tenantId,
      name: name.slice(0, 120),
      description: input.description?.trim().slice(0, 255) || null,
      body: body.slice(0, 12000),
      category: (input.category?.trim() || 'عمومی').slice(0, 40),
      isDefault: input.isDefault ? 1 : 0,
      settingsJson: input.settingsJson ?? null,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) {
      throw new AppError(ERR.CONFLICT('قالبی با این نام قبلاً ثبت شده است.'));
    }
    throw err;
  }
  await audit({ action: 'template.created', actorId: tenantId, subjectType: 'message_template', subjectId: id });
  return id;
}

export async function updateTemplate(tenantId: string, id: string, input: Partial<TemplateInput>) {
  const db = getDb();
  const [row] = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId))).limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('قالب'));
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 120);
  if (input.description !== undefined) patch.description = input.description?.trim().slice(0, 255) || null;
  if (input.body !== undefined) patch.body = input.body.trim().slice(0, 12000);
  if (input.category !== undefined) patch.category = (input.category.trim() || 'عمومی').slice(0, 40);
  if (input.settingsJson !== undefined) patch.settingsJson = input.settingsJson;
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault ? 1 : 0;
  if (!Object.keys(patch).length) return row.id;
  try {
    await db.update(messageTemplates).set(patch as never).where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId)));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) {
      throw new AppError(ERR.CONFLICT('قالبی با این نام قبلاً ثبت شده است.'));
    }
    throw err;
  }
  await audit({ action: 'template.updated', actorId: tenantId, subjectType: 'message_template', subjectId: id });
  return id;
}

export async function deleteTemplate(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ id: messageTemplates.id, isDefault: messageTemplates.isDefault }).from(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId))).limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('قالب'));
  if (row.isDefault) throw new AppError(ERR.CONFLICT('قالب‌های آمادهٔ اصلی قابل حذف نیستند.'));
  await db.delete(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId)));
  await audit({ action: 'template.deleted', actorId: tenantId, subjectType: 'message_template', subjectId: id });
}

export type TemplateRenderContext = Record<string, unknown> & {
  meta?: Record<string, unknown>;
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(renderValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function renderTemplate(body: string, context: TemplateRenderContext): string {
  let output = body;
  const normalized: Record<string, unknown> = { ...context };
  for (const [key, value] of Object.entries(normalized)) {
    if (key === 'meta') continue;
    output = output.replaceAll(`{${key}}`, renderValue(value));
  }
  output = output.replace(/\{meta:([a-zA-Z0-9_-]+)\}/g, (_, key: string) => renderValue(context.meta?.[key]));
  output = output.replace(/\{acf:([a-zA-Z0-9_-]+)\}/g, (_, key: string) => renderValue(context.meta?.[key]));
  output = output.replace(/\{jet:([a-zA-Z0-9_-]+)\}/g, (_, key: string) => renderValue(context.meta?.[key]));
  return output.trim().slice(0, 12000);
}
