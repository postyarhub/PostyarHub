# ممیزی موشکافانه و اجرای قابلیت‌های محتوا، استیکر، ربات، تحلیل و اعلان — v12

تاریخ: 2026-09-28
مبنای کار: Source فعلی Postyar + ممیزی فایل‌به‌فایل افزونه هم‌رسان هومن وب 2.28.1

## 1) قالب‌های آماده و پیش‌نمایش

### Source
- `frontend/src/pages/dashboard/WooCommerce.tsx`
  - تب قالب پیام
  - دسته‌بندی قالب‌ها
  - فهرست قالب‌های آماده
  - Preview داخل Modal
  - Preview زنده هنگام ویرایش
  - جلوگیری از حذف قالب‌های پیش‌فرض
- `app/src/modules/wordpress/wordpress.service.ts`
  - `DEFAULT_WORDPRESS_TEMPLATES`
  - تضمین وجود قالب‌های پیش‌فرض برای کاربران قدیمی
  - Rendering بر اساس تنظیمات قالب

### قالب‌های آماده
- معرفی محصول
- فروش ویژه
- محصول جدید
- موجود شد
- ناموجود شد
- کاهش قیمت
- پرفروش‌ها
- مقاله جدید
- خبر کوتاه
- مینیمال

این بخش از الگوی `class-hwp-hamresan-template.php` و preview آن اقتباس مفهومی شده و UI اختصاصی WordPress افزونه کپی نشده است.

## 2) کتابخانه داخلی Emoji/Sticker

### Source
- `frontend/src/emoji-library.ts`
  - کتابخانه Unicode گسترده با 2810 مقدار یکتا
  - دسته‌های چهره، افراد، حیوانات و طبیعت، غذا، ورزش، سفر، اشیا، نمادها، پرچم‌ها و همه
- `public_html/assets/gen/emoji-library.js`
  - Runtime متناظر
- `public_html/assets/content-tools-v14.js`
  - Popup ثابت و مستقل از Footer
  - فعال شدن روی فیلدهای محتوایی
  - تب Emoji / Sticker
  - جست‌وجو، اخیر و علاقه‌مندی
  - دسته‌بندی Emoji
  - دسته‌بندی/تب هر Pack واردشده
  - افزودن Pack جدید داخل همان Popup

### Backend
- `app/src/modules/stickers/sticker.service.ts`
- `app/src/modules/stickers/sticker.routes.ts`
- `app/src/db/schema.ts`
- `database/migrations/0025_telegram_sticker_bot_binding.sql`

### اصلاح مهم
شناسه Bot واردکننده هر Pack در `telegram_sticker_sets.bot_id` ذخیره می‌شود تا دریافت File ID بعداً الزاماً با همان Bot انجام شود و استفاده از Bot اشتباه باعث شکست تصادفی نشود.

### منابع خارجی استفاده‌شده
منابعی که کاربر معرفی کرده بود برای catalog/reference بررسی شدند. تصاویر Emoji در Emojipedia تحت حقوق صاحبان مربوطه هستند و مخزن `tgbot-collection/stickers` یک ابزار GPLv3 برای دانلود مجموعه‌هاست؛ بنابراین همه تصاویر شخص ثالث به‌صورت انبوه داخل Release بازتوزیع نشده‌اند. Import داخلی از خود Telegram API انجام می‌شود و کاربر می‌تواند Pack انتخابی را کامل به کتابخانه Tenant خودش وارد کند.

## 3) رفع مشکل ظاهر Sticker Picker

Picker دیگر در Footer یا به‌صورت نوار کشیده رندر نمی‌شود. Popup با `position: fixed` به `document.body` اضافه می‌شود و جای خود را بر اساس فیلد فعال محاسبه می‌کند.

## 4) چسباندن واقعی Sticker به پیام

