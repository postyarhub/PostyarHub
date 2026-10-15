<?php
/**
 * Product pusher: builds payloads, queues changed products, pushes to the
 * Postyar SaaS webhook with bounded batches, idempotent hash-skip and retries.
 *
 * جریان:
 *   woocommerce_new/update_product → صف (option pyc_queue) + رویداد cron تکی
 *   «pyc_sync_cron» با تأخیر ۱۰ دقیقه (debounce — هیچ HTTP در خط فراخوانی محصول؛
 *   برخلاف حلقهٔ syncِ روی save محصول در مرجع). حذف/زباله‌دان محصول → فقط پاک‌سازی
 *   صف و لاگ (قرارداد API v1 عملیات حذف سمت SaaS ندارد).
 *
 * ارسال: POST {saas_url}/api/v1/webhooks/wordpress
 *   headers: x-postyar-site-key + x-postyar-secret (بدون query string — §31)
 *   body:    {"action":"sync_products","products":[... ≤ 50 ...]}
 *   پاسخ:    {success:true,data:{synced,skipped}} | {success:false,error:{code,message}}
 *
 * @package PostyarConnector
 */

defined('ABSPATH') || exit;

class PYC_Sync {

	const CRON_HOOK     = 'pyc_sync_cron';
	const RETRY_HOOK    = 'pyc_retry';
	const QUEUE_OPTION  = 'pyc_queue';
	const QUEUE_LIMIT   = 500;
	const BATCH_SIZE    = 50;
	const CONTENT_BATCH_SIZE = 5;
	const MAX_RETRIES   = 3;
	const REQUEST_TIMEOUT = 20; // seconds.
	const DEBOUNCE_DELAY  = 600; // 10 minutes.
	const RETRY_DELAY     = 900; // 15 minutes.

	/**
	 * Register product hooks + cron handlers.
	 */
	public function __construct() {
		add_action('woocommerce_new_product', array(__CLASS__, 'on_product_changed'), 20);
		add_action('woocommerce_update_product', array(__CLASS__, 'on_product_changed'), 20);
		add_action('woocommerce_delete_product', array(__CLASS__, 'on_product_deleted'), 20);
		add_action('woocommerce_trash_product', array(__CLASS__, 'on_product_deleted'), 20);
		add_action(self::CRON_HOOK, array(__CLASS__, 'run_queue_drain'));
		add_action(self::RETRY_HOOK, array(__CLASS__, 'run_queue_drain'));
	}

	/**
	 * WooCommerce presence check.
	 *
	 * @return bool
	 */
	public static function wc_active() {
		return class_exists('WooCommerce') && function_exists('wc_get_products');
	}

	/* ---------------------------------------------------------------------
	 * Queueing
	 * ------------------------------------------------------------------- */

	/**
	 * Product hook callback (never blocks the request, never does HTTP).
	 *
	 * @param int $product_id Product ID.
	 * @return void
	 */
	public static function on_product_changed($product_id) {
		if ('yes' !== PYC_Settings::get('auto_push')) {
			return;
		}
		self::queue_product($product_id);
	}

	/**
	 * Add a product to the bounded queue and schedule the debounced cron run.
	 *
	 * @param int $product_id Product ID.
	 * @return void
	 */
	public static function queue_product($product_id) {
		$id = absint($product_id);
		if (!$id) {
			return;
		}

		$queue = get_option(self::QUEUE_OPTION, array());
		if (!is_array($queue)) {
			$queue = array();
		}

		if (!in_array($id, $queue, true)) {
			if (count($queue) >= self::QUEUE_LIMIT) {
				return; // Bounded queue: overflow waits for the next manual sync.
			}
			$queue[] = $id;
			update_option(self::QUEUE_OPTION, $queue, false);
		}

		if (!wp_next_scheduled(self::CRON_HOOK)) {
			wp_schedule_single_event(time() + self::DEBOUNCE_DELAY, self::CRON_HOOK);
		}
	}

	/**
	 * Deleted/trashed product: remove from queue + local log (no delete API in v1).
	 *
	 * @param int $product_id Product ID.
	 * @return void
	 */
	public static function on_product_deleted($product_id) {
		$id = absint($product_id);
		if (!$id) {
			return;
		}

		$queue = get_option(self::QUEUE_OPTION, array());
		if (is_array($queue) && in_array($id, $queue, true)) {
			update_option(self::QUEUE_OPTION, array_values(array_diff($queue, array($id))), false);
		}

		PYC_DB::delete_log($id);
	}

