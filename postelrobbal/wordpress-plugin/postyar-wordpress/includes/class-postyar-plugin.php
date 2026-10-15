<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Postyar_WP_Plugin {
    const KEY = 'postyar_wp_site_key'; const SECRET = 'postyar_wp_secret'; const API_BASE = 'postyar_wp_api_base_url'; const ENABLED = 'postyar_wp_enabled'; const CHANNELS = 'postyar_wp_channels'; const TRIGGERS = 'postyar_wp_triggers'; const STYLE = 'postyar_wp_message_style'; const IMAGE = 'postyar_wp_send_image'; const LAST = 'postyar_wp_last_result';

    public static function boot() {
        add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
        add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
        add_action( 'admin_post_postyar_wp_save', array( __CLASS__, 'save' ) );
        add_action( 'admin_post_postyar_wp_disconnect', array( __CLASS__, 'disconnect' ) );
        add_action( 'admin_post_postyar_wp_sync', array( __CLASS__, 'sync' ) );
        add_action( 'admin_post_postyar_wp_sync_contents', array( __CLASS__, 'sync_contents' ) );
        add_action( 'admin_post_postyar_wp_send', array( __CLASS__, 'send_selected' ) );
        add_action( 'transition_post_status', array( __CLASS__, 'on_transition' ), 20, 3 );
        add_action( 'save_post', array( __CLASS__, 'on_save' ), 99, 3 );
        add_action( 'postyar_wp_process_event', array( __CLASS__, 'process_event' ), 10, 3 );
    }

    public static function assets( $hook ) {
        if ( $hook !== 'toplevel_page_postyar-wp' ) return;
        wp_enqueue_style( 'postyar-wp-admin', POSTYAR_WP_URL . 'assets/admin.css', array(), POSTYAR_WP_VERSION );
    }

    public static function activate() {
        add_option( self::ENABLED, 1 );
        add_option( self::CHANNELS, array() );
        add_option( self::TRIGGERS, array( 'product_new'=>1,'product_price'=>0,'product_stock'=>0,'product_update'=>0,'post_new'=>0,'post_update'=>0 ) );
        add_option( self::STYLE, 'shop' );
        add_option( self::IMAGE, 1 );
    }

    private static function connected() { return Postyar_WP_API::configured(); }
    private static function triggers() { return array_merge( array( 'product_new'=>1,'product_price'=>0,'product_stock'=>0,'product_update'=>0,'post_new'=>0,'post_update'=>0 ), (array) get_option( self::TRIGGERS, array() ) ); }
    private static function schedule_event( $post_id, $event, $old_price = null ) {
        $args = array( (int) $post_id, (string) $event, null === $old_price ? null : (string) $old_price );
        if ( ! wp_next_scheduled( 'postyar_wp_process_event', $args ) ) {
            wp_schedule_single_event( time() + 5, 'postyar_wp_process_event', $args );
        }
    }
    private static function redirect( $message ) { wp_safe_redirect( add_query_arg( array( 'page'=>'postyar-wp','postyar_message'=>$message ), admin_url( 'admin.php' ) ) ); exit; }
    private static function clean( $v ) { return trim( html_entity_decode( wp_strip_all_tags( (string)$v ), ENT_QUOTES, 'UTF-8' ) ); }

    public static function admin_menu() { add_menu_page( 'پست‌یار', 'پست‌یار', 'manage_options', 'postyar-wp', array( __CLASS__, 'page' ), 'dashicons-share', 58 ); }

    public static function save() {
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'اجازه کافی ندارید.' );
        check_admin_referer( 'postyar_wp_save' );
        $mode = sanitize_key( $_POST['postyar_action'] ?? '' );
        if ( 'connect' === $mode ) {
            $parsed = Postyar_WP_API::parse_connection_code( sanitize_text_field( wp_unslash( $_POST['connection_code'] ?? '' ) ) );
            if ( ! $parsed ) self::redirect( 'connect_error' );
            update_option( self::KEY, $parsed['site_key'], false ); update_option( self::SECRET, $parsed['secret'], false );
            if ( ! empty( $parsed['api_base_url'] ) ) update_option( self::API_BASE, $parsed['api_base_url'], false );
            $settings = Postyar_WP_API::request( 'GET', '/webhooks/wordpress/settings' );
            if ( is_wp_error( $settings ) ) { delete_option(self::KEY); delete_option(self::SECRET); delete_option(self::API_BASE); self::redirect('connect_error'); }
            self::pull( $settings ); self::redirect( 'connected' );
        }
        $enabled = ! empty( $_POST['enabled'] ) ? 1 : 0;
        $channels = isset( $_POST['channel_ids'] ) && is_array( $_POST['channel_ids'] ) ? array_slice( array_values( array_filter( array_map( 'sanitize_text_field', wp_unslash( $_POST['channel_ids'] ) ) ) ), 0, 5 ) : array();
        $triggers = self::triggers();
        foreach ( array_keys( $triggers ) as $key ) $triggers[$key] = ! empty( $_POST['trigger'][$key] ) ? 1 : 0;
        $style = sanitize_key( $_POST['message_style'] ?? 'shop' ); if ( ! in_array($style,array('shop','minimal','sale'),true) ) $style='shop';
        update_option(self::ENABLED,$enabled,false); update_option(self::CHANNELS,$channels,false); update_option(self::TRIGGERS,$triggers,false); update_option(self::STYLE,$style,false); update_option(self::IMAGE,!empty($_POST['send_image'])?1:0,false);
        if ( self::connected() ) {
            $res = Postyar_WP_API::request('PUT','/webhooks/wordpress/settings',array('autoPublish'=>(bool)$enabled,'channelIds'=>$channels,'automation'=>array('product_new'=>(bool)$triggers['product_new'],'product_price'=>(bool)$triggers['product_price'],'product_stock'=>(bool)$triggers['product_stock'],'product_update'=>(bool)$triggers['product_update'],'post_new'=>(bool)$triggers['post_new'],'post_update'=>(bool)$triggers['post_update']),'messageStyle'=>$style,'sendImage'=>(bool)get_option(self::IMAGE,1)));
            if ( is_wp_error($res) ) self::redirect('save_error');
        }
        self::redirect('saved');
    }

    public static function disconnect() { if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_disconnect'); delete_option(self::KEY); delete_option(self::SECRET); delete_option(self::API_BASE); self::redirect('disconnected'); }

    public static function sync() {
        if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_sync');
        if(!self::connected() || !function_exists('wc_get_products')) self::redirect('sync_error');
        $payload=array(); foreach(wc_get_products(array('status'=>'publish','limit'=>50,'return'=>'objects','orderby'=>'date','order'=>'DESC')) as $product) $payload[]=self::product_payload($product,null);
        $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'sync_products','products'=>$payload)); if(is_wp_error($res)) self::redirect('sync_error');
        update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false); self::redirect('sync_ok');
    }

    public static function sync_contents() {
        if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_sync_contents');
        if(!self::connected()) self::redirect('sync_error');
        $items=array();
        $posts=get_posts(array('post_type'=>array('post','page'),'post_status'=>'publish','posts_per_page'=>100,'orderby'=>'date','order'=>'DESC'));
        foreach($posts as $post){ $body=Postyar_WP_Message::post($post->ID); if(!$body) continue; $items[]=array('content_id'=>(int)$post->ID,'title'=>self::clean($post->post_title),'body'=>$body,'permalink'=>get_permalink($post->ID),'image_url'=>get_the_post_thumbnail_url($post->ID,'full'),'event_type'=>'update'); }
        if(!$items) self::redirect('sync_empty');
        $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'sync_contents','contents'=>$items)); if(is_wp_error($res)) self::redirect('sync_error');
        update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false); self::redirect('sync_ok');
    }

    public static function send_selected() {
        if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_send');
        if(!self::connected() || !function_exists('wc_get_product')) self::redirect('send_error');
        $ids=isset($_POST['product_ids'])&&is_array($_POST['product_ids'])?array_values(array_unique(array_map('absint',wp_unslash($_POST['product_ids'])))):array();
        $ids=array_slice(array_filter($ids),0,20);
        if(!$ids) self::redirect('send_error');
        $products=array();
        foreach($ids as $id){ $product=wc_get_product($id); if($product && 'publish'===$product->get_status()) $products[]=self::product_payload($product,null); }
        if(!$products) self::redirect('send_error');
        $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'manual_send_products','products'=>$products));
        if(is_wp_error($res)) self::redirect('send_error');
        update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false); self::redirect('send_ok');
    }

    public static function on_transition($new,$old,$post) {
        if(!self::connected() || !get_option(self::ENABLED,1) || !$post || 'publish'!==$new || 'publish'===$old) return;
        $triggers=self::triggers();
        if('product'===$post->post_type && !empty($triggers['product_new'])) { $product=function_exists('wc_get_product')?wc_get_product($post->ID):null; if($product){update_post_meta($post->ID,'_postyar_wp_snapshot',self::snapshot($product)); wp_schedule_single_event(time()+5,'postyar_wp_process_event',array((int)$post->ID,'product_new',null));} return; }
        if(in_array($post->post_type,array('post','page'),true) && !empty($triggers['post_new'])) { update_post_meta($post->ID,'_postyar_wp_post_hash',self::post_hash($post->ID)); self::schedule_event($post->ID,'post_new'); }
    }

    public static function on_save($post_id,$post,$update) {
        if(!self::connected() || !get_option(self::ENABLED,1) || wp_is_post_autosave($post_id) || wp_is_post_revision($post_id) || !$post || 'publish'!==$post->post_status || !$update) return;
        $triggers=self::triggers();
        if(in_array($post->post_type,array('product','product_variation'),true) && function_exists('wc_get_product')) {
            $source_id=(int)$post_id;
            $product=wc_get_product($source_id);
            if(!$product)return;
            $target_id='product_variation'===$post->post_type && method_exists($product,'get_parent_id') ? (int)$product->get_parent_id() : $source_id;
            if(!$target_id)return;
            $prev=(array)get_post_meta($source_id,'_postyar_wp_snapshot',true); $current=self::snapshot($product); update_post_meta($source_id,'_postyar_wp_snapshot',$current);
            if(isset($prev['price']) && !empty($triggers['product_price']) && (string)$prev['price']!==(string)$current['price']) self::schedule_event($target_id,'product_price',$prev['price']);
            elseif(isset($prev['stock']) && !empty($triggers['product_stock']) && (string)$prev['stock']!==(string)$current['stock']) self::schedule_event($target_id,'product_stock');
            elseif(isset($prev['hash']) && !empty($triggers['product_update']) && $prev['hash']!==$current['hash']) self::schedule_event($target_id,'product_update');
            return;
        }
        if(in_array($post->post_type,array('post','page'),true) && !empty($triggers['post_update'])) { $hash=self::post_hash($post_id); $prev=(string)get_post_meta($post_id,'_postyar_wp_post_hash',true); update_post_meta($post_id,'_postyar_wp_post_hash',$hash); if($prev && $prev!==$hash) self::schedule_event($post_id,'post_update'); }
    }

    public static function process_event($post_id,$event,$old_price=null) {
        if(!self::connected() || !get_option(self::ENABLED,1)) return;
        if(in_array($event,array('product_new','product_price','product_stock','product_update'),true) && function_exists('wc_get_product')) {
            $product=wc_get_product($post_id); if(!$product)return; $payload=self::product_payload($product,null); $payload['old_price_rial']=self::to_rial($old_price); $payload['event_type']=str_replace('product_','',$event);
            $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'sync_products','products'=>array($payload))); if(!is_wp_error($res))update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false); return;
        }
        if(in_array($event,array('post_new','post_update'),true)) {
            $body=Postyar_WP_Message::post($post_id); if(!$body)return; $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'publish_content','content'=>array('content_id'=>(int)$post_id,'title'=>get_the_title($post_id),'body'=>$body,'permalink'=>get_permalink($post_id),'image_url'=>get_the_post_thumbnail_url($post_id,'full'),'event_type'=>'post_new'===$event?'new':'update'))); if(!is_wp_error($res))update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false);
        }
    }

    private static function snapshot($product) { return array('price'=>(string)$product->get_price(),'stock'=>(string)$product->get_stock_status(),'hash'=>md5(wp_json_encode(array($product->get_name(),$product->get_short_description(),$product->get_price(),$product->get_stock_status(),$product->get_permalink())))); }
    private static function post_hash($post_id) { $post=get_post($post_id); return md5(wp_json_encode(array($post?$post->post_title:'',$post?$post->post_excerpt:'',$post?$post->post_content:'',get_permalink($post_id)))); }
    private static function to_rial($value) { if(''===$value||null===$value)return null; $currency=function_exists('get_woocommerce_currency')?get_woocommerce_currency():''; return in_array($currency,array('IRT','IRR'),true)?(int)round((float)$value*('IRT'===$currency?10:1)):null; }
    private static function product_payload($product,$previous) { $currency=function_exists('get_woocommerce_currency')?get_woocommerce_currency():''; $supported=in_array($currency,array('IRT','IRR'),true); $description=self::clean($product->get_description()); if(''===$description) $description=self::clean($product->get_short_description()); return array('wc_id'=>(int)$product->get_id(),'title'=>self::clean($product->get_name()),'price_rial'=>$supported?self::to_rial($product->get_price()):null,'regular_price_rial'=>$supported?self::to_rial($product->get_regular_price()):null,'sale_price_rial'=>$supported?self::to_rial($product->get_sale_price()):null,'old_price_rial'=>is_array($previous)?self::to_rial($previous['price']??null):null,'stock_status'=>$product->get_stock_status(),'is_featured'=>$product->is_featured()?1:0,'sales_count'=>(int)$product->get_total_sales(),'sku'=>$product->get_sku(),'excerpt'=>wp_trim_words(wp_strip_all_tags($product->get_short_description()),60),'body'=>function_exists('mb_substr')?mb_substr($description,0,20000):substr($description,0,20000),'permalink'=>get_permalink($product->get_id()),'image_url'=>get_the_post_thumbnail_url($product->get_id(),'full')); }
    private static function pull($data) { if(isset($data['autoPublish']))update_option(self::ENABLED,(int)!!$data['autoPublish'],false); if(isset($data['channelIds'])&&is_array($data['channelIds']))update_option(self::CHANNELS,$data['channelIds'],false); if(isset($data['automation'])&&is_array($data['automation']))update_option(self::TRIGGERS,array_merge(self::triggers(),$data['automation']),false); if(isset($data['messageStyle']))update_option(self::STYLE,sanitize_key($data['messageStyle']),false); if(isset($data['sendImage']))update_option(self::IMAGE,(int)!!$data['sendImage'],false); }

    public static function page() {
        if ( ! current_user_can( 'manage_options' ) ) return;

        $notice = sanitize_key( $_GET['postyar_message'] ?? '' );
        $tab = sanitize_key( $_GET['tab'] ?? 'overview' );
        $allowed_tabs = array( 'overview', 'automatic', 'sync', 'manual' );
        if ( ! in_array( $tab, $allowed_tabs, true ) ) $tab = 'overview';

        $connected = self::connected();
        $channels = array();
        if ( $connected ) {
            $data = Postyar_WP_API::request( 'GET', '/webhooks/wordpress/settings' );
            if ( ! is_wp_error( $data ) ) {
                self::pull( $data );
                $channels = is_array( $data['channels'] ?? null ) ? $data['channels'] : array();
            }
        }

        $selected  = get_option( self::CHANNELS, null );
        $triggers  = self::triggers();
        $style     = get_option( self::STYLE, 'shop' );
        $enabled   = (bool) get_option( self::ENABLED, 1 );
        $last      = json_decode( (string) get_option( self::LAST, '' ), true );

        echo '<div class="wrap postyar-admin" dir="rtl">';
        echo '<div class="postyar-hero">';
        echo '<div class="postyar-brand"><img class="postyar-logo-img" src="' . esc_url( POSTYAR_WP_URL . 'assets/logo-full.webp' ) . '" alt="پست‌یار"/><div><h1>پست‌یار</h1><p>مدیریت ساده و حرفه‌ای انتشار سایت در کانال‌ها</p></div></div>';
        echo '<span class="postyar-status ' . ( $connected ? 'is-on' : 'is-off' ) . '">' . ( $connected ? '● متصل و فعال' : '○ هنوز متصل نشده' ) . '</span>';
        echo '</div>';
        self::notice( $notice );

        if ( ! $connected ) {
            echo '<div class="postyar-connect-grid"><section class="postyar-connect-card postyar-primary-card"><span class="postyar-step-badge">شروع سریع</span><h2>سایت خود را به پست‌یار وصل کنید</h2><p class="postyar-lead">کد اتصال را از داشبورد پست‌یار بردارید و اینجا وارد کنید. بعد از اتصال، کانال‌ها و تنظیمات انتشار را بدون هیچ کدنویسی مدیریت می‌کنید.</p><div class="postyar-steps"><div><b>۱</b><span>در داشبورد پست‌یار «اتصال سایت جدید» را بزنید.</span></div><div><b>۲</b><span>کد اتصال را کپی کنید.</span></div><div><b>۳</b><span>کد را اینجا وارد کنید و اتصال را بزنید.</span></div></div><form class="postyar-connect-form" method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="postyar_wp_save"><input type="hidden" name="postyar_action" value="connect">';
            wp_nonce_field( 'postyar_wp_save' );
            echo '<label for="postyar-connection-code">کد اتصال</label><input id="postyar-connection-code" name="connection_code" type="text" autocomplete="off" placeholder="کد اتصال را اینجا وارد کنید" /><button class="button button-primary postyar-main-button">اتصال سایت به پست‌یار</button><p class="postyar-safe-note">کد اتصال فقط برای برقراری ارتباط امن با حساب شما استفاده می‌شود.</p></form></section>';
            echo '<aside class="postyar-side-card"><div class="postyar-icon-box">✓</div><h3>بعد از اتصال چه می‌شود؟</h3><ul><li>کانال‌های فعال شما در همین صفحه دیده می‌شوند.</li><li>می‌توانید ارسال خودکار را روشن یا خاموش کنید.</li><li>محصولات و نوشته‌های سایت در داشبورد پست‌یار قرار می‌گیرند.</li></ul></aside></div></div>';
            return;
        }

        $tabs = array(
            'overview'  => array( 'وضعیت سایت', 'وضعیت اتصال و خلاصه تنظیمات' ),
            'automatic' => array( 'ارسال خودکار', 'انتخاب اتفاق‌هایی که باعث انتشار می‌شوند' ),
            'sync'      => array( 'همگام‌سازی', 'فرستادن محتوای سایت به داشبورد' ),
            'manual'    => array( 'ارسال دستی', 'انتخاب چند محصول و ارسال فوری' ),
        );
        echo '<div class="postyar-tabs" role="tablist">';
        foreach ( $tabs as $key => $row ) {
            echo '<a class="postyar-tab ' . ( $tab === $key ? 'is-active' : '' ) . '" href="' . esc_url( add_query_arg( array( 'page' => 'postyar-wp', 'tab' => $key ), admin_url( 'admin.php' ) ) ) . '"><strong>' . esc_html( $row[0] ) . '</strong><small>' . esc_html( $row[1] ) . '</small></a>';
        }
        echo '</div>';

        if ( 'overview' === $tab ) {
            echo '<section class="postyar-section postyar-overview-card"><div class="postyar-section-head"><div><h2>اتصال سایت برقرار است</h2><p>این سایت آماده ارسال محتوا از طریق پست‌یار است.</p></div><span class="postyar-status is-on">● متصل</span></div><div class="postyar-section-body"><div class="postyar-overview-grid"><div class="postyar-overview-stat"><small>وضعیت ووکامرس</small><strong>' . ( function_exists( 'wc_get_products' ) ? 'فعال' : 'غیرفعال' ) . '</strong><span>' . ( function_exists( 'wc_get_products' ) ? 'محصولات فروشگاه قابل همگام‌سازی هستند.' : 'برای محصولات، ووکامرس را فعال کنید.' ) . '</span></div><div class="postyar-overview-stat"><small>ارسال خودکار</small><strong>' . ( $enabled ? 'روشن' : 'خاموش' ) . '</strong><span>از بخش «ارسال خودکار» قابل تغییر است.</span></div><div class="postyar-overview-stat"><small>کانال‌های انتخاب‌شده</small><strong>' . esc_html( number_format_i18n( is_array( $selected ) ? count( $selected ) : count( $channels ) ) ) . '</strong><span>هر کانال با نام پلتفرم مشخص نمایش داده می‌شود.</span></div></div></div></section>';
            echo '<div class="postyar-two-col"><section class="postyar-section"><div class="postyar-section-head"><div><h2>کانال‌های متصل</h2><p>کانال‌هایی که این سایت می‌تواند برای انتشار از آن‌ها استفاده کند.</p></div></div><div class="postyar-section-body">';
            if ( ! $channels ) echo '<div class="postyar-empty">هنوز کانال فعالی در پست‌یار ندارید.</div>';
            else { echo '<div class="postyar-channel-grid">'; foreach ( $channels as $channel ) { $pf = (string) ( $channel['platform'] ?? '' ); $pfFa = $pf === 'telegram' ? 'تلگرام' : ( $pf === 'bale' ? 'بله' : ( $pf === 'rubika' ? 'روبیکا' : $pf ) ); $isSelected = ! is_array( $selected ) || in_array( $channel['id'], $selected, true ); echo '<div class="postyar-channel-card ' . ( $isSelected ? 'is-selected' : '' ) . '"><span class="postyar-channel-platform"><b>' . esc_html( $pfFa ) . '</b></span><div><strong>' . esc_html( $channel['title'] ?? '' ) . '</strong><small dir="ltr">' . esc_html( $channel['channelRef'] ?? '' ) . '</small></div></div>'; } echo '</div>'; }
            echo '</div></section>';
            echo '<section class="postyar-section"><div class="postyar-section-head"><div><h2>راهنمای شروع</h2><p>سه کار ساده برای انتشار حرفه‌ای</p></div></div><div class="postyar-section-body"><div class="postyar-guide-list"><div><b>۱</b><span>از «همگام‌سازی» محصولات و نوشته‌ها را به داشبورد بفرستید.</span></div><div><b>۲</b><span>در داشبورد عنوان، متن، تصویر و کانال‌ها را انتخاب کنید.</span></div><div><b>۳</b><span>برای انتشار خودکار، رویدادهای موردنظر را از بخش «ارسال خودکار» روشن کنید.</span></div></div></div></section></div>';
            echo '<div class="postyar-actions"><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">'; wp_nonce_field( 'postyar_wp_disconnect' ); echo '<input type="hidden" name="action" value="postyar_wp_disconnect"><button class="button postyar-danger-button">قطع اتصال سایت</button></form></div>';
        }

        if ( 'automatic' === $tab ) {
            echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">'; wp_nonce_field( 'postyar_wp_save' ); echo '<input type="hidden" name="action" value="postyar_wp_save">';
            echo '<section class="postyar-section"><div class="postyar-section-head"><div><h2>ارسال خودکار</h2><p>بدون نوشتن کد، مشخص کنید چه اتفاق‌هایی باعث ارسال شوند.</p></div><span class="postyar-status ' . ( $enabled ? 'is-on' : 'is-off' ) . '">' . ( $enabled ? 'فعال' : 'خاموش' ) . '</span></div><div class="postyar-section-body"><label class="postyar-switch-row"><span><strong>ارسال خودکار روشن باشد</strong><small>وقتی یکی از اتفاق‌های زیر رخ بدهد، پست‌یار خودش انتشار را انجام می‌دهد.</small></span><span><input type="checkbox" name="enabled" value="1" ' . checked( $enabled, true, false ) . '><i class="postyar-switch"></i></span></label>';
            $labels = array( 'product_new'=>array('محصول جدید','وقتی محصول جدید منتشر می‌شود.'),'product_price'=>array('تغییر قیمت محصول','وقتی قیمت محصول تغییر می‌کند.'),'product_stock'=>array('تغییر موجودی','وقتی محصول موجود یا ناموجود می‌شود.'),'product_update'=>array('ویرایش محصول','وقتی اطلاعات محصول تغییر می‌کند.'),'post_new'=>array('نوشته یا برگه جدید','وقتی نوشته یا برگه منتشر می‌شود.'),'post_update'=>array('ویرایش نوشته یا برگه','وقتی محتوای نوشته یا برگه تغییر می‌کند.') );
            foreach ( $labels as $key => $row ) echo '<label class="postyar-switch-row"><span><strong>' . esc_html( $row[0] ) . '</strong><small>' . esc_html( $row[1] ) . '</small></span><span><input type="checkbox" name="trigger[' . esc_attr( $key ) . ']" value="1" ' . checked( ! empty( $triggers[$key] ), true, false ) . '><i class="postyar-switch"></i></span></label>';
            echo '</div></section>';
            echo '<div class="postyar-two-col"><section class="postyar-section"><div class="postyar-section-head"><div><h2>کانال‌های پیش‌فرض</h2><p>کانال‌هایی که ارسال خودکار این سایت از آن‌ها استفاده می‌کند.</p></div></div><div class="postyar-section-body">';
            if ( ! $channels ) echo '<div class="postyar-empty">هنوز کانال فعالی در پست‌یار ندارید.</div>'; else { echo '<div class="postyar-channel-grid">'; foreach ( $channels as $channel ) { $pf=(string)($channel['platform']??''); $pfFa=$pf==='telegram'?'تلگرام':($pf==='bale'?'بله':($pf==='rubika'?'روبیکا':$pf)); echo '<label class="postyar-channel"><input type="checkbox" name="channel_ids[]" value="' . esc_attr( $channel['id'] ) . '" ' . checked( ! is_array($selected) || in_array($channel['id'],$selected,true), true, false ) . '><span><strong>' . esc_html($channel['title']??'') . '</strong><small><b>' . esc_html($pfFa) . '</b> · <span dir="ltr">' . esc_html($channel['channelRef']??'') . '</span></small></span></label>'; } echo '</div>'; }
            echo '</div></section>';
            echo '<section class="postyar-section"><div class="postyar-section-head"><div><h2>ظاهر پیام</h2><p>فقط مدل نمایش را انتخاب کنید؛ نیازی به قالب‌نویسی نیست.</p></div></div><div class="postyar-section-body"><div class="postyar-style-grid">';
            $styles=array('shop'=>array('فروشگاهی و کامل','عنوان، قیمت، وضعیت و لینک'),'minimal'=>array('ساده و کوتاه','پیام جمع‌وجور و مینیمال'),'sale'=>array('فروش ویژه','مناسب محصولات تخفیف‌دار')); foreach($styles as $key=>$row) echo '<label class="postyar-style-card '.($style===$key?'is-selected':'').'" ><input type="radio" name="message_style" value="'.esc_attr($key).'" '.checked($style,$key,false).'><span><strong>'.esc_html($row[0]).'</strong><small>'.esc_html($row[1]).'</small></span></label>'; echo '</div><label class="postyar-switch-row"><span><strong>تصویر شاخص هم ارسال شود</strong><small>تصویر اصلی محصول یا نوشته همراه پیام ارسال می‌شود.</small></span><span><input type="checkbox" name="send_image" value="1" '.checked(get_option(self::IMAGE,1),true,false).'><i class="postyar-switch"></i></span></label></div></section></div>';
            echo '<div class="postyar-actions"><button class="button button-primary button-large">ذخیره تنظیمات</button></div></form>';
        }

        if ( 'sync' === $tab ) {
            echo '<div class="postyar-two-col"><section class="postyar-section"><div class="postyar-section-head"><div><h2>همگام‌سازی محصولات</h2><p>محصولات منتشرشده را از ووکامرس به داشبورد پست‌یار بفرستید.</p></div></div><div class="postyar-section-body"><div class="postyar-wc-status ' . (function_exists('wc_get_products')?'is-active':'is-inactive') . '">' . (function_exists('wc_get_products')?'ووکامرس فعال است.':'ووکامرس فعال نیست.') . '</div><div class="postyar-sync-card"><span>همگام‌سازی حداکثر ۵۰ محصول آخر</span><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('postyar_wp_sync'); echo '<input type="hidden" name="action" value="postyar_wp_sync"><button class="button button-primary">همگام‌سازی محصولات</button></form></div></div></section>';
            echo '<section class="postyar-section"><div class="postyar-section-head"><div><h2>همگام‌سازی نوشته‌ها و برگه‌ها</h2><p>۱۰۰ محتوای منتشرشدهٔ اخیر را برای مدیریت و انتشار در داشبورد قرار دهید.</p></div></div><div class="postyar-section-body"><div class="postyar-sync-card"><span>نوشته و برگه</span><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('postyar_wp_sync_contents'); echo '<input type="hidden" name="action" value="postyar_wp_sync_contents"><button class="button button-primary">همگام‌سازی نوشته‌ها</button></form></div></div></section></div>';
            if ( $last ) { $summary = isset($last['synced']) ? 'تعداد همگام‌سازی: ' . number_format_i18n((int)$last['synced']) : 'آخرین نتیجه دریافت شد.'; echo '<section class="postyar-section"><div class="postyar-section-body"><div class="postyar-last-result"><strong>آخرین نتیجه</strong><span>' . esc_html($summary) . '</span></div></div></section>'; }
        }

        if ( 'manual' === $tab ) {
            echo '<section class="postyar-section"><div class="postyar-section-head"><div><h2>ارسال دستی محصولات</h2><p>چند محصول را انتخاب کنید و همان لحظه برای کانال‌های سایت ارسال کنید.</p></div><span class="postyar-step-badge">حداکثر ۲۰ محصول</span></div><div class="postyar-section-body">';
            if ( ! function_exists('wc_get_products') ) echo '<div class="postyar-empty">برای این بخش ابتدا ووکامرس را فعال کنید.</div>'; else { $recent_products=wc_get_products(array('status'=>'publish','limit'=>20,'return'=>'objects','orderby'=>'date','order'=>'DESC')); if(!$recent_products) echo '<div class="postyar-empty">هنوز محصول منتشرشده‌ای پیدا نشد.</div>'; else { echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><div class="postyar-product-list">'; foreach($recent_products as $product) { echo '<label><input type="checkbox" name="product_ids[]" value="'.esc_attr($product->get_id()).'"><span><strong>'.esc_html(self::clean($product->get_name())).'</strong><small>'.esc_html(get_permalink($product->get_id())).'</small></span></label>'; } echo '</div>'; wp_nonce_field('postyar_wp_send'); echo '<input type="hidden" name="action" value="postyar_wp_send"><button class="button button-primary button-large">ارسال محصولات انتخاب‌شده</button></form>'; } }
            echo '</div></section>';
        }

        echo '<div class="postyar-footer-note">پست‌یار برای کاربر معمولی ساخته شده است؛ همه کارها از طریق دکمه‌ها و انتخاب‌های ساده انجام می‌شود و نیازی به کدنویسی یا شورتکد نیست.</div>';
        echo '</div>';
    }

    private static function notice($notice){$map=array('connected'=>array('success','سایت با موفقیت متصل شد.'),'saved'=>array('success','تنظیمات ذخیره شد.'),'disconnected'=>array('success','اتصال قطع شد.'),'sync_ok'=>array('success','همگام‌سازی انجام شد.'),'sync_empty'=>array('info','محتوای قابل همگام‌سازی پیدا نشد.'),'send_ok'=>array('success','محصولات انتخاب‌شده برای ارسال به پست‌یار سپرده شدند.'),'connect_error'=>array('error','اتصال انجام نشد.'),'save_error'=>array('error','ذخیره تنظیمات انجام نشد.'),'sync_error'=>array('error','همگام‌سازی انجام نشد.'),'send_error'=>array('error','ارسال محصولات انجام نشد.'));if(empty($map[$notice]))return;$i=$map[$notice];echo '<div class="notice notice-'.$i[0].'"><p>'.esc_html($i[1]).'</p></div>';}
}
