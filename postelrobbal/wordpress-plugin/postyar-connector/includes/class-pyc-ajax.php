<?php
/**
 * admin-ajax handlers. All responses are JSON.
 *
 * هر سهٔ هندلر: nonce «pyc_admin» + قابلیت manage_options (برخلاف نقاط ضعف
 * مرجع، هیچ هندلر بدون محافظ وجود ندارد و هیچ هندلر یتیمی ثبت نمی‌شود).
 *
 * @package PostyarConnector
 */

defined('ABSPATH') || exit;

class PYC_Ajax {

	/**
	 * Register hooks.
	 */
	public function __construct() {
		add_action('wp_ajax_pyc_test_connection', array($this, 'ajax_test_connection'));
		add_action('wp_ajax_pyc_sync_batch', array($this, 'ajax_sync_batch'));
		add_action('wp_ajax_pyc_sync_contents_batch', array($this, 'ajax_sync_contents_batch'));
		add_action('wp_ajax_pyc_get_status', array($this, 'ajax_get_status'));
	}

	/**
	 * Common guard: nonce + capability. (check_ajax_referer with $die=false
	 * returns instead of dying so we can emit a proper JSON error.)
	 */
	private function guard() {
		if (!check_ajax_referer('pyc_admin', 'nonce', false)) {
			wp_send_json_error(
				array('message' => 'نشست شما منقضی شده است؛ صفحه را دوباره بارگذاری کنید.'),
				403
			);
		}
		if (!current_user_can('manage_options')) {
			wp_send_json_error(
				array('message' => 'شما مجوز انجام این عملیات را ندارید.'),
				403
			);
		}
	}

	/**
	 * Test connection (ping — no data is sent).
	 */
	public function ajax_test_connection() {
		$this->guard();

		if (!PYC_Settings::is_configured()) {
			wp_send_json_error(array('message' => 'ابتدا آدرس پُست‌یار، site_key و secret را ذخیره کنید.'));
		}

		$res = PYC_Sync::test_connection();

		if (is_wp_error($res)) {
			wp_send_json_error(array('message' => $res->get_error_message()));
		}

		wp_send_json_success(array('message' => $res['message']));
	}

	/**
	 * One page of "sync all" (50 products per call) to keep requests bounded.
	 */
	public function ajax_sync_batch() {
		$this->guard();

		if (!PYC_Sync::wc_active()) {
			wp_send_json_error(array('message' => 'ووکامرس فعال نیست؛ همگام‌سازی امکان‌پذیر نیست.'));
		}
		if (!PYC_Settings::is_configured()) {
			wp_send_json_error(array('message' => 'تنظیمات اتصال کامل نیست؛ آدرس پُست‌یار، site_key و secret را ذخیره کنید.'));
		}

		$page = isset($_POST['page']) ? absint(wp_unslash($_POST['page'])) : 0;
		$page = max(1, $page);
		if ($page > 400) {
			// Hard bound: 400 pages × 50 = 20,000 products per run.
			wp_send_json_success(
				array(
					'done'        => true,
					'page'        => $page,
					'total_pages' => 0,
					'total'       => 0,
					'synced'      => 0,
					'skipped'     => 0,
				)
			);
		}

		$ids = wc_get_products(
			array(
				'status'  => 'publish',
				'limit'   => PYC_Sync::BATCH_SIZE,
				'page'    => $page,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'return'  => 'ids',
			)
		);

		if (!is_array($ids)) {
			$ids = array();
		}
		$ids = array_map('absint', $ids);

		$counts      = wp_count_posts('product');
		$total       = (isset($counts->publish)) ? (int) $counts->publish : 0;
		$total_pages = (int) ceil($total / PYC_Sync::BATCH_SIZE);

		if (empty($ids)) {
			wp_send_json_success(
				array(
					'done'        => true,
					'page'        => $page,
					'total_pages' => $total_pages,
					'total'       => $total,
					'synced'      => 0,
					'skipped'     => 0,
				)
			);
		}

		$res = PYC_Sync::push_products($ids, false, false);

		if (is_wp_error($res)) {
			wp_send_json_error(array('message' => $res->get_error_message()));
		}

		$done = ($page >= $total_pages) || count($ids) < PYC_Sync::BATCH_SIZE;

		wp_send_json_success(
			array(
				'done'        => $done,
				'page'        => $page,
				'total_pages' => $total_pages,
				'total'       => $total,
				'synced'      => (int) $res['synced'],
				'skipped'     => (int) $res['skipped'],
			)
		);
	}

	/**
	 * One page of article sync (50 published WordPress post IDs; connector sends small bounded API batches).
	 */
	public function ajax_sync_contents_batch() {
		$this->guard();
		if (!PYC_Settings::is_configured()) {
			wp_send_json_error(array('message' => 'تنظیمات اتصال کامل نیست؛ آدرس پُست‌یار، site_key و secret را ذخیره کنید.'));
		}
		$page = isset($_POST['page']) ? max(1, absint(wp_unslash($_POST['page']))) : 1;
		if ($page > 400) {
			wp_send_json_success(array('done' => true, 'page' => $page, 'total_pages' => 0, 'total' => 0, 'synced' => 0, 'skipped' => 0));
		}
		$ids = get_posts(array(
			'post_type' => 'post',
			'post_status' => 'publish',
			'posts_per_page' => PYC_Sync::BATCH_SIZE,
			'paged' => $page,
			'orderby' => 'ID',
			'order' => 'ASC',
			'fields' => 'ids',
			'no_found_rows' => false,
			'suppress_filters' => false,
		));
		$ids = is_array($ids) ? array_map('absint', $ids) : array();
		$counts = wp_count_posts('post');
		$total = isset($counts->publish) ? (int) $counts->publish : 0;
		$total_pages = (int) ceil($total / PYC_Sync::BATCH_SIZE);
		if (empty($ids)) {
			wp_send_json_success(array('done' => true, 'page' => $page, 'total_pages' => $total_pages, 'total' => $total, 'synced' => 0, 'skipped' => 0));
		}
		$res = PYC_Sync::push_contents($ids);
		if (is_wp_error($res)) {
			wp_send_json_error(array('message' => $res->get_error_message()));
		}
		$done = ($page >= $total_pages) || count($ids) < PYC_Sync::BATCH_SIZE;
		wp_send_json_success(array('done' => $done, 'page' => $page, 'total_pages' => $total_pages, 'total' => $total, 'synced' => (int) $res['synced'], 'skipped' => (int) $res['skipped']));
	}

	/**
	 * Status snapshot for the admin page.
	 */
	public function ajax_get_status() {
		$this->guard();

		wp_send_json_success(PYC_Sync::get_status_summary());
	}
}