	/**
	 * Cron drain: up to 4 batches (200 products) per run; re-schedules itself
	 * when the queue is not empty. Failures schedule pyc_retry (max 3 tries).
	 *
	 * @return void
	 */
	public static function run_queue_drain() {
		if (!self::wc_active() || !PYC_Settings::is_configured()) {
			return; // Queue is preserved; next product change re-schedules.
		}

		$queue = get_option(self::QUEUE_OPTION, array());
		if (!is_array($queue) || empty($queue)) {
			return;
		}

		$remaining = array_values($queue);
		$error     = null;
		$batches   = 0;

		while (!empty($remaining) && $batches < 4) {
			$batch = array_slice($remaining, 0, self::BATCH_SIZE);
			$res   = self::push_products($batch, false, true);

			if (is_wp_error($res)) {
				$error = $res;
				break;
			}

			$remaining = array_slice($remaining, count($batch));
			$batches++;
		}

		update_option(self::QUEUE_OPTION, $remaining, false);

		if (null !== $error) {
			$retries = (int) PYC_Settings::get('retry_count') + 1;
			PYC_Settings::update(array('retry_count' => $retries));

			if ($retries <= self::MAX_RETRIES && !wp_next_scheduled(self::RETRY_HOOK)) {
				wp_schedule_single_event(time() + self::RETRY_DELAY, self::RETRY_HOOK);
			}
			return;
		}

		if (0 !== (int) PYC_Settings::get('retry_count')) {
			PYC_Settings::update(array('retry_count' => 0));
		}

		if (!empty($remaining) && !wp_next_scheduled(self::CRON_HOOK) && !wp_next_scheduled(self::RETRY_HOOK)) {
			wp_schedule_single_event(time() + 60, self::CRON_HOOK);
		}
	}

	/* ---------------------------------------------------------------------
	 * Payload building
	 * ------------------------------------------------------------------- */

	/**
	 * Truncate a UTF-8 string safely.
	 *
	 * @param string $text  Input.
	 * @param int    $limit Max characters.
	 * @return string
	 */
	private static function trunc($text, $limit) {
		$text = (string) $text;
		if (function_exists('mb_substr')) {
			return mb_substr($text, 0, $limit);
		}
		return substr($text, 0, $limit);
	}

	/**
	 * Build the wire payload for one product (SaaS zod contract:
	 * wc_id int ≥1, title ≤255, price_rial int ≥0|null, permalink ≤255|null,
	 * image_url ≤512|null; extra keys categories/stock_status are stripped
	 * server-side and kept for forward compatibility).
	 *
	 * @param WC_Product $product Product object.
	 * @return array|false False when the product has no usable title.
	 */
	public static function build_payload($product) {
		$wc_id = (int) $product->get_id();
		$title = trim(wp_strip_all_tags(html_entity_decode((string) $product->get_name(), ENT_QUOTES, 'UTF-8')));
		if ('' === $title) {
			return false;
		}
		$title = self::trunc($title, 255);

		// price_rial: store currency is Toman → ×10 to reach Rial (filterable).
		$mode = PYC_Settings::get('price_mode');
		$raw  = $product->get_price();
		if ('' === $raw || null === $raw) {
			$price = null;
		} else {
			$multiplier = (float) apply_filters('pyc_price_multiplier', ('toman' === $mode) ? 10 : 1, $product);
			$price      = (int) floor(((float) $raw) * $multiplier);
			if ($price < 0) {
				$price = 0;
			}
		}

		$permalink = get_permalink($wc_id);
		$permalink = ($permalink) ? self::trunc(esc_url_raw($permalink), 255) : '';
		$permalink = ('' !== $permalink) ? $permalink : null;

		$image_id = $product->get_image_id();
		$image    = $image_id ? wp_get_attachment_image_url((int) $image_id, 'full') : '';
		$image    = ($image) ? self::trunc(esc_url_raw($image), 512) : '';
		$image    = ('' !== $image) ? $image : null;

		$cats = wp_get_post_terms($wc_id, 'product_cat', array('fields' => 'names'));
		$cats = is_wp_error($cats) ? array() : array_map('strval', $cats);
		$cats = array_slice(array_values(array_filter($cats)), 0, 20);

		$stock = $product->get_stock_status();
		if (!is_string($stock) || '' === $stock) {
			$stock = 'instock';
		}

		$hash_source = array($wc_id, $title, $price, $permalink, $image, $cats, $stock);
		$hash        = hash('sha256', (string) wp_json_encode($hash_source));

		return array(
			'wc_id'        => $wc_id,
			'title'        => $title,
			'price_rial'   => $price,
			'permalink'    => $permalink,
			'image_url'    => $image,
			'categories'   => $cats,
			'stock_status' => $stock,
			'content_hash' => $hash,
		);
	}

