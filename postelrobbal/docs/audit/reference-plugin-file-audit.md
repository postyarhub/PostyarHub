# ادامه ممیزی فایل‌به‌فایل افزونه هم‌رسان و نگاشت آن به Postyar

## دامنه ممیزی

مرجع ممیزی فایل `hwp-hamresan.zip` با 23 فایل واقعی است. پروژه هدف، نسخه Hotfix فعلی Postyar است. اصل معماری این ممیزی این است که رفتار موجود Postyar حفظ شود و قابلیت‌های مفید افزونه روی ساختار فعلی سوار شوند، نه اینکه معماری WordPress/Cron/Options افزونه کپی شود.

## یافته‌های فایل‌به‌فایل افزونه مرجع

| فایل | نقش مشاهده‌شده | تصمیم برای Postyar |
|---|---|---|
| `hwp-hamresan.php` | bootstrap، activation، load کلاس‌ها | کپی نشود؛ lifecycle در bootstrap فعلی Postyar باقی بماند. |
| `includes/class-hwp-hamresan-admin.php` | بزرگ‌ترین لایه UI، تب‌ها، فرم‌ها، AJAX، CSV | رفتارها استخراج شوند؛ UI در Dashboard فعلی Postyar پیاده شود. |
| `includes/class-hwp-hamresan-settings.php` | تنظیمات nested، مقصدها، UTM، tracking، sending limits | به تنظیمات tenant-scoped و subscription/feature limits موجود Postyar نگاشت شود. |
| `includes/class-hwp-hamresan-template.php` | موتور تگ‌های پیام و Preview | الگوی اصلی برای Template Library؛ با DB و Preview مستقل از WordPress. |
| `includes/class-hwp-hamresan-core.php` | تشخیص publish/update/price/stock با snapshot | منطق رویداد به WordPress webhook/sync و AutomationRule متصل شود؛ snapshot WordPress کپی نشود. |
| `includes/class-hwp-hamresan-sender.php` | adapterهای Telegram/Bale/Rubika/WhatsApp/Custom، UTM، دکمه | Provider abstraction فعلی Postyar مرجع اصلی است؛ sender یکپارچه جایگزین نشود. |
| `includes/class-hwp-hamresan-queue.php` | جدول queue و WP-Cron و retry | BullMQ/outbox و delivery worker فعلی Postyar حفظ شود؛ جدول queue موازی نسازیم. |
| `includes/class-hwp-hamresan-campaigns.php` | کمپین، انتخاب محصول، زمان‌بندی روزانه/هفتگی، dedup با sent_ids | به Campaign/CampaignRun + scheduler فعلی نگاشت شود؛ dedup باید DB-idempotent باشد. |
| `includes/class-hwp-hamresan-clicks.php` | link token، redirect، click log، IP hash، bot detection، CSV | روی `link_clicks` فعلی و گزارش tenant-scoped ارتقا یابد؛ داده خام IP ذخیره نشود. |
| `includes/class-hwp-hamresan-logger.php` | گزارش ارسال سفارشی، filter و CSV | از delivery report/postTargets استفاده شود؛ log موازی برای موفقیت/خطای ارسال نسازیم. |
| `includes/class-hwp-hamresan-metabox.php` | تنظیم disable auto داخل Post editor | در Postyar لازم نیست؛ تنظیمات پست از Dashboard/Automation کنترل شود. |
| `includes/class-hwp-hamresan-license.php` | لایسنس دامنه‌ای افزونه | با subscription/tenant فعلی Postyar جایگزین شود. |
| `includes/class-hwp-hamresan-updater.php` | updater وردپرس | خارج از معماری Postyar؛ کپی نشود. |
| `assets/js/admin.js` | AJAX و رفتارهای UI افزونه | فقط الگو؛ منطق به React/frontend فعلی منتقل شود. |
| `assets/css/admin.css` | استایل پنل WordPress | کپی نشود؛ design system فعلی Postyar استفاده شود. |
| `assets/img/logo.svg` | لوگوی افزونه | خارج از scope هسته ارسال. |
| `assets/img/logo-mark.svg` | mark | خارج از scope هسته ارسال. |
| `assets/img/menu-icon.svg` | آیکن منو | خارج از scope هسته ارسال. |
| `documentation.html` | راهنمای داخلی افزونه | محتوا قابل اقتباس است؛ UI مستندات در Postyar جدا باقی بماند. |
| `product-page-copy.md` | معرفی محصول و use-caseها | منبع نیازمندی، نه کد اجرایی. |
| `readme.txt` | نصب/FAQ/قابلیت‌ها | مرجع مستنداتی. |
| `release-checklist.md` | سناریوهای انتشار و regression | ساختار checklist برای release Postyar مفید است، اما تست‌های WordPress عیناً کپی نشوند. |
| `CHANGELOG.md` | تاریخچه قابلیت‌ها | الگوی نگهداری release notes. |

