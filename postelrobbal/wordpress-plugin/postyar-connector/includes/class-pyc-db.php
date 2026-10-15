<?php
/**
 * DB layer: log table + schema install/upgrade.
 *
 * جدول {prefix}pyc_products_log:
 *   - wc_product_id  UNIQUE  → یک ردیف به‌ازای هر محصول
 *   - content_hash           → برای همگام‌سازی idempotent (§23): محصول بدون تغییر skip می‌شود
 *   - last_pushed_at         → آخرین ارسال موفق
 *   - published_at           → در v1 هیچ callback انتشار از سمت پُست‌یار به وردپرس وجود
 *                              ندارد (قرارداد API فقط push از سمت افزونه است)، بنابراین
 *                              این ستون NULL می‌ماند و برای سازگاری رو به جلو نگه داشته شده.
 *
 * همهٔ کوئری‌ها با $wpdb->prepare / wpdb->replace / wpdb->delete اجرا می‌شوند.
 *
 * @package PostyarConnector
 */

defined('ABSPATH') || exit;

class PYC_DB {

	/**
	 * Fully qualified table name.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'pyc_products_log';
	}

	/**
	 * Create/upgrade the log table (idempotent dbDelta) and stamp the DB version.
	 */
	public static function install() {
		global $wpdb;

		if (!function_exists('dbDelta')) {
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		}

		$table           = self::table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			wc_product_id bigint(20) unsigned NOT NULL,
			saas_site_key char(32) NOT NULL DEFAULT '',
			content_hash char(64) NOT NULL DEFAULT '',
			last_pushed_at datetime NULL DEFAULT NULL,
			published_at datetime NULL DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY wc_product_id (wc_product_id)
		) {$charset_collate};";

		dbDelta($sql);

		if (get_option('pyc_db_version') !== PYC_DB_VERSION) {
			update_option('pyc_db_version', PYC_DB_VERSION, false);
		}
	}

	/**
	 * Whether a product is unchanged since its last successful push
	 * (same content hash AND same site key).
	 *
	 * @param int    $wc_product_id WooCommerce product ID.
	 * @param string $content_hash  sha256 hex of the canonical payload.
	 * @param string $site_key      Current site key.
	 * @return bool
	 */
	public static function is_unchanged($wc_product_id, $content_hash, $site_key) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT content_hash, saas_site_key FROM ' . self::table_name() . ' WHERE wc_product_id = %d', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $wc_product_id
			)
		);

		if (!$row) {
			return false;
		}

		return ((string) $row->content_hash === (string) $content_hash && (string) $row->saas_site_key === (string) $site_key);
	}

	/**
	 * Insert or refresh the log row after a successful push.
	 * wc_product_id is UNIQUE so wpdb::replace performs a prepared upsert.
	 *
	 * @param int    $wc_product_id Product ID.
	 * @param string $site_key      Site key used for the push.
	 * @param string $content_hash  Payload hash.
	 * @param string $mysql_time    current_time('mysql').
	 * @return void
	 */
	public static function upsert_log($wc_product_id, $site_key, $content_hash, $mysql_time) {
		global $wpdb;

		$wpdb->replace(
			self::table_name(),
			array(
				'wc_product_id'  => (int) $wc_product_id,
				'saas_site_key'  => (string) $site_key,
				'content_hash'   => (string) $content_hash,
				'last_pushed_at' => (string) $mysql_time,
			),
			array('%d', '%s', '%s', '%s')
		);
	}

	/**
	 * Delete the log row of a product (deleted/trashed products are never pushed).
	 *
	 * @param int $wc_product_id Product ID.
	 * @return void
	 */
	public static function delete_log($wc_product_id) {
		global $wpdb;

		$wpdb->delete(
			self::table_name(),
			array('wc_product_id' => (int) $wc_product_id),
			array('%d')
		);
	}

	/**
	 * Count of logged products (diagnostics).
	 *
	 * @return int
	 */
	public static function count_rows() {
		global $wpdb;

		$value = $wpdb->get_var('SELECT COUNT(*) FROM ' . self::table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $value ? (int) $value : 0;
	}
}
