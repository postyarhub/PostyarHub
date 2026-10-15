<?php
/**
 * Plugin Name:       Postyar Connector
 * Plugin URI:        https://postyar.app
 * Description:       اتصال وردپرس/ووکامرس به پُست‌یار — همگام‌سازی مقالات و محصولات برای انتشار در کانال‌ها.
 * Version:           1.2.0
 * Author:            Postyar
 * Author URI:        https://postyar.app
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       postyar-connector
 * Domain Path:       /languages
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * WC requires at least: 4.0
 * WC tested up to:   9.0
 *
 * @package PostyarConnector
 */

/*
 * معماری ارتباط (v1):
 * این افزونه فقط «ارسال‌کننده» است. هیچ وب‌هوک ورودی، هیچ نقطهٔ REST و هیچ
 * مسیر unauthenticated (برخلاف افزونهٔ مرجع woo-hooman-channel-manager) وجود ندارد.
 * افزونه دادهٔ محصولات را با wp_remote_post به {saas_url}/api/v1/webhooks/wordpress
 * می‌فرستد و اعتبارنامه (site_key + secret) فقط و فقط داخل هدرهای
 * x-postyar-site-key و x-postyar-secret قرار می‌گیرد — هرگز در URL یا کوئری‌استرینگ.
 * سرور پُست‌یار SHA-256 هدر secret را به‌صورت timing-safe با hash ذخیره‌شده مقایسه می‌کند.
 */

defined('ABSPATH') || exit;

define('PYC_VERSION', '1.2.0');
define('PYC_DB_VERSION', '1.0.0');
define('PYC_PLUGIN_FILE', __FILE__);
define('PYC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PYC_PLUGIN_URL', plugin_dir_url(__FILE__));
define('PYC_WEBHOOK_PATH', '/api/v1/webhooks/wordpress');

require_once PYC_PLUGIN_DIR . 'includes/class-pyc-db.php';
require_once PYC_PLUGIN_DIR . 'includes/class-pyc-settings.php';
require_once PYC_PLUGIN_DIR . 'includes/class-pyc-sync.php';
require_once PYC_PLUGIN_DIR . 'includes/class-pyc-admin.php';
require_once PYC_PLUGIN_DIR . 'includes/class-pyc-ajax.php';

register_activation_hook(__FILE__, array('PYC_DB', 'install'));
register_deactivation_hook(__FILE__, array('PYC_Plugin', 'deactivate'));

/**
 * Main plugin bootstrap. Singleton; hooks are registered in boot().
 */
final class PYC_Plugin {

	/**
	 * @var PYC_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Singleton accessor.
	 *
	 * @return PYC_Plugin
	 */
	public static function instance() {
		if (null === self::$instance) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		add_action('plugins_loaded', array($this, 'boot'), 20);
	}

	/**
	 * Deactivation: clear all scheduled cron events of this plugin.
	 * (No gold ticker in this plugin — unlike the reference — so only sync hooks.)
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook('pyc_sync_cron');
		wp_clear_scheduled_hook('pyc_retry');
	}

	/**
	 * Boot after all plugins are loaded (WooCommerce included).
	 */
	public function boot() {
		load_plugin_textdomain('postyar-connector', false, dirname(plugin_basename(PYC_PLUGIN_FILE)) . '/languages');

		// Upgrade path: re-run idempotent dbDelta whenever the DB version changed.
		if (get_option('pyc_db_version') !== PYC_DB_VERSION) {
			PYC_DB::install();
		}

		new PYC_Sync();

		if (is_admin()) {
			new PYC_Admin();
			new PYC_Ajax();
		}
	}
}

/**
 * Global accessor.
 *
 * @return PYC_Plugin
 */
function pyc_plugin() {
	return PYC_Plugin::instance();
}

pyc_plugin();