	/**
	 * Category filter for auto-push. Empty map = push everything.
	 *
	 * @param WC_Product $product Product object.
	 * @return bool
	 */
	public static function product_enabled($product) {
		$map = PYC_Settings::get('category_map');
		if (!is_array($map) || empty($map)) {
			return true;
		}

		$term_ids = wp_get_post_terms($product->get_id(), 'product_cat', array('fields' => 'ids'));
		if (is_wp_error($term_ids) || empty($term_ids)) {
			return false;
		}

		foreach ($term_ids as $term_id) {
			if (isset($map[(int) $term_id])) {
				return true;
			}
		}
		return false;
	}

	/* ---------------------------------------------------------------------
	 * Pushing
	 * ------------------------------------------------------------------- */

	/**
	 * Push a set of product IDs (idempotent, hash-skipped, chunked ≤ 50).
	 *
	 * @param array $wc_ids                     Product IDs.
	 * @param bool  $force                      Push even when the hash is unchanged.
	 * @param bool  $respect_categories         Apply the per-category filter (auto-push path).
	 * @return array|WP_Error {synced, skipped, processed}
	 */
	public static function push_products(array $wc_ids, $force = false, $respect_categories = false) {
		if (!self::wc_active()) {
			return new WP_Error('pyc_wc_missing', 'ووکامرس فعال نیست؛ همگام‌سازی امکان‌پذیر نیست.');
		}
		if (!PYC_Settings::is_configured()) {
			return new WP_Error('pyc_not_configured', 'تنظیمات اتصال کامل نیست؛ آدرس پُست‌یار، site_key و secret را ذخیره کنید.');
		}

		$ids = array_values(array_unique(array_filter(array_map('absint', $wc_ids))));
		$ids = array_diff($ids, array(0));

		$site_key  = (string) PYC_Settings::get('site_key');
		$payloads  = array();
		$considered = 0;

		foreach ($ids as $id) {
			$product = wc_get_product($id);
			if (!$product instanceof WC_Product) {
				continue;
			}
			if ('publish' !== $product->get_status()) {
				continue;
			}
			if ($respect_categories && !self::product_enabled($product)) {
				continue;
			}

			$payload = self::build_payload($product);
			if (false === $payload) {
				continue;
			}

			$considered++;
			if (!$force && PYC_DB::is_unchanged($id, $payload['content_hash'], $site_key)) {
				continue;
			}
			$payloads[] = $payload;
		}

		$skipped = $considered - count($payloads);
		$synced  = 0;

		foreach (array_chunk($payloads, self::BATCH_SIZE) as $chunk) {
			$wire = array();
			foreach ($chunk as $p) {
				$wire[] = array(
					'wc_id'        => (int) $p['wc_id'],
					'title'        => (string) $p['title'],
					'price_rial'   => $p['price_rial'],
					'permalink'    => $p['permalink'],
					'image_url'    => $p['image_url'],
					'categories'   => $p['categories'],
					'stock_status' => $p['stock_status'],
				);
			}

			$res = self::send_request(
				array(
					'action'   => 'sync_products',
					'products' => $wire,
				)
			);

			if (is_wp_error($res)) {
				self::log_failure($res->get_error_message());
				return $res;
			}

			if (200 !== $res['code'] || empty($res['data']['success'])) {
				$err = self::response_error($res['code'], $res['data']);
				self::log_failure($err->get_error_message());
				return $err;
			}

			$now = current_time('mysql');
			foreach ($chunk as $p) {
				PYC_DB::upsert_log((int) $p['wc_id'], $site_key, (string) $p['content_hash'], $now);
				$synced++;
			}
		}

		PYC_Settings::update(
			array(
				'last_sync_at'    => current_time('mysql'),
				'last_push_count' => (int) PYC_Settings::get('last_push_count') + $synced,
				'last_synced'     => $synced,
				'last_skipped'    => $skipped,
				'last_error'      => '',
			)
		);

		// Every input id was examined (pushed, skipped or filtered) → queue can drop them.
		return array(
			'synced'    => $synced,
			'skipped'   => $skipped,
			'processed' => $ids,
		);
	}

