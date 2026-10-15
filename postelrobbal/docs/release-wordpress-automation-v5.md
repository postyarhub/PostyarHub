# Postyar — WordPress/WooCommerce Automation Release v6

## اجزای این بسته

- هستهٔ Postyar با درگاه WinaPay و Providerهای قبلی.
- اتصال WordPress/WooCommerce با API عمومی امن و Site Key/Secret.
- افزونهٔ قابل نصب `wordpress-plugin/postyar-wordpress/`.
- migration `0015_wordpress_simple_automation.sql` برای تنظیمات سادهٔ ارسال.
- migration `0016_wordpress_content_idempotency.sql` برای جلوگیری از انتشار تکراری نوشته/برگه.
- migration `0017_repair_woocommerce_feature_flags.sql` برای ترمیم امن فلگ قابلیت ووکامرس در پلن‌های حرفه‌ای/تجاری/سازمانی.
- endpointهای تنظیمات و webhook وردپرس.
- پیام‌های ساده و آماده برای محصول و محتوای WordPress.
- پشتیبانی از تغییرات محصول و Variation در WooCommerce.
- جلوگیری از زمان‌بندی تکراری رویدادهای WordPress.

## نصب افزونه

فایل مستقل افزونه را در WordPress از مسیر «افزونه‌ها → افزودن → بارگذاری افزونه» نصب کنید. پس از فعال‌سازی، منوی «پست‌یار» در پیشخوان نمایش داده می‌شود.

## اتصال

از Dashboard پست‌یار:

1. وارد «ووکامرس» شوید.
2. «اتصال سایت جدید» را بزنید.
3. آدرس سایت را وارد کنید.
4. «کد اتصال» یک‌بار نمایش داده می‌شود.
5. افزونه را در WordPress نصب کنید و همین کد را در «پست‌یار» وارد کنید.
6. پس از اتصال، کانال‌ها و نوع ارسال را انتخاب کنید.

## Migration

Migrationها مخرب نیستند و فقط ساختار/تنظیمات لازم را به صورت افزایشی اضافه می‌کنند.

```bash
export PATH="/opt/cpanel/ea-nodejs22/bin:$PATH"
cd /home/postyarh/postelrobbal/app
MIGRATIONS_DIR=/home/postyarh/postelrobbal/database/migrations \
/opt/cpanel/ea-nodejs22/bin/node \
-r ../config/load-env.cjs \
dist/db/migrate-cli.js
```

## Restart

```bash
touch /home/postyarh/postelrobbal/api/tmp/restart.txt
```

## بعد از نصب

در WordPress تنظیمات ارسال به زبان ساده ارائه می‌شود:

- محصول جدید
- تغییر قیمت
- تغییر موجودی
- ویرایش محصول
- نوشته/برگه جدید
- ویرایش نوشته/برگه
- کانال‌های مقصد
- شکل پیام
- ارسال تصویر محصول

کاربر نیازی به Shortcode، API Key یا تنظیمات کدنویسی ندارد.

## شرایط پلن

اتصال WordPress/WooCommerce طبق سیاست فعلی قابلیت پلنی `woocommerce` است؛ رایگان و پایه آن را ندارند و حرفه‌ای/تجاری/سازمانی دارند. در صورت عدم دسترسی، سرور اکنون پیام دقیق و کاربرپسند مربوط به پلن را برمی‌گرداند.

## وضعیت قابلیت‌های هم‌رسان

در این release، لایه WordPress/WooCommerce، automation اولیه، connection UX، idempotency و queue integration عملی شده‌اند.

Template Library مستقل، Campaign Engine کامل، Click/UTM Analytics، Emoji/Sticker Library و گزارش‌های Campaign همچنان باید در لایهٔ اصلی Dashboard Postyar توسعه پیدا کنند و در این release عمداً به عنوان قابلیت نهایی ادعا نشده‌اند.

## اعتبارسنجی انجام‌شده

- `php -l` برای تمام فایل‌های افزونه.
- `node --check` برای runtimeهای JavaScript اصلاح‌شده.
- transpile سطح TypeScript/TSX برای فایل‌های اصلاح‌شده به عنوان جایگزین type-check کامل در محیطی که `node_modules` کامل نبود.
- بررسی ساختار ZIP و checksum.

یک تست زندهٔ متصل به WordPress واقعی، DB واقعی و کانال واقعی در محیط ساخت انجام نشده است؛ بنابراین چنین تستی به عنوان انجام‌شده اعلام نمی‌شود.