## قابلیت‌هایی که از افزونه استخراج می‌شوند

### Template Library

تگ‌های ارزشمند افزونه شامل عنوان، خلاصه، محتوا، لینک، نویسنده، تصویر شاخص، قیمت، قیمت اصلی، قیمت فروش، SKU، موجودی و فیلد سفارشی هستند. این‌ها باید در Postyar داخل یک Template Library tenant-scoped با Preview سمت سرور پیاده شوند؛ در این مرحله، این بخش به‌عنوان نگاشت معماری و نیازمندی ممیزی ثبت شده و جایگزین ساختار فعلی پروژه نشده است.

### Automation Rules

چهار trigger اصلی افزونه فقط نقطه شروع هستند: محتوای جدید، بروزرسانی، تغییر قیمت و تغییر موجودی. در Postyar triggerها باید مستقل از WordPress storage باشند تا Gold، WooCommerce و منابع بعدی نیز بتوانند از همان engine استفاده کنند.

### Campaigns

Selectionهایی مانند newest، recently updated، random، sale، featured، in-stock، out-of-stock و best-selling مستقیماً برای WooCommerce قابل استفاده‌اند. اجرای کمپین باید slot-idempotent باشد؛ `sent_ids` به تنهایی برای سرویس چند worker کافی نیست.

### Queue

WP-Cron افزونه برای Postyar جایگزین مناسبی نیست، چون Postyar همین حالا scheduler/worker/outbox دارد. هدف، یک صف عملیاتی واحد و قابل retry است، نه دو queue مستقل.

### Click Analytics

پیاده‌سازی افزونه یک token redirect، hash IP، referrer و user-agent و CSV دارد. در Postyar همین ایده باید با tenant isolation، گزارش تجمیعی، series زمانی و export متصل به `link_clicks` موجود اجرا شود.

### گزارش‌ها

گزارش ارسال باید از یک منبع canonical بیاید: `posts` + `post_targets` + `channels`. پاک‌کردن گزارش بهتر است soft-hide باشد تا شواهد عملیاتی و امکان audit از بین نرود.

### Emoji / Sticker Library

Emojiهای استاندارد می‌توانند به صورت system assets seed شوند. Stickerها باید منبع مشخص داشته باشند؛ برای Telegram می‌توان از Bot API و Sticker Set استفاده کرد. برای providerهای دیگر نباید رفتار Telegram را تقلید کرد.

## شاخه پرداخت: ادامه ممیزی روی Postyar

فایل‌های اصلی درگاه که بررسی و در WinaPay در همان abstraction توسعه داده شدند:

- `app/src/providers/payments/zarinpal.ts` — قرارداد Gateway و CreatePaymentInput؛ برای نگه‌داشتن `invoiceId` توسعه داده شد.
- `app/src/providers/payments/zibal.ts` — Provider موجود؛ بدون تغییر رفتاری.
- `app/src/providers/payments/idpay.ts` — Provider موجود؛ بدون تغییر رفتاری.
- `app/src/providers/payments/winapay.ts` — Adapter جدید REST.
- `app/src/modules/payments/payment-settings.service.ts` — تنظیم Merchant ID و merge/validation.
- `app/src/modules/payments/payment.service.ts` — registry/factory، انتخاب provider و Verify سرور.
- `app/src/modules/payments/payment.routes.ts` — Callback مشترک GET/POST.
- `app/src/modules/admin/admin.routes.ts` — validation تنظیمات و provider.
- `frontend/src/pages/admin/AdminGateways.tsx` — انتخاب WinaPay و Merchant ID.
- `frontend/src/pages/admin/AdminPayments.tsx` — label فارسی provider.
- `database/migrations/0014_winapay_gateway.sql` — migration افزایشی و idempotent.

