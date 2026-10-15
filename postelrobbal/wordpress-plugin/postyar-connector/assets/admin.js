/*
 * Postyar Connector — admin JS (Persian UI, RTL).
 * Depends on jQuery (bundled). Nonce + ajaxurl come from wp_localize_script (pycAdmin).
 */
jQuery(function ($) {
	'use strict';

	if (typeof pycAdmin === 'undefined') {
		return;
	}

	var $testBtn = $('#pyc-test-conn');
	var $syncBtn = $('#pyc-sync-all');
	var $contentSyncBtn = $('#pyc-sync-all-contents');
	var $result = $('#pyc-test-result');
	var $progress = $('#pyc-sync-progress');
	var $contentProgress = $('#pyc-content-sync-progress');
	var MAX_PAGES = 400; // server-side bound mirrored here.
	var syncing = false;

	function setBusy(busy) {
		$testBtn.prop('disabled', busy);
		$syncBtn.prop('disabled', busy);
		$contentSyncBtn.prop('disabled', busy);
	}

	function showMessage(text, isError) {
		$result
			.text(text)
			.removeClass('pyc-result-ok pyc-result-err')
			.addClass(isError ? 'pyc-result-err' : 'pyc-result-ok');
	}

	function refreshStatus() {
		$.post(
			pycAdmin.ajaxUrl,
			{ action: 'pyc_get_status', nonce: pycAdmin.nonce }
		)
			.done(function (r) {
				if (r && r.success && r.data) {
					$('#pyc-last-sync').text(r.data.last_sync_fa || 'هنوز همگام‌سازی نشده است.');
					$('#pyc-last-error').text(r.data.last_error || 'خطایی ثبت نشده است.');
					$('#pyc-push-count').text(String(r.data.last_push_count));
					$('#pyc-queue-count').text(String(r.data.queue_count));
				}
			});
	}

	/* ---------- تست اتصال ---------- */
	$testBtn.on('click', function (e) {
		e.preventDefault();
		if (syncing) {
			return;
		}
		setBusy(true);
		$result.text('در حال بررسی اتصال…').removeClass('pyc-result-ok pyc-result-err');

		$.post(
			pycAdmin.ajaxUrl,
			{ action: 'pyc_test_connection', nonce: pycAdmin.nonce }
		)
			.done(function (r) {
				if (r && r.success && r.data) {
					showMessage(r.data.message, false);
				} else {
					showMessage((r && r.data && r.data.message) ? r.data.message : 'بررسی اتصال ناموفق بود.', true);
				}
			})
			.fail(function () {
				showMessage('خطای شبکه؛ دوباره تلاش کنید.', true);
			})
			.always(function () {
				setBusy(false);
				refreshStatus();
			});
	});

	/* ---------- همگام‌سازی همهٔ محصولات (صفحه‌بندی‌شده) ---------- */
	function runBatch(page, acc) {
		$progress.text('همگام‌سازی صفحهٔ ' + page + ' …');

		$.post(
			pycAdmin.ajaxUrl,
			{ action: 'pyc_sync_batch', nonce: pycAdmin.nonce, page: page }
		)
			.done(function (r) {
				if (r && r.success && r.data) {
					acc.synced += parseInt(r.data.synced, 10) || 0;
					acc.skipped += parseInt(r.data.skipped, 10) || 0;

					var totalPages = parseInt(r.data.total_pages, 10) || 0;
					if (totalPages > 0) {
						$progress.text('صفحهٔ ' + r.data.page + ' از ' + totalPages + ' — محصولات جدید: ' + acc.synced + ' / بدون تغییر: ' + acc.skipped);
					}

					if (!r.data.done && page < MAX_PAGES) {
						runBatch(page + 1, acc);
						return;
					}
					finish('همگام‌سازی کامل شد — محصولات جدید: ' + acc.synced + '، بدون تغییر: ' + acc.skipped, false);
				} else {
					finish((r && r.data && r.data.message) ? r.data.message : 'همگام‌سازی ناموفق بود.', true);
				}
			})
			.fail(function () {
				finish('خطای شبکه هنگام همگام‌سازی رخ داد؛ از دکمهٔ وضعیت، آخرین خطا را ببینید.', true);
			});
	}

	function finish(message, isError) {
		syncing = false;
		setBusy(false);
		$progress.text('');
		showMessage(message, isError);
		refreshStatus();
	}

	function runContentBatch(page, acc) {
		$contentProgress.text('همگام‌سازی مقاله‌ها — صفحهٔ ' + page + ' …');
		$.post(pycAdmin.ajaxUrl, { action: 'pyc_sync_contents_batch', nonce: pycAdmin.nonce, page: page })
			.done(function (r) {
				if (r && r.success && r.data) {
					acc.synced += parseInt(r.data.synced, 10) || 0;
					acc.skipped += parseInt(r.data.skipped, 10) || 0;
					var totalPages = parseInt(r.data.total_pages, 10) || 0;
					$contentProgress.text((totalPages > 0 ? ('صفحهٔ ' + r.data.page + ' از ' + totalPages + ' — ') : '') + 'مقالات همگام‌شده: ' + acc.synced + ' / بدون تغییر یا ردشده: ' + acc.skipped);
					if (!r.data.done && page < MAX_PAGES) { runContentBatch(page + 1, acc); return; }
					finish('همگام‌سازی مقالات کامل شد — ارسال‌شده: ' + acc.synced + '، بدون تغییر یا ردشده: ' + acc.skipped, false);
				} else {
					finish((r && r.data && r.data.message) ? r.data.message : 'همگام‌سازی مقالات ناموفق بود.', true);
				}
			})
			.fail(function () { finish('خطای شبکه هنگام همگام‌سازی مقالات رخ داد؛ تنظیمات اتصال و آخرین خطا را بررسی کنید.', true); });
	}

	$contentSyncBtn.on('click', function (e) {
		e.preventDefault();
		if (syncing) return;
		if (!window.confirm('همهٔ مقالات منتشرشدهٔ وردپرس همگام‌سازی می‌شوند؛ ارسال به پُست‌یار در بسته‌های کوچک و امن انجام می‌شود. این کار محتوایی را منتشر نمی‌کند؛ فقط فهرست مقالات پُست‌یار را به‌روز می‌کند. ادامه می‌دهید؟')) return;
		syncing = true;
		setBusy(true);
		$contentProgress.text('همگام‌سازی مقالات آغاز شد…');
		showMessage('همگام‌سازی مقالات آغاز شد…', false);
		runContentBatch(1, { synced: 0, skipped: 0 });
	});

	$syncBtn.on('click', function (e) {
		e.preventDefault();
		if (syncing) {
			return;
		}
		if (!window.confirm('همگام‌سازی همهٔ محصولات در دسته‌های ۵۰تایی انجام می‌شود و ممکن است چند دقیقه طول بکشد. ادامه می‌دهید؟')) {
			return;
		}
		syncing = true;
		setBusy(true);
		showMessage('همگام‌سازی آغاز شد…', false);
		runBatch(1, { synced: 0, skipped: 0 });
	});
});
