(function () {
  'use strict';
  var status = document.getElementById('pricing-status');
  var mount = document.getElementById('pricing-plans');
  if (!status || !mount) return;

  function faNumber(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '۰';
    return Math.round(n).toLocaleString('en-US').replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[Number(d)]; }).replace(/,/g, '٬');
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function limitText(value, unit, unlimitedText) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 'طبق جزئیات پلن';
    if (n === 0) return unlimitedText;
    return 'تا ' + faNumber(n) + ' ' + unit;
  }
  function cardFor(plan) {
    var card = el('article', 'pricing-card' + (plan.code === 'professional' ? ' pricing-card--featured' : ''));
    if (plan.code === 'professional') card.appendChild(el('span', 'pricing-card__badge', 'پیشنهاد پلن'));
    card.appendChild(el('h3', 'pricing-card__name', plan.nameFa || 'پلن پُست‌یار'));
    var price = Number(plan.priceRial);
    var priceLabel = Number.isFinite(price) && price === 0 ? 'رایگان' : (Number.isFinite(price) && price > 0 ? faNumber(price / 10) + ' تومان' : 'مشاهده در پنل');
    card.appendChild(el('p', 'pricing-card__price', priceLabel));
    if (Number.isFinite(price) && price > 0) {
      var days = Number(plan.periodDays);
      card.appendChild(el('p', 'pricing-card__period', days === 30 ? 'برای ۳۰ روز' : (days > 0 ? 'برای ' + faNumber(days) + ' روز' : 'مدت پلن طبق جزئیات اشتراک')));
    }
    var limits = plan.limitsJson && typeof plan.limitsJson === 'object' ? plan.limitsJson : {};
    var features = plan.featuresJson && typeof plan.featuresJson === 'object' ? plan.featuresJson : {};
    var list = el('ul', 'pricing-card__list');
    [
      limitText(limits.max_channels, 'کانال', 'نامحدود کانال'),
      (Number(limits.max_posts) === 0 ? 'پست نامحدود' : (Number.isFinite(Number(limits.max_posts)) && Number(limits.max_posts) > 0 ? faNumber(limits.max_posts) + ' پست در دوره' : 'سقف پست طبق پلن')),
      limitText(limits.max_bots, 'ربات', 'نامحدود ربات'),
      limitText(limits.max_schedules, 'زمان‌بندی', 'سقف زمان‌بندی طبق پلن'),
      limitText(limits.storage_mb, 'مگابایت فضا', 'فضای ذخیره‌سازی طبق پلن')
    ].forEach(function (label) { list.appendChild(el('li', '', label)); });
    list.appendChild(el('li', features.woocommerce ? 'is-on' : 'is-off', 'اتصال فروشگاه ووکامرس' + (features.woocommerce ? ' — فعال' : ' — در این پلن فعال نیست')));
    list.appendChild(el('li', features.content_summarization ? 'is-on' : 'is-off', 'خلاصه‌سازی محتوا' + (features.content_summarization ? ' — فعال' : ' — در این پلن فعال نیست')));
    card.appendChild(list);
    var cta = el('a', 'btn' + (plan.code === 'professional' ? '' : ' secondary'), Number(plan.priceRial) === 0 ? 'شروع رایگان' : 'ادامه در پُست‌یار');
    cta.href = '/?auth=register';
    card.appendChild(cta);
    return card;
  }

  fetch('/api/v1/subscriptions/plans', { credentials: 'include', headers: { 'Accept': 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('plans-unavailable');
      return response.json();
    })
    .then(function (payload) {
      var plans = payload && payload.data && Array.isArray(payload.data.plans) ? payload.data.plans : [];
      plans = plans.filter(function (p) { return p && typeof p === 'object' && typeof p.nameFa === 'string' && p.nameFa.trim(); });
      if (!plans.length) throw new Error('plans-empty');
      mount.replaceChildren();
      plans.forEach(function (plan) { mount.appendChild(cardFor(plan)); });
      status.textContent = 'قیمت و محدودیت‌های بالا از فهرست فعلی پلن‌های پُست‌یار دریافت شده‌اند.';
    })
    .catch(function () {
      mount.replaceChildren();
      status.textContent = 'در حال حاضر دریافت فهرست پلن‌ها ممکن نشد. برای مشاهده اطلاعات به‌روز، از پنل یا بخش پشتیبانی استفاده کنید.';
      var link = el('a', 'btn secondary', 'تماس با پشتیبانی');
      link.href = '/contact/';
      mount.appendChild(link);
    });
})();