### چرخه WinaPay در Postyar

`PaymentIntent -> payments.gateway=winapay -> PaymentRequest -> Authority -> redirect -> POST Callback -> lookup by InvoiceID -> server Verify -> VERIFIED/settle`

هیچ شاخه مالی موازی برای WinaPay ساخته نشده است.

## مواردی که عمداً انجام نشد

- ساخت Sandbox جعلی برای WinaPay، چون مستندات منتشرشده محیط Sandbox جداگانه معرفی نمی‌کنند.
- تغییر Providerهای فعلی Zibal/Zarinpal/IDPay.
- ساخت queue موازی WordPress.
- انتقال credentialها به frontend.
- اعتماد به PaymentStatus مرورگر بدون Verify سمت سرور.
- ذخیره IP خام کاربر برای click analytics.

## وضعیت release

فایل‌های worker release برای `0755` تنظیم شده‌اند تا خطای `Permission denied` که در release قبلی برای `restart-worker.sh` دیده شد، در بسته جدید تکرار نشود.

## وضعیت اجرایی پس از Batch WordPress/Automation

### پیاده‌سازی‌شده در این مرحله

- افزونهٔ واقعی و مستقل WordPress با ساختار استاندارد قابل نصب ساخته شد.
- مسیر اتصال از دو فیلد فنی به یک «کد اتصال» ساده برای کاربر تبدیل شد.
- APIهای عمومی Settings و WordPress Webhook به هستهٔ Postyar افزوده شدند.
- تنظیمات سادهٔ ارسال شامل روشن/خاموش بودن ارسال، رویدادهای محصول و محتوا، انتخاب کانال، سبک پیام و ارسال تصویر اضافه شد.
- ارسال خودکار محصول جدید، تغییر قیمت، تغییر موجودی و بروزرسانی محصول پیاده شد.
- ارسال خودکار نوشته و برگهٔ جدید/ویرایش‌شده به صورت تنظیم‌پذیر اضافه شد.
- همگام‌سازی WooCommerce به صورت idempotent پیاده شد و شکست انتشار باعث از دست رفتن snapshot نمی‌شود؛ بنابراین امکان retry طبیعی باقی می‌ماند.
- ارسال دستی و گروهی تا ۲۰ محصول در افزونه اضافه شد؛ این مسیر به ارسال خودکار وابسته نیست.
- idempotency دائمی برای نوشته/برگه در جدول جداگانه اضافه شد تا تکرار webhook یک محتوای یکسان را دوباره منتشر نکند.
- محصولات WooCommerce و تغییرات Variation به محصول والد نگاشت می‌شوند تا یک Variation جداگانه به‌عنوان محصول مستقل منتشر نشود.
- برای جلوگیری از ایجاد رویدادهای تکراری در WordPress، زمان‌بندی یک رویداد با `wp_next_scheduled` کنترل می‌شود.
- Queue و Worker موازی WordPress ساخته نشد؛ انتشار همچنان از `posts`، `post_targets`، `outbox_events` و Worker فعلی Postyar عبور می‌کند.

### هنوز پیاده‌سازی کامل نشده و نباید به عنوان قابلیت فعال معرفی شود

- Template Library کامل داخل Dashboard با ویرایشگر بصری و Preview مستقل.
- Campaign Engine کامل با انتخاب newest/recent/random/sale/featured/in-stock/out-of-stock/best-selling و زمان‌بندی روزانه/هفتگی.
- ارسال دستی/گروهی WooCommerce از Dashboard.
- Click Analytics کامل با UTM، series، فیلتر و CSV.
- Emoji Library و Sticker Library مشترک.
- گزارش مدیریتی اختصاصی WordPress/Campaign با فیلتر و export.

این موارد همچنان مرحلهٔ بعدی هستند و در release فعلی عمداً به عنوان «کامل» اعلام نمی‌شوند.
