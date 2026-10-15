<?php
/**
 * Admin page «پُست‌یار»: connection form (merge-save), tools, status, diagnostics.
 *
 * Security model (fixes of reference weaknesses):
 *  - EVERY handler: current_user_can('manage_options') + nonce.
 *  - Save is merge-over-existing → partial form can never wipe other settings
 *    (reference bug: ticker-tab save wiped AI key / auto-publish flags).
 *  - site_secret is a password input that is NEVER echoed back (not even masked
 *    value); empty submit preserves the stored secret. Secret never appears in
 *    URLs, query strings or logs.
 *
 * @package PostyarConnector
 */

defined('ABSPATH') || exit;

class PYC_Admin {

	const PAGE_SLUG = 'postyar-connector';

	/**
	 * Register hooks.
	 */
	public function __construct() {
		add_action('admin_menu', array($this, 'register_menu'));
		add_action('admin_enqueue_scripts', array($this, 'enqueue_assets'));
		add_action('admin_post_pyc_save_settings', array($this, 'handle_save'));
		add_action('admin_notices', array($this, 'render_notices'));
	}

	/**
	 * Single top-level menu «پُست‌یار».
	 */
	public function register_menu() {
		add_menu_page(
			'پُست‌یار',
			'پُست‌یار',
			'manage_options',
			self::PAGE_SLUG,
			array($this, 'render_page'),
			'dashicons-megaphone',
			58
		);
	}

