# Postyar Release v12 — Content, Templates, Emoji/Sticker, Bots, Analytics, Referrals, Notifications

## مهم
این Release بر Runtime سالم v11 سوار است. Entry اصلی Frontend عمداً `index-v11.js` باقی مانده تا خطای split-runtime نسخه v10 تکرار نشود.

## قابلیت‌های اصلی
- قالب‌های آماده چندگانه + دسته‌بندی + پیش‌نمایش زنده
- کتابخانه داخلی Emoji گسترده: 2810 مقدار یکتا
- Emoji اخیر/محبوب/جستجو و دسته‌بندی‌شده
- Sticker Picker داخلی و ثابت (بدون نوار Footer)
- Packهای Sticker داخلی با تب جداگانه برای هر مجموعه
- دسته‌بندی داخلی هر Pack بر اساس Emoji و تعداد آیتم
- افزودن Pack عمومی Telegram داخل همان Popup
- ذخیره Packها به تفکیک Tenant
- نگهداری Bot واردکننده هر Pack در DB
- اضافه‌شدن Sticker انتخابی به Media Library در PostNew/WooCommerce
- Wizard ساده ساخت/اتصال Bot
- Analytics قابل کلیک با Modal جزئیات
- Referral details Popup
- Notification center + notification preferences + Admin Bell

## Migration جدید
`0025_telegram_sticker_bot_binding.sql`
- افزودن `telegram_sticker_sets.bot_id`
- Index تنانت/بات
- بدون حذف داده
- بدون DROP/TRUNCATE/DELETE

## تست‌های انجام‌شده
- Syntax همه 69 فایل TS/TSX Frontend: OK
- Syntax همه JSهای public: OK
- CSS parse برای CSSهای اصلی: OK
- Asset graph: بدون reference به `index-CjIBK3lx` و `index-v9`
- HTTP local smoke برای `/`, `index-v11.js`, `content-tools-v14.js`, `ux-v12.css`, `emoji-library.js`: HTTP 200
- Schema/Sticker/WordPress runtime از Source به Dist transpile و `node --check` شدند

## محدودیت تست
Full typecheck/build و browser E2E در این محیط به dependency/browser runtime محدود بود و موفقیت جعلی برای آن‌ها اعلام نشده است.

## منبع Sticker/Emoji
فهرست منابع معرفی‌شده توسط کاربر بررسی شده است. Emoji images در Emojipedia تحت حقوق صاحبان مربوطه هستند؛ مخزن `tgbot-collection/stickers` یک downloader با GPLv3 است. Release تصاویر شخص ثالث را به‌صورت انبوه بازتوزیع نمی‌کند؛ Pack کامل انتخابی از Telegram با Bot API دریافت و در کتابخانه داخلی Tenant ذخیره می‌شود.
