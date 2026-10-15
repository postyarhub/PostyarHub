<?php
/**
 * Settings model (single autoloaded option: pyc_options).
 *
 * قرارداد امنیتی:
 *  - site_secret هرگز به خروجی HTML، کوئری‌استرینگ، URL یا لاگ برگردانده نمی‌شود.
 *    فقط داخل هدر x-postyar-secret ارسال می‌شود (§31).
 *  - ذخیرهٔ تنظیمات همیشه merge با مقادیر موجود است تا باگ مرجع
 *    «ذخیرهٔ فرم ناقص، بقیهٔ تنظیمات را پاک می‌کند» (AUDIT MEDIUM) ریشه‌ای رفع شود.
 *
 * @package PostyarConnector
 */

defined('ABSPATH') || exit;

class PYC_Settings {

	const OPTION_KEY = 'pyc_options';

	/**
	 * Runtime cache.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Default option values.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'saas_url'        => '',
			'site_key'        => '',
			'site_secret'     => '',
			'auto_push'       => 'no',
			'price_mode'      => 'toman',
			'category_map'    => array(),
			'debug'           => 'no',
			// Runtime/status fields (kept in the same bag; never wiped on save).
			'last_error'      => '',
			'last_sync_at'    => '',
			'last_push_count' => 0,
			'last_synced'     => 0,
			'last_skipped'    => 0,
			'retry_count'     => 0,
		);
	}

	/**
	 * Merged (defaults + stored) options.
	 *
	 * @return array
	 */
	public static function all() {
		if (null === self::$cache) {
			$stored = get_option(self::OPTION_KEY, array());
			if (!is_array($stored)) {
				$stored = array();
			}
			self::$cache = array_merge(self::defaults(), $stored);
		}
		return self::$cache;
	}

	/**
	 * Single value accessor.
	 *
	 * @param string $key Option key.
	 * @return mixed
	 */
	public static function get($key) {
		$all = self::all();
		return isset($all[$key]) ? $all[$key] : '';
	}

	/**
	 * Merge-write: unknown/existing keys are preserved (root-cause fix of the
	 * reference settings-wipe bug). Never called with a partial-replace intent.
	 *
	 * @param array $next Key/value pairs to write on top of current values.
	 * @return void
	 */
	public static function update(array $next) {
		$merged = array_merge(self::all(), $next);

		if (isset($merged['category_map']) && !is_array($merged['category_map'])) {
			$merged['category_map'] = array();
		}

		update_option(self::OPTION_KEY, $merged);
		self::$cache = $merged;
	}

	/**
	 * Whether push is possible at all.
	 *
	 * @return bool
	 */
	public static function is_configured() {
		$all = self::all();
		return ('' !== $all['saas_url'] && '' !== $all['site_key'] && '' !== $all['site_secret']);
	}

	/**
	 * Sanitize the SaaS base URL (http/https only, no trailing slash).
	 *
	 * @param string $raw Raw value.
	 * @return string Sanitized value ('' when invalid).
	 */
	public static function sanitize_saas_url($raw) {
		$url = esc_url_raw(trim((string) $raw));
		if ('' === $url) {
			return '';
		}
		$scheme = parse_url($url, PHP_URL_SCHEME);
		$host   = parse_url($url, PHP_URL_HOST);
		if (!in_array($scheme, array('http', 'https'), true) || empty($host)) {
			return '';
		}
		return untrailingslashit($url);
	}

	/**
	 * Sanitize site_key / site_secret: keep hex chars only, lowercase, max 32.
	 *
	 * @param string $raw Raw value.
	 * @return string
	 */
	public static function sanitize_hex32($raw) {
		$hex = preg_replace('/[^0-9a-fA-F]/', '', (string) $raw);
		$hex = strtolower((string) $hex);
		return substr($hex, 0, 32);
	}

	/**
	 * Whether a value is a valid 32-char hex credential.
	 *
	 * @param string $value Candidate value.
	 * @return bool
	 */
	public static function is_valid_hex32($value) {
		return (bool) preg_match('/^[0-9a-f]{32}$/', (string) $value);
	}

	/**
	 * Never expose the secret. UI shows only a masked placeholder.
	 *
	 * @return string
	 */
	public static function secret_mask() {
		return ('' !== self::get('site_secret')) ? '••••••••••••••••' : '';
	}
}
