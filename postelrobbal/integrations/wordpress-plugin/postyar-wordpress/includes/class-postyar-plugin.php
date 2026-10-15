<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Postyar_WP_Plugin {
    const KEY = 'postyar_wp_site_key'; const SECRET = 'postyar_wp_secret'; const ENABLED = 'postyar_wp_enabled'; const CHANNELS = 'postyar_wp_channels'; const TRIGGERS = 'postyar_wp_triggers'; const STYLE = 'postyar_wp_message_style'; const IMAGE = 'postyar_wp_send_image'; const LAST = 'postyar_wp_last_result';

    public static function boot() {
        add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
        add_action( 'admin_post_postyar_wp_save', array( __CLASS__, 'save' ) );
        add_action( 'admin_post_postyar_wp_disconnect', array( __CLASS__, 'disconnect' ) );
        add_action( 'admin_post_postyar_wp_sync', array( __CLASS__, 'sync' ) );
        add_action( 'admin_post_postyar_wp_send', array( __CLASS__, 'send_selected' ) );
        add_action( 'transition_post_status', array( __CLASS__, 'on_transition' ), 20, 3 );
        add_action( 'save_post', array( __CLASS__, 'on_save' ), 99, 3 );
        add_action( 'postyar_wp_process_event', array( __CLASS__, 'process_event' ), 10, 3 );
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
            $settings = Postyar_WP_API::request( 'GET', '/webhooks/wordpress/settings' );
            if ( is_wp_error( $settings ) ) { delete_option(self::KEY); delete_option(self::SECRET); self::redirect('connect_error'); }
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

    public static function disconnect() { if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_disconnect'); delete_option(self::KEY); delete_option(self::SECRET); self::redirect('disconnected'); }

    public static function sync() {
        if(!current_user_can('manage_options')) wp_die('اجازه کافی ندارید.'); check_admin_referer('postyar_wp_sync');
        if(!self::connected() || !function_exists('wc_get_products')) self::redirect('sync_error');
        $payload=array(); foreach(wc_get_products(array('status'=>'publish','limit'=>50,'return'=>'objects','orderby'=>'date','order'=>'DESC')) as $product) $payload[]=self::product_payload($product,null);
        $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'sync_products','products'=>$payload)); if(is_wp_error($res)) self::redirect('sync_error');
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
            $body=Postyar_WP_Message::post($post_id); if(!$body)return; $res=Postyar_WP_API::request('POST','/webhooks/wordpress',array('action'=>'publish_content','content'=>array('content_id'=>(int)$post_id,'title'=>get_the_title($post_id),'body'=>$body,'permalink'=>get_permalink($post_id),'event_type'=>'post_new'===$event?'new':'update'))); if(!is_wp_error($res))update_option(self::LAST,wp_json_encode($res,JSON_UNESCAPED_UNICODE),false);
        }
    }

    private static function snapshot($product) { return array('price'=>(string)$product->get_price(),'stock'=>(string)$product->get_stock_status(),'hash'=>md5(wp_json_encode(array($product->get_name(),$product->get_short_description(),$product->get_price(),$product->get_stock_status(),$product->get_permalink())))); }
    private static function post_hash($post_id) { $post=get_post($post_id); return md5(wp_json_encode(array($post?$post->post_title:'',$post?$post->post_excerpt:'',$post?$post->post_content:'',get_permalink($post_id)))); }
    private static function to_rial($value) { if(''===$value||null===$value)return null; $currency=function_exists('get_woocommerce_currency')?get_woocommerce_currency():''; return in_array($currency,array('IRT','IRR'),true)?(int)round((float)$value*('IRT'===$currency?10:1)):null; }
    private static function product_payload($product,$previous) { $currency=function_exists('get_woocommerce_currency')?get_woocommerce_currency():''; $supported=in_array($currency,array('IRT','IRR'),true); return array('wc_id'=>(int)$product->get_id(),'title'=>self::clean($product->get_name()),'price_rial'=>$supported?self::to_rial($product->get_price()):null,'regular_price_rial'=>$supported?self::to_rial($product->get_regular_price()):null,'sale_price_rial'=>$supported?self::to_rial($product->get_sale_price()):null,'old_price_rial'=>is_array($previous)?self::to_rial($previous['price']??null):null,'stock_status'=>$product->get_stock_status(),'sku'=>$product->get_sku(),'excerpt'=>wp_trim_words(wp_strip_all_tags($product->get_short_description()),40),'permalink'=>get_permalink($product->get_id()),'image_url'=>get_the_post_thumbnail_url($product->get_id(),'full')); }
    private static function pull($data) { if(isset($data['autoPublish']))update_option(self::ENABLED,(int)!!$data['autoPublish'],false); if(isset($data['channelIds'])&&is_array($data['channelIds']))update_option(self::CHANNELS,$data['channelIds'],false); if(isset($data['automation'])&&is_array($data['automation']))update_option(self::TRIGGERS,array_merge(self::triggers(),$data['automation']),false); if(isset($data['messageStyle']))update_option(self::STYLE,sanitize_key($data['messageStyle']),false); if(isset($data['sendImage']))update_option(self::IMAGE,(int)!!$data['sendImage'],false); }

    public static function page() {
        if(!current_user_can('manage_options'))return; $notice=sanitize_key($_GET['postyar_message']??''); $connected=self::connected(); $channels=array();
        if($connected){$data=Postyar_WP_API::request('GET','/webhooks/wordpress/settings'); if(!is_wp_error($data)){self::pull($data);$channels=is_array($data['channels']??null)?$data['channels']:array();} }
        $selected=get_option(self::CHANNELS,null); $triggers=self::triggers(); $style=get_option(self::STYLE,'shop'); $enabled=(bool)get_option(self::ENABLED,1);
        echo '<div class="wrap" dir="rtl" style="max-width:1050px"><h1>پست‌یار</h1><p>ارسال ساده و خودکار نوشته‌ها و محصولات سایت به کانال‌های شما.</p>'; self::notice($notice);
        if(!$connected){ echo '<div class="card" style="padding:22px;max-width:760px"><h2>اتصال سایت</h2><p>در پست‌یار «کد اتصال» را بگیرید و همین‌جا وارد کنید.</p><form method="post" action="'.esc_url(admin_url('admin-post.php')).'">'; wp_nonce_field('postyar_wp_save'); echo '<input type="hidden" name="action" value="postyar_wp_save"><input type="hidden" name="postyar_action" value="connect"><p><input name="connection_code" class="regular-text" style="width:100%;direction:ltr" autocomplete="off" placeholder="کد اتصال"></p><p><button class="button button-primary button-large">اتصال</button></p></form></div></div>'; return; }
        echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">'; wp_nonce_field('postyar_wp_save'); echo '<input type="hidden" name="action" value="postyar_wp_save">';
        echo '<h2>چه چیزهایی خودکار فرستاده شوند؟</h2><p><label><input type="checkbox" name="enabled" value="1" '.checked($enabled,true,false).'> ارسال خودکار روشن باشد</label></p>';
        $labels=array('product_new'=>'محصول جدید','product_price'=>'تغییر قیمت محصول','product_stock'=>'تغییر موجودی محصول','product_update'=>'ویرایش اطلاعات محصول','post_new'=>'نوشته یا برگه جدید','post_update'=>'ویرایش نوشته یا برگه');
        foreach($labels as $key=>$label) echo '<p><label><input type="checkbox" name="trigger['.esc_attr($key).']" value="1" '.checked(!empty($triggers[$key]),true,false).'> '.esc_html($label).'</label></p>';
        echo '<h2>کانال‌ها</h2>'; if(!$channels) echo '<p>هنوز کانال فعالی در پست‌یار ندارید.</p>'; else { echo '<p style="color:#666">اگر کانالی را انتخاب نکنید، همه کانال‌های فعال استفاده می‌شوند.</p>'; $checkedAll = !is_array($selected); foreach($channels as $channel) echo '<p><label><input type="checkbox" name="channel_ids[]" value="'.esc_attr($channel['id']).'" '.checked($checkedAll || in_array($channel['id'],$selected,true),true,false).'> '.esc_html($channel['title']).' — '.esc_html($channel['platform']).'</label></p>'; }
        echo '<h2>شکل پیام</h2><p><select name="message_style"><option value="shop" '.selected($style,'shop',false).'>فروشگاهی و کامل</option><option value="minimal" '.selected($style,'minimal',false).'>ساده و کوتاه</option><option value="sale" '.selected($style,'sale',false).'>فروش ویژه</option></select></p><p><label><input type="checkbox" name="send_image" value="1" '.checked(get_option(self::IMAGE,1),true,false).'> تصویر محصول هم فرستاده شود</label></p><p><button class="button button-primary button-large">ذخیره تنظیمات</button></p></form>';
        echo '<hr><p><strong>ووکامرس:</strong> '.(function_exists('wc_get_products')?'فعال':'غیرفعال').'</p>';
        if(function_exists('wc_get_products')){
            $recent_products=wc_get_products(array('status'=>'publish','limit'=>20,'return'=>'objects','orderby'=>'date','order'=>'DESC'));
            echo '<h2>ارسال دستی</h2><p style="color:#666">چند محصول را انتخاب کنید و بدون تغییر تنظیمات ارسال خودکار، همان‌ها را همین حالا برای کانال‌های انتخاب‌شده بفرستید.</p>';
            if(!$recent_products) echo '<p>هنوز محصول منتشرشده‌ای پیدا نشد.</p>';
            else { echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">'; wp_nonce_field('postyar_wp_send'); echo '<input type="hidden" name="action" value="postyar_wp_send">'; foreach($recent_products as $product) echo '<p><label><input type="checkbox" name="product_ids[]" value="'.esc_attr($product->get_id()).'"> '.esc_html(self::clean($product->get_name())).'</label></p>'; echo '<p><button class="button button-primary">ارسال محصولات انتخاب‌شده</button></p></form>'; }
            echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'" style="display:inline">'; wp_nonce_field('postyar_wp_sync'); echo '<input type="hidden" name="action" value="postyar_wp_sync"><button class="button">همگام‌سازی محصولات</button></form>';
        }
        echo ' <form method="post" action="'.esc_url(admin_url('admin-post.php')).'" style="display:inline;margin-right:8px">'; wp_nonce_field('postyar_wp_disconnect'); echo '<input type="hidden" name="action" value="postyar_wp_disconnect"><button class="button">قطع اتصال</button></form></div>';
    }

    private static function notice($notice){$map=array('connected'=>array('success','سایت با موفقیت متصل شد.'),'saved'=>array('success','تنظیمات ذخیره شد.'),'disconnected'=>array('success','اتصال قطع شد.'),'sync_ok'=>array('success','همگام‌سازی انجام شد.'),'send_ok'=>array('success','محصولات انتخاب‌شده برای ارسال به پست‌یار سپرده شدند.'),'connect_error'=>array('error','اتصال انجام نشد.'),'save_error'=>array('error','ذخیره تنظیمات انجام نشد.'),'sync_error'=>array('error','همگام‌سازی انجام نشد.'),'send_error'=>array('error','ارسال محصولات انجام نشد.'));if(empty($map[$notice]))return;$i=$map[$notice];echo '<div class="notice notice-'.$i[0].'"><p>'.esc_html($i[1]).'</p></div>';}
}