	/**
	 * Enqueue assets only on the plugin page; nonce via wp_localize_script.
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_assets($hook) {
		if (false === strpos((string) $hook, self::PAGE_SLUG)) {
			return;
		}

		wp_enqueue_style('pyc-admin', PYC_PLUGIN_URL . 'assets/admin.css', array(), PYC_VERSION);
		wp_enqueue_script('pyc-admin', PYC_PLUGIN_URL . 'assets/admin.js', array('jquery'), PYC_VERSION, true);
		wp_localize_script(
			'pyc-admin',
			'pycAdmin',
			array(
				'ajaxUrl' => admin_url('admin-ajax.php'),
				'nonce'   => wp_create_nonce('pyc_admin'),
			)
		);
	}

	/**
	 * Product categories for the per-category enable checkboxes.
	 *
	 * @return array<int, WP_Term>
	 */
	private function product_categories() {
		if (!taxonomy_exists('product_cat')) {
			return array();
		}
		$terms = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'hide_empty' => false,
				'number'     => 200,
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);
		return is_wp_error($terms) ? array() : $terms;
	}

	/**
	 * Diagnostics data.
	 *
	 * @return array
	 */
	private function diagnostics() {
		$opts = PYC_Settings::all();

		return array(
			'php_version'  => PHP_VERSION,
			'wp_version'   => get_bloginfo('version'),
			'wc_active'    => PYC_Sync::wc_active(),
			'wc_version'   => defined('WC_VERSION') ? WC_VERSION : '',
			'http_ok'      => function_exists('wp_remote_post'),
			'saas_https'   => ('https' === parse_url((string) $opts['saas_url'], PHP_URL_SCHEME)),
			'site_key_set' => ('' !== $opts['site_key']),
			'secret_set'   => ('' !== $opts['site_secret']),
			'logged_count' => PYC_DB::count_rows(),
		);
	}

	/**
	 * Render the admin page (Persian, RTL).
	 */
	public function render_page() {
		if (!current_user_can('manage_options')) {
			wp_die('شما مجوز دسترسی به این بخش را ندارید.');
		}

		$opts       = PYC_Settings::all();
		$status     = PYC_Sync::get_status_summary();
		$diag       = $this->diagnostics();
		$categories = $this->product_categories();
		$map        = is_array($opts['category_map']) ? $opts['category_map'] : array();
		?>
		<div class="wrap pyc-wrap" dir="rtl">
			<h1 class="pyc-title"><span class="dashicons dashicons-megaphone"></span> پُست‌یار — اتصال ووکامرس</h1>
			<p class="pyc-sub">محصولات فروشگاه شما به پُست‌یار ارسال می‌شوند تا در کانال‌های پیام‌رسان منتشر شوند. کلید و رمز اتصال را از داشبورد پُست‌یار (بخش ووکامرس) دریافت کنید.</p>

			<div class="pyc-grid">

				<!-- ================= وضعیت اتصال ================= -->
				<section class="pyc-card">
					<h2>وضعیت اتصال</h2>
					<ul class="pyc-status">
						<li><span class="pyc-label">آخرین همگام‌سازی:</span> <span id="pyc-last-sync"><?php echo esc_html('' !== $status['last_sync_fa'] ? $status['last_sync_fa'] : 'هنوز همگام‌سازی نشده است.'); ?></span></li>
						<li><span class="pyc-label">آخرین خطا:</span> <span id="pyc-last-error" class="<?php echo esc_attr('' !== $status['last_error'] ? 'pyc-error-text' : ''); ?>"><?php echo esc_html('' !== $status['last_error'] ? $status['last_error'] : 'خطایی ثبت نشده است.'); ?></span></li>
						<li><span class="pyc-label">مجموع محصولات ارسال‌شده:</span> <span id="pyc-push-count"><?php echo esc_html(number_format_i18n($status['last_push_count'])); ?></span></li>
						<li><span class="pyc-label">آخرین دفعه (جدید / بدون تغییر):</span> <?php echo esc_html(number_format_i18n($status['last_synced']) . ' / ' . number_format_i18n($status['last_skipped'])); ?></li>
						<li><span class="pyc-label">صف در انتظار ارسال:</span> <span id="pyc-queue-count"><?php echo esc_html(number_format_i18n($status['queue_count'])); ?></span></li>
						<li><span class="pyc-label">اجرای بعدی زمان‌بندی:</span> <?php echo esc_html('' !== $status['next_cron_fa'] ? $status['next_cron_fa'] : 'زمان‌بندی نشده — با اولین تغییر محصول فعال می‌شود'); ?></li>
						<li><span class="pyc-label">پوشش همگام‌سازی:</span> <?php echo esc_html('yes' === $opts['auto_push'] ? 'همگام‌سازی خودکار روشن است' : 'همگام‌سازی خودکار خاموش است (فقط دستی)'); ?></li>
					</ul>
				</section>

				<!-- ================= تنظیمات اتصال ================= -->
				<section class="pyc-card">
					<h2>تنظیمات اتصال</h2>
					<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="pyc-form">
						<input type="hidden" name="action" value="pyc_save_settings" />
						<?php wp_nonce_field('pyc_save_settings', 'pyc_nonce'); ?>

						<p>
							<label for="pyc_saas_url">آدرس پُست‌یار (آدرس پایهٔ داشبورد)</label>
							<input type="url" id="pyc_saas_url" name="pyc_saas_url" dir="ltr" class="regular-text"
								value="<?php echo esc_attr($opts['saas_url']); ?>"
								placeholder="https://app.example.com" autocomplete="off" />
							<span class="description">مثال: <code dir="ltr">https://app.postyar.example</code> — فقط http و https.</span>
						</p>

						<p>
							<label for="pyc_site_key">کلید سایت (site_key)</label>
							<input type="text" id="pyc_site_key" name="pyc_site_key" dir="ltr" class="regular-text"
								value="<?php echo esc_attr($opts['site_key']); ?>"
								placeholder="۳۲ کاراکتر hex" autocomplete="off" maxlength="32" />
							<span class="description">هنگام ثبت سایت در داشبورد پُست‌یار تولید می‌شود.</span>
						</p>

						<p>
							<label for="pyc_site_secret">رمز اتصال (secret)</label>
							<input type="password" id="pyc_site_secret" name="pyc_site_secret" dir="ltr" class="regular-text"
								value="" placeholder="برای تغییر مجدد وارد کنید" autocomplete="new-password" maxlength="32" />
							<span class="description">
								<?php echo esc_html('' !== $opts['site_secret'] ? 'یک secret ذخیره شده است و نمایش داده نمی‌شود؛ خالی بگذارید تا بدون تغییر بماند.' : 'secret را از داشبورد پُست‌یار وارد کنید (فقط یک‌بار نمایش داده می‌شود).'); ?>
								secret فقط داخل هدر ارسال می‌شود و هرگز در آدرس (URL) یا لاگ‌ها قرار نمی‌گیرد.
							</span>
						</p>

						<p>
							<label><input type="checkbox" name="pyc_auto_push" value="1" <?php checked('yes', $opts['auto_push']); ?> /> همگام‌سازی خودکار پس از هر تغییر محصول (با ۱۰ دقیقه تأخیر برای جلوگیری از ارسال‌های پیاپی)</label>
						</p>

						<p>
							<span class="pyc-label">واحد قیمت ثبت‌شده در ووکامرس:</span><br />
							<label><input type="radio" name="pyc_price_mode" value="toman" <?php checked('toman', $opts['price_mode']); ?> /> تومان (به‌صورت خودکار در ۱۰ ضرب می‌شود تا ریال محاسبه شود)</label><br />
							<label><input type="radio" name="pyc_price_mode" value="rial" <?php checked('rial', $opts['price_mode']); ?> /> ریال (بدون تغییر)</label>
						</p>

						<div class="pyc-cats">
							<span class="pyc-label">ارسال محصولات از این دسته‌ها:</span>
							<span class="description">هیچ دسته‌ای انتخاب نشود = همهٔ محصولات ارسال می‌شوند.</span>
							<?php if (empty($categories)) : ?>
								<p class="description">دسته‌ای یافت نشد<?php echo esc_html($diag['wc_active'] ? '' : ' — ووکامرس فعال نیست'); ?>؛ همهٔ محصولات ارسال خواهند شد.</p>
							<?php else : ?>
								<ul class="pyc-cat-list">
									<?php foreach ($categories as $term) : ?>
										<li>
											<label>
												<input type="checkbox" name="pyc_category_map[]" value="<?php echo esc_attr((string) $term->term_id); ?>" <?php checked(isset($map[(int) $term->term_id])); ?> />
												<?php echo esc_html($term->name); ?>
											</label>
										</li>
									<?php endforeach; ?>
								</ul>
							<?php endif; ?>
						</div>

						<p>
							<label><input type="checkbox" name="pyc_debug" value="1" <?php checked('yes', $opts['debug']); ?> /> ثبت خطاهای فنی در لاگ (بدون اطلاعات حساس)</label>
						</p>

						<?php submit_button('ذخیرهٔ تنظیمات', 'primary', 'pyc_submit', false); ?>
					</form>
				</section>

				<!-- ================= ابزارها ================= -->
				<section class="pyc-card">
					<h2>ابزارها</h2>
					<p>
						<button type="button" id="pyc-test-conn" class="button">تست اتصال</button>
						<button type="button" id="pyc-sync-all" class="button button-primary">همگام‌سازی همهٔ محصولات</button>
						<button type="button" id="pyc-sync-all-contents" class="button">همگام‌سازی همهٔ مقالات</button>
					</p>
					<div id="pyc-sync-progress" class="pyc-progress"></div>
					<div id="pyc-content-sync-progress" class="pyc-progress"></div>
					<div id="pyc-test-result" class="pyc-result"></div>
					<p class="description">
						«تست اتصال» بدون ارسال محتوای سایت فقط اتصال را بررسی می‌کند. همگام‌سازی محصولات در دسته‌های ۵۰تایی و همگام‌سازی مقالات منتشرشده در درخواست‌های امنِ پنج‌مقاله‌ای انجام می‌شود؛ محتوای تکراری رکورد تکراری ایجاد نمی‌کند.
						<?php if (!PYC_Settings::is_configured()) : ?>
							<strong>ابتدا تنظیمات اتصال را ذخیره کنید.</strong>
						<?php endif; ?>
					</p>
				</section>

				<!-- ================= عیب‌یابی ================= -->
				<section class="pyc-card">
					<h2>عیب‌یابی</h2>
					<ul class="pyc-status">
						<li><span class="pyc-label">نسخهٔ PHP:</span> <?php echo esc_html($diag['php_version']); ?></li>
						<li><span class="pyc-label">نسخهٔ وردپرس:</span> <?php echo esc_html($diag['wp_version']); ?></li>
						<li><span class="pyc-label">ووکامرس:</span> <?php echo esc_html($diag['wc_active'] ? ('فعال' . ('' !== $diag['wc_version'] ? ' (نسخهٔ ' . $diag['wc_version'] . ')' : '')) : 'غیرفعال — این افزونه بدون ووکامرس کار نمی‌کند'); ?></li>
						<li><span class="pyc-label">ارسال HTTP (wp_remote_post):</span> <?php echo esc_html($diag['http_ok'] ? 'موجود است' : 'در دسترس نیست'); ?></li>
						<li><span class="pyc-label">آدرس پُست‌یار روی HTTPS:</span> <?php echo esc_html($diag['saas_https'] ? 'بله' : 'خیر — توصیه می‌شود آدرس https باشد'); ?></li>
						<li><span class="pyc-label">site_key ذخیره شده:</span> <?php echo esc_html($diag['site_key_set'] ? 'بله' : 'خیر'); ?></li>
						<li><span class="pyc-label">secret ذخیره شده:</span> <?php echo esc_html($diag['secret_set'] ? 'بله (نمایش داده نمی‌شود)' : 'خیر'); ?></li>
						<li><span class="pyc-label">محصولات ثبت‌شده در لاگ محلی:</span> <?php echo esc_html(number_format_i18n($diag['logged_count'])); ?></li>
						<li><span class="pyc-label">تعداد تلاش مجدد از آخرین خطا:</span> <?php echo esc_html(number_format_i18n($status['retry_count'])); ?></li>
					</ul>
				</section>

				<!-- ================= هشدار حذف ================= -->
				<section class="pyc-card pyc-warning">
					<h2>هشدار حذف افزونه</h2>
					<p>
						با حذف کامل افزونه، جدول لاگ محصولات، تمام تنظیمات (شامل site_key و secret) و همهٔ زمان‌بندی‌ها برای همیشه پاک می‌شوند و قابل بازگشت نیستند.
						برای اتصال مجدد باید از داشبورد پُست‌یار یک اتصال تازه (یا rotate secret) بسازید. برای غیرفعال‌سازی موقت، فقط «غیرفعال کردن» را انتخاب کنید.
					</p>
				</section>

			</div>
		</div>
		<?php
	}

	/**
	 * Save handler (admin-post.php). Merge-over-existing — never a full replace.
	 */
	public function handle_save() {
		if (!current_user_can('manage_options')) {
			wp_die('شما مجوز انجام این عملیات را ندارید.');
		}

		$nonce = isset($_POST['pyc_nonce']) ? sanitize_text_field(wp_unslash($_POST['pyc_nonce'])) : '';
		if (!wp_verify_nonce($nonce, 'pyc_save_settings')) {
			wp_die('نشست شما منقضی شده است؛ صفحه را دوباره بارگذاری کنید.');
		}

		$errors = array();
		$next   = PYC_Settings::all(); // Preserve every field that is not in this form.

		// SaaS URL.
		if (isset($_POST['pyc_saas_url'])) {
			$url = PYC_Settings::sanitize_saas_url(wp_unslash($_POST['pyc_saas_url']));
			if ('' === $url && '' !== trim((string) wp_unslash($_POST['pyc_saas_url']))) {
				$errors[] = 'آدرس پُست‌یار معتبر نیست؛ فقط http و https پذیرفته می‌شود.';
			} else {
				$next['saas_url'] = $url;
			}
		}

		// Site key (empty → preserve).
		if (isset($_POST['pyc_site_key'])) {
			$key_raw = trim((string) wp_unslash($_POST['pyc_site_key']));
			if ('' !== $key_raw) {
				$key = PYC_Settings::sanitize_hex32($key_raw);
				if (PYC_Settings::is_valid_hex32($key)) {
					$next['site_key'] = $key;
				} else {
					$errors[] = 'کلید سایت (site_key) باید ۳۲ کاراکتر hex باشد؛ مقدار قبلی حفظ شد.';
				}
			}
		}

		// Secret (empty → preserve; never echoed back).
		if (isset($_POST['pyc_site_secret'])) {
			$sec_raw = trim((string) wp_unslash($_POST['pyc_site_secret']));
			if ('' !== $sec_raw) {
				$sec = PYC_Settings::sanitize_hex32($sec_raw);
				if (PYC_Settings::is_valid_hex32($sec)) {
					$next['site_secret'] = $sec;
				} else {
					$errors[] = 'رمز اتصال (secret) باید ۳۲ کاراکتر hex باشد؛ مقدار قبلی حفظ شد.';
				}
			}
		}

		// Flags.
		$next['auto_push']  = (!empty($_POST['pyc_auto_push'])) ? 'yes' : 'no';
		$next['price_mode'] = (isset($_POST['pyc_price_mode']) && 'rial' === $_POST['pyc_price_mode']) ? 'rial' : 'toman';
		$next['debug']      = (!empty($_POST['pyc_debug'])) ? 'yes' : 'no';

		// Category map.
		if (isset($_POST['pyc_category_map'])) {
			$raw_map = $_POST['pyc_category_map'];
			if (is_array($raw_map)) {
				$map = array();
				foreach (array_slice($raw_map, 0, 200) as $term_id) {
					$term_id = absint($term_id);
					if ($term_id > 0) {
						$map[$term_id] = 1;
					}
				}
				$next['category_map'] = $map;
			}
		}

		PYC_Settings::update($next);

		$msg = empty($errors) ? 'saved' : 'saved_with_errors';
		if (!empty($errors) && 'yes' === $next['debug']) {
			foreach ($errors as $error) {
				error_log('[postyar-connector] settings: ' . $error); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			}
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'    => self::PAGE_SLUG,
					'pyc_msg' => $msg,
				),
				admin_url('admin.php')
			)
		);
		exit;
	}

	/**
	 * Post-save notices.
	 */
	public function render_notices() {
		if (!isset($_GET['page']) || self::PAGE_SLUG !== $_GET['page'] || !current_user_can('manage_options')) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		if (!isset($_GET['pyc_msg'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}

		$msg = sanitize_text_field(wp_unslash($_GET['pyc_msg'])); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ('saved' === $msg) {
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html('تنظیمات ذخیره شد.') . '</p></div>';
		} elseif ('saved_with_errors' === $msg) {
			echo '<div class="notice notice-warning is-dismissible"><p>' . esc_html('تنظیمات ذخیره شد، اما یک یا چند مقدار نامعتبر نادیده گرفته شد و مقدار قبلی حفظ شد.') . '</p></div>';
		}
	}
}
