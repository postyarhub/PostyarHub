# راهنمای عملیاتی پُست‌یار — Release 013 / v4

## معماری پردازش

Passenger فقط API را اجرا می‌کند. پردازش انتشار، رویداد ربات‌ها، پردازش‌های کمکی و Polling ربات‌ها در `worker` مستقل اجرا می‌شود. `scheduler` نیز یک اجرای کوتاه و زمان‌بندی‌شده است و با Redis lock هم‌پوشانی چند اجرا را مهار می‌کند.

## فعال‌سازی روی cPanel

```bash
cd /home/postyarh/postelrobbal
chmod 755 scripts/activate-workers.sh workers/run-worker.sh scheduler/run-scheduler.sh
/home/postyarh/postelrobbal/scripts/activate-workers.sh
```

Passenger با ایجاد این فایل علامت restart می‌گیرد:

```bash
mkdir -p /home/postyarh/postelrobbal/api/tmp
touch /home/postyarh/postelrobbal/api/tmp/restart.txt
```

## راه‌اندازی امن مدیر اولیه

ثبت‌نام عمومی دیگر نقش «مدیر ارشد» را به اولین ثبت‌نام‌کننده نمی‌دهد؛ ثبت‌نام معمولی فقط حساب USER می‌سازد. برای نصب تازه یا بازیابی وضعیت قدیمی که هیچ مدیر ارشدی ندارد:

1. در محیط امن API، متغیر `BOOTSTRAP_ADMIN_SECRET` را با یک مقدار تصادفی محرمانه با حداقل ۳۲ نویسه تنظیم کنید. این مقدار را داخل سورس، URL، لاگ یا چت عمومی قرار ندهید.
2. درخواست زیر را فقط از طریق HTTPS و به endpoint همان نصب ارسال کنید:
   `POST /api/v1/auth/bootstrap-admin`
3. بدنهٔ JSON باید اطلاعات ثبت‌نام معمولی (`firstName`, `lastName`, `mobile`, `email`, `businessName`, `businessType`, `password`, `passwordRepeat`, `acceptTerms: true`) و فیلد `bootstrapSecret` را داشته باشد. اگر CAPTCHA در تنظیمات امنیتی فعال باشد، `captchaId` و `captchaText` معتبر نیز لازم‌اند.
4. پس از دریافت پاسخ موفق و اطمینان از ورود به حساب مدیر ارشد، متغیر `BOOTSTRAP_ADMIN_SECRET` را از محیط API حذف کنید و API را طبق روش معمول همین استقرار restart کنید.

این مسیر علاوه بر راز سروری، نرخ درخواست محدود و claim تراکنشی یکتای DB دارد. وجود مدیر ارشد فعال، استفادهٔ مجدد از مسیر راه‌اندازی را مسدود می‌کند. اگر secret تنظیم نشده باشد یا کوتاه‌تر از ۳۲ نویسه باشد، این مسیر دسترسی نمی‌دهد.
## Worker

یک Worker اصلی باید همیشه فعال باشد. این Worker علاوه بر Delivery و queueهای دیگر، ربات‌های دارای حالت `POLLING` را نیز از طریق `botPolling.worker.ts` دریافت می‌کند. Polling برای هر ربات با کلید Redis مستقل قفل می‌شود و offset آن نیز در Redis نگهداری می‌شود.

ربات‌های `WEBHOOK` توسط polling پردازش نمی‌شوند. تغییر حالت به Webhook فقط پس از موفقیت ثبت Webhook در Provider در DB ذخیره می‌شود؛ برگشت به Polling ابتدا Webhook سمت Provider را حذف می‌کند.

## نگهداری و پاک‌سازی

Scheduler روزانه یک Job با شناسهٔ یکتا برای `maintenance` ایجاد می‌کند. Worker همان Job را با پاک‌سازی محدود و Reaper داده‌های موقت اجرا می‌کند؛ Job روزانه است و در Redis بیش از یک‌بار برای همان روز ساخته نمی‌شود.

## انتشار

چرخه اصلی: `posts -> post_targets -> outbox -> BullMQ/Redis -> delivery.worker -> Provider`. هر Target قبل از ارسال به شکل اتمیک `PROCESSING` می‌شود. Targetهای `PENDING` برای پست‌های `QUEUED/PUBLISHING` توسط Scheduler قابل بازیابی‌اند. Targetی که بیش از ۱۰ دقیقه در `PROCESSING` بماند به `FAILED/WORKER_STALE` می‌رود تا قبل از Retry انسانی، احتمال ارسال تکراری بررسی شود.

Retry دستی `FAILED` یک چرخه تازه ایجاد می‌کند، شمارنده تلاش را صفر می‌کند و Outbox تراکنشی می‌سازد؛ enqueue فوری فقط مسیر سریع است و منبع اتکای بازیابی، DB است.

## اتصال کانال و ربات

اگر `channel.botId` تعیین شده باشد، Delivery فقط همان ربات فعال tenant و همان پلتفرم را می‌پذیرد. اگر botId تهی باشد، سیستم از ربات فعال اخیر همان پلتفرم استفاده می‌کند؛ برای محیطی با چند ربات، binding صریح ترجیح دارد. ویرایش کانال با حذف botId کانال را به `PENDING_VERIFY` برمی‌گرداند تا وضعیت سلامت قبلی به‌صورت نادرست حفظ نشود.

## نکته مهم

اعتبار واقعی Token، دسترسی Bot به Channel و موفقیت Provider باید روی سرور واقعی بررسی شود. این بسته صرفاً source و runtime artifact اصلاح‌شده را تحویل می‌دهد و نباید به‌عنوان اثبات ارسال واقعی بیرونی تلقی شود.
