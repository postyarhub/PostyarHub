# اتصال درگاه ویناپی در Postyar

این اتصال بر پایه مستندات رسمی ویناپی که در `https://winapay.io/public/document` منتشر شده ساخته شده است.

## قرارداد API

- PaymentRequest: `POST https://winapay.io/webservice/rest/PaymentRequest`
- PaymentVerification: `POST https://winapay.io/webservice/rest/PaymentVerification`
- فیلدهای لازم درخواست: `MerchantID`, `Amount`, `CallbackURL`
- `Amount` در مستندات ویناپی «تومان» است؛ Postyar مبلغ را داخلی به «ریال» نگه می‌دارد.
- Postyar فقط مبالغ صحیح ریالیِ مضرب ۱۰ را برای ویناپی می‌پذیرد و پیش از Request/Verify آن را دقیقاً بر ۱۰ تقسیم می‌کند.
- `InvoiceID` برابر شناسه تراکنش Postyar ارسال می‌شود تا Callback بتواند بدون اتکا به کوکی یا session تراکنش را پیدا کند.
- اگر `PaymentUrl` معتبر HTTPS از سرویس برگردد همان استفاده می‌شود؛ در غیر این صورت مسیر `https://winapay.io/startPay/{Authority}` ساخته می‌شود.
- Callback ویناپی به‌صورت POST نیز پشتیبانی می‌شود و فیلدهای `PaymentStatus`, `Authority`, `InvoiceID` را می‌پذیرد.
- Verify همیشه روی سرور انجام می‌شود و نتیجه مرورگر مبنای تسویه نیست.
- Verify همان مبلغِ تومان‌شده را دوباره به سرویس می‌فرستد و در صورت وجود مبلغ برگشتی، اختلاف مبلغ را رد می‌کند.
- Status موفق Verify فقط `100` است.

## تنظیم در پنل Postyar

1. پرداخت آنلاین را فعال کنید.
2. درگاه پیش‌فرض را روی «ویناپی» قرار دهید.
3. Merchant ID دریافت‌شده از پنل ویناپی را وارد کنید.
4. تنظیمات را ذخیره کنید.

مستندات منتشرشده ویناپی یک جفت endpoint برای Request/Verification ارائه می‌کنند و محیط Sandbox مستقل در همین مستندات معرفی نشده است؛ بنابراین Postyar برای ویناپی یک Sandbox صوری اضافه نکرده است.

## مسیر Callback

Postyar از مسیر فعلی زیر برای Callback استفاده می‌کند و POST و GET هر دو را می‌پذیرد:

`/api/v1/payments/callback`

در PaymentRequest همین CallbackURL برای تراکنش ارسال می‌شود. تمام مراحل اعتبارسنجی، Verify، ثبت تراکنش و تسویه از مسیر موجود PaymentService عبور می‌کنند و مسیر مالی جداگانه‌ای برای ویناپی ساخته نشده است.

## نکته امنیتی

Merchant ID فقط در تنظیمات سمت سرور ذخیره و از API مدیریت پرداخت خوانده می‌شود. تسویه فقط پس از Verify سمت سرور انجام می‌شود. Callback خامِ مرورگر هرگز به‌تنهایی وضعیت `VERIFIED` ایجاد نمی‌کند.
