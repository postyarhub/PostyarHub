<?php
/**
 * Uninstall cleanup — full wipe (root-cause fix of the reference uninstall miss
 * that left the whcm_post_channel_stats table and per-channel options behind).
 *
 * Removes:
 *  - table {prefix}pyc_products_log (per site on multisite)
 *  - options pyc_options, pyc_db_version, pyc_queue
 *  - scheduled events pyc_sync_cron, pyc_retry
 *
 * @package PostyarConnector
 */

defined('WP_UNINSTALL_PLUGIN') || exit;

global $wpdb;

/**
 * Clean one blog.
 */
function pyc_uninstall_site() {
	global $wpdb;

	delete_option('pyc_options');
	delete_option('pyc_db_version');
	delete_option('pyc_queue');

	// Identifier is built from $wpdb->prefix only — no user input involved.
	$table = $wpdb->prefix . 'pyc_products_log';
	$wpdb->query("DROP TABLE IF EXISTS `{$table}`"); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery

	wp_clear_scheduled_hook('pyc_sync_cron');
	wp_clear_scheduled_hook('pyc_retry');
}

if (is_multisite()) {
	$site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ($site_ids as $site_id) {
		switch_to_blog((int) $site_id);
		pyc_uninstall_site();
		restore_current_blog();
	}
} else {
	pyc_uninstall_site();
}