	/**
	 * Process up to 50 published WordPress article IDs per admin page, sending each API request in bounded 5-article chunks.
	 * SaaS performs hash-based idempotency; repeated full syncs do not create duplicate records.
	 *
	 * @param array $post_ids WordPress post IDs.
	 * @return array|WP_Error {synced, skipped, processed}
	 */
	public static function push_contents(array $post_ids) {
		if (!PYC_Settings::is_configured()) {
			return new WP_Error('pyc_not_configured', 'تنظیمات اتصال کامل نیست؛ آدرس پُست‌یار، site_key و secret را ذخیره کنید.');
		}

		$ids = array_values(array_unique(array_filter(array_map('absint', $post_ids))));
		$synced = 0;
		$skipped = 0;
		$processed = array();
		foreach (array_chunk($ids, self::CONTENT_BATCH_SIZE) as $batch) {
			$wire = array();
			foreach ($batch as $id) {
				$post = get_post($id);
				if (!$post instanceof WP_Post || 'post' !== $post->post_type || 'publish' !== $post->post_status) {
					$skipped++;
					continue;
				}
				$title = trim(wp_strip_all_tags(get_the_title($post), true));
				$raw_body = strip_shortcodes((string) $post->post_content);
				$body = trim(html_entity_decode(wp_strip_all_tags($raw_body, true), ENT_QUOTES | ENT_HTML5, get_bloginfo('charset') ? get_bloginfo('charset') : 'UTF-8'));
				if (function_exists('mb_substr')) {
					$body = mb_substr($body, 0, 60000, 'UTF-8');
				} else {
					$body = wp_check_invalid_utf8(substr($body, 0, 60000), true);
				}
				if ('' === $title) { $skipped++; continue; }
				$image = get_the_post_thumbnail_url($post, 'full');
				$wire[] = array(
					'content_id' => (int) $post->ID,
					'title' => $title,
					'body' => $body,
					'permalink' => get_permalink($post),
					'image_url' => $image ? esc_url_raw($image) : null,
					'event_type' => 'update',
				);
			}
			if (empty($wire)) { continue; }
			$res = self::send_request(array('action' => 'sync_contents', 'contents' => $wire));
			if (is_wp_error($res)) {
				self::log_failure($res->get_error_message());
				return $res;
			}
			if (200 !== $res['code'] || empty($res['data']['success'])) {
				$err = self::response_error($res['code'], $res['data']);
				self::log_failure($err->get_error_message());
				return $err;
			}
			$payload = isset($res['data']['data']) && is_array($res['data']['data']) ? $res['data']['data'] : array();
			$synced += isset($payload['synced']) ? absint($payload['synced']) : count($wire);
			$skipped += isset($payload['skipped']) ? absint($payload['skipped']) : 0;
			$processed = array_merge($processed, array_map('absint', $batch));
		}
		return array('synced' => $synced, 'skipped' => $skipped, 'processed' => $processed);
	}

	/**
	 * Low-level HTTP POST to the SaaS webhook. Credentials go ONLY in headers.
	 *
	 * @param array $body JSON body.
	 * @return array|WP_Error {code:int, data:array|null, body:string}
	 */
	public static function send_request(array $body) {
		$opts = PYC_Settings::all();
		if ('' === $opts['saas_url'] || '' === $opts['site_key'] || '' === $opts['site_secret']) {
			return new WP_Error('pyc_not_configured', 'تنظیمات اتصال کامل نیست؛ آدرس پُست‌یار، site_key و secret را ذخیره کنید.');
		}

		$url  = untrailingslashit($opts['saas_url']) . PYC_WEBHOOK_PATH;
		$args = array(
			'timeout'     => self::REQUEST_TIMEOUT,
			'redirection' => 2,
			'headers'     => array(
				'Content-Type'       => 'application/json; charset=utf-8',
				'x-postyar-site-key' => $opts['site_key'],
				'x-postyar-secret'   => $opts['site_secret'],
			),
			'body'        => (string) wp_json_encode($body),
			'data_format' => 'body',
			'user-agent'  => 'Postyar-Connector/' . PYC_VERSION . '; ' . home_url(),
		);

		$response = wp_remote_post($url, $args);
		if (is_wp_error($response)) {
			return new WP_Error('pyc_http_failed', 'ارتباط با سرور پُست‌یار برقرار نشد. (' . $response->get_error_message() . ')');
		}

		$raw  = wp_remote_retrieve_body($response);
		$data = json_decode($raw, true);

		return array(
			'code' => (int) wp_remote_retrieve_response_code($response),
			'data' => is_array($data) ? $data : null,
			'body' => (string) $raw,
		);
	}