### `frontend/src/pages/dashboard/PostNew.tsx`
- رویداد `postyar:sticker-select` را دریافت می‌کند.
- فایل داخلی Sticker را می‌گیرد.
- آن را به Media Library فعلی Postyar Upload می‌کند.
- Media به عنوان رسانه پیام ثبت می‌شود.

### `frontend/src/pages/dashboard/WooCommerce.tsx`
- همان مسیر را برای ویرایش محصول/نوشته دارد.
- Sticker انتخابی به Media Library داخلی تبدیل و به ویرایشگر متصل می‌شود.

در فیلدهای صرفاً متنی، Emoji همچنان به‌صورت متن Unicode درج می‌شود؛ Sticker برای انتشار نیازمند یک جایگاه Media است.

## 5) ربات‌ها

### `frontend/src/pages/dashboard/Bots.tsx`
- Wizard سه مرحله‌ای
- انتخاب پلتفرم با نام فارسی
- راهنمای اختصاصی هر پلتفرم
- ورود Token
- Verify / Enable / Disable
- فیلتر همه/فعال/نیازمند بررسی
- مسیر مدیریت کامل ربات

### `frontend/src/pages/dashboard/BotDetail.tsx`
- مدیریت Commandها
- Keywordها
- کاربران ربات
- آمار
- AI behavior
- Capability detection
- Response Builder

این بخش از مفاهیم مدیریت sender/bot در هم‌رسان به معماری فعلی Bot Postyar نگاشت شده است.

## 6) تحلیل و آمار

### `frontend/src/pages/dashboard/Analytics.tsx`
- بازه 7/30/60/90 روز
- کارت‌های قابل کلیک
- نمودار روزانه قابل کلیک
- تفکیک کانال و پلتفرم
- Posts و وضعیت انتشار
- Events
- Popup جزئیات

### سبک
`public_html/assets/ux-v12.css` برای کارت‌ها، نمودارها، لیست‌ها و Modalها اعمال شده است.

## 7) زیرمجموعه‌گیری

### `frontend/src/pages/dashboard/Referrals.tsx`
- فهرست کاربران قابل کلیک
- Popup اطلاعات کامل کاربر
- اشتراک
- وضعیت حساب
- کسب‌وکار
- تاریخ‌ها
- پاداش‌ها و امتیازها

## 8) اعلان‌ها

### `frontend/src/pages/dashboard/Notifications.tsx`
- همه / خوانده‌نشده
- خواندن همه
- جزئیات در Modal
- تنظیمات دسته‌بندی اعلان

### `frontend/src/components/AdminBell.tsx`
- Bell مدیر
- تعداد unread
- تفکیک پرداخت، تیکت، کاربر جدید
- deep-link
- Popup مدیریتی
- علامت‌گذاری seen

## 9) Asset/Runtime Integrity

- همه 69 فایل TS/TSX با transpile syntax validation بررسی شدند: 0 خطای syntax.
- همه فایل‌های JS عمومی با `node --check`: موفق.
- CSSهای کلیدی با PostCSS parse: موفق.
- هیچ reference به Entry قدیمی `index-CjIBK3lx` یا `index-v9` در Asset Graph باقی نمانده است.
- فایل‌های اصلی استاتیک از طریق HTTP محلی با status 200 خوانده شدند.
- `app/dist` برای schema، sticker service/routes و WordPress service از Source فعلی دوباره transpile شد.

## 10) محدودیت‌های تست محیط

- Full `npm run typecheck` پروژه به‌دلیل ناقص بودن dependency graph فعلی محیط build قابل اتکا نیست؛ موفقیت typecheck ادعا نمی‌شود.
- اجرای کامل browser E2E در این محیط با Chromium به timeout/zygote-GPU محدود شد؛ از آن نتیجه‌گیری مثبت جعلی ارائه نشده است.

## 11) Migration

`0025_telegram_sticker_bot_binding.sql`
- additive
- non-destructive
- idempotent برای column و index
- بدون DROP/TRUNCATE/DELETE
