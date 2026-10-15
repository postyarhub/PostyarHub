<?php
/**
 * Plugin Name: پست‌یار برای وردپرس
 * Description: اتصال ساده وردپرس و ووکامرس به پست‌یار برای ارسال و انتشار خودکار محتوا در کانال‌های شما.
 * Version: 1.8.0
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Author: Postyar
 * License: GPLv2 or later
 */
if ( ! defined( 'ABSPATH' ) ) exit;
define( 'POSTYAR_WP_VERSION', '1.8.0' );
define( 'POSTYAR_WP_URL', plugin_dir_url( __FILE__ ) );
define( 'POSTYAR_WP_DIR', plugin_dir_path( __FILE__ ) );
require_once POSTYAR_WP_DIR . 'includes/class-postyar-api.php';
require_once POSTYAR_WP_DIR . 'includes/class-postyar-message.php';
require_once POSTYAR_WP_DIR . 'includes/class-postyar-plugin.php';
register_activation_hook( __FILE__, array( 'Postyar_WP_Plugin', 'activate' ) );
Postyar_WP_Plugin::boot();
