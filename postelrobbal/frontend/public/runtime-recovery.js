(function () {
  'use strict';
  var shown = false;
  var OVERLAY_ID = 'postyar-runtime-recovery';
  function isChunkFailure(value) {
    var msg = '';
    try { msg = String(value && (value.message || value.reason || value)); } catch (_) {}
    return /(?:ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|dynamically imported module)/i.test(msg);
  }
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function showFailure(value) {
    if (shown || document.getElementById(OVERLAY_ID)) return;
    shown = true;
    var detail = '';
    try { detail = String(value && (value.message || value.reason || value) || ''); } catch (_) {}
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.dir = 'rtl';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(248,250,252,.96);font-family:inherit;';
    overlay.innerHTML = '<div style="width:min(560px,100%);padding:28px;border:1px solid #e5e7eb;border-radius:20px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.14);text-align:center">' +
      '<div style="font-size:42px;line-height:1;margin-bottom:14px">⚠️</div>' +
      '<h1 style="margin:0 0 10px;font-size:20px;color:#111827">بارگذاری این بخش با مشکل مواجه شد</h1>' +
      '<p style="margin:0;color:#64748b;font-size:13px;line-height:2">پُست‌یار صفحه را خودکار رفرش نمی‌کند تا وارد چرخهٔ بی‌نهایت نشوید. با دکمهٔ زیر یک بار تلاش کنید.</p>' +
      '<button type="button" data-retry style="margin-top:18px;min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font:inherit;font-weight:800;cursor:pointer">تلاش مجدد</button>' +
      (detail ? '<details style="margin-top:16px;text-align:right"><summary style="cursor:pointer;color:#64748b;font-size:11px">جزئیات فنی</summary><pre dir="ltr" style="white-space:pre-wrap;word-break:break-word;font:10px/1.7 monospace;color:#64748b">' + escapeHtml(detail) + '</pre></details>' : '') +
      '</div>';
    document.body.appendChild(overlay);
    var retry = overlay.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
  }
  function handle(value, event) {
    if (!isChunkFailure(value)) return;
    if (event && event.preventDefault) event.preventDefault();
    showFailure(value);
  }
  window.addEventListener('vite:preloadError', function (event) { handle(event && event.payload, event); });
  window.addEventListener('unhandledrejection', function (event) { handle(event && event.reason, event); });
  window.addEventListener('error', function (event) { handle(event && (event.error || event.message), event); });
})();