	/**
	 * Map a webhook HTTP response to a Persian WP_Error.
	 * (The response error messages contain no secrets by contract.)
	 *
	 * @param int       $code HTTP status.
	 * @param array|null $data Decoded body.
	 * @return WP_Error
	 */
	private static function response_error($code, $data) {
		$detail = '';
		if (is_array($data) && isset($data['error']) && is_array($data['error']) && !empty($data['error']['message'])) {
			$detail = ' (' . sanitize_text_field((string) $data['error']['message']) . ')';
		}

		if (401 === $code) {
			return new WP_Error('pyc_unauthorized', 'اعتبارنامهٔ سایت معتبر نیست؛ site_key یا secret را بررسی کنید. در صورت افشای secret، از داشبورد پُست‌یار rotate بگیرید.');
		}
		if (429 === $code) {
			return new WP_Error('pyc_rate_limited', 'محدودیت نرخ درخواست در سرور پُست‌یار؛ دوباره تلاش خواهد شد.' . $detail);
		}
		if (403 === $code) {
			return new WP_Error('pyc_forbidden', 'سرور پُست‌یار این عملیات را مجاز ندانست (مثلاً سهمیهٔ پلن).' . $detail);
		}
		if (422 === $code) {
			return new WP_Error('pyc_validation', 'داده‌های محصول ارسالی پذیرفته نشد.' . $detail);
		}

		return new WP_Error('pyc_http_' . (int) $code, 'پاسخ ناموفق از سرور پُست‌یار (کد ' . (int) $code . ').' . $detail);
	}

	/**
	 * Healthcheck. SaaS auth runs BEFORE body validation, so an unknown action
	 * yields: 401 → bad credentials, 422 → headers valid (no data mutated),
	 * 200 → direct success. No products are sent, nothing is created.
	 *
	 * @return array|WP_Error {ok, message}
	 */
	public static function test_connection() {
		$res = self::send_request(array('action' => 'ping'));

		if (is_wp_error($res)) {
			return $res;
		}

		if (200 === $res['code']) {
			return array(
				'ok'      => true,
				'message' => 'اتصال به پُست‌یار برقرار است.',
			);
		}
		if (422 === $res['code']) {
			return array(
				'ok'      => true,
				'message' => 'اتصال به پُست‌یار برقرار است (اعتبارنامه در هدرها تأیید شد).',
			);
		}

		return self::response_error($res['code'], $res['data']);
	}

	/**
	 * Record a failure (no secret ever reaches here — messages are static Persian
	 * strings plus SaaS-provided sanitized messages).
	 *
	 * @param string $message Persian message.
	 * @return void
	 */
	private static function log_failure($message) {
		PYC_Settings::update(array('last_error' => (string) $message));

		if ('yes' === PYC_Settings::get('debug')) {
			error_log('[postyar-connector] ' . $message); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}

	/**
	 * Status snapshot for admin UI/AJAX.
	 *
	 * @return array
	 */
	public static function get_status_summary() {
		$opts  = PYC_Settings::all();
		$queue = get_option(self::QUEUE_OPTION, array());
		if (!is_array($queue)) {
			$queue = array();
		}

		$next_cron = wp_next_scheduled(self::CRON_HOOK);
		if (!$next_cron) {
			$next_cron = wp_next_scheduled(self::RETRY_HOOK);
		}

		$format = function ($mysql) {
			if (empty($mysql) || !is_string($mysql)) {
				return '';
			}
			$ts = strtotime($mysql);
			return $ts ? date_i18n('Y/m/d H:i', $ts) : '';
		};

		return array(
			'configured'      => PYC_Settings::is_configured(),
			'auto_push'       => ('yes' === $opts['auto_push']),
			'last_sync_fa'    => $format($opts['last_sync_at']),
			'last_error'      => (string) $opts['last_error'],
			'last_synced'     => (int) $opts['last_synced'],
			'last_skipped'    => (int) $opts['last_skipped'],
			'last_push_count' => (int) $opts['last_push_count'],
			'retry_count'     => (int) $opts['retry_count'],
			'queue_count'     => count($queue),
			'logged_products' => PYC_DB::count_rows(),
			'next_cron_fa'    => $next_cron ? date_i18n('Y/m/d H:i', (int) $next_cron) : '',
		);
	}
}
