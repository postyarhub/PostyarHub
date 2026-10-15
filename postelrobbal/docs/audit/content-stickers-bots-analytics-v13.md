# ممیزی فایل‌به‌فایل — Content / Stickers / Bots / Analytics V13

تاریخ: ۱۴۰۵/۰۷/۰۷ — 2026-09-29
مبنای اصلاح: V12 موجود در Library و درخواست نهایی جلسه قبل

## نتیجه

V13 یک ادامهٔ مستقیم V12 است و به‌جای ایجاد یک سیستم موازی، Runtime فعال را به یک Picker داخلی واحد تبدیل می‌کند. منوی مستقل کتابخانه استیکر از ناوبری حذف شده، اما Route قدیمی برای سازگاری Bookmark نگه داشته شده است.

## کنترل‌های کلیدی

- قالب آماده: ۱۰ قالب، دسته‌بندی، پیش‌نمایش و اعمال در همان Popup.
- Emoji: کتابخانه Unicode داخلی با دسته‌بندی، جست‌وجو، اخیر و علاقه‌مندی.
- Sticker / Custom Emoji: پک‌های واردشدهٔ Tenant، تب مستقل برای هر پک، فیلتر بر اساس emoji، جست‌وجو و Import داخل همان Popup.
- Telegram Import: انتخاب صریح Bot فعال؛ پذیرش `addstickers` و `addemoji`.
- رسانه: `WEBM` پذیرفته و با امضای EBML بررسی می‌شود؛ TGS از thumbnail تلگرام برای Preview استفاده می‌کند.
- PostNew/WooCommerce: انتخاب Sticker یک Event قابل لغو منتشر می‌کند و Listener در مسیرهای پشتیبان قبل از عملیات async، `preventDefault()` را اعمال می‌کند تا درج fallback ایموجی دوباره انجام نشود.
- Bots: Edit برای Command و Keyword + Modal کاربر Bot.
- Analytics: بازه انتخابی ۷/۳۰/۶۰/۹۰ روز در Backend و Frontend همسان شده است.
- Referrals: Popup مشخصات کامل کاربر موجود است.
- Notifications: فیلتر همه/خوانده‌نشده، خواندن همه، جزئیات و Preferences موجود است.

## Runtime integrity

- در ورودی فعال `public_html/index.html` فقط `content-tools-v15.js` فعال است.
- `content-tools-v12.js` و `content-tools-v14.js` از Release حذف شده‌اند.
- `ux-v11.js` دیگر از ورودی فعال لود نمی‌شود؛ بنابراین Picker قدیمی با Picker V15 رقابت نمی‌کند.
- منوی `کتابخانه استیکر` در `Layout.tsx` و Runtime تولیدشده وجود ندارد.
- `0026_telegram_sticker_format_metadata.sql` افزایشی و idempotent است و برای metadata فرمت Sticker استفاده می‌شود.

## Validation limits

Syntax validation روی JavaScriptهای production موفق است. Semantic TypeScript typecheck کامل و Browser E2E کامل در محیط فعلی قابل اتکا نبودند و به‌عنوان موفقیت اعلام نشده‌اند.
