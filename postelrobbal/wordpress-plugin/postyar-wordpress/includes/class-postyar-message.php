<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Postyar_WP_Message {
    public static function product( $product, $event = 'new', $old_price = null ) {
        $style = get_option( 'postyar_wp_message_style', 'shop' );
        $title = self::clean( $product->get_name() );
        $price = $product->get_price();
        $lines = array();
        if ( 'sale' === $style && 'price' === $event ) $lines[] = '🔥 فروش ویژه';
        elseif ( 'minimal' === $style ) $lines[] = '🛍 ' . $title;
        elseif ( 'new' === $event ) $lines[] = '🛍 محصول جدید';
        elseif ( 'stock' === $event ) $lines[] = '✅ محصول دوباره موجود شد';
        elseif ( 'price' === $event ) $lines[] = '💰 تغییر قیمت';
        else $lines[] = '🛍 به‌روزرسانی محصول';
        $lines[] = '';
        $lines[] = $title;
        if ( 'price' === $event && null !== $old_price && '' !== $old_price && (string) $old_price !== (string) $price ) $lines[] = 'قیمت قبلی: ' . self::price( $old_price );
        if ( '' !== $price && null !== $price ) $lines[] = 'قیمت: ' . self::price( $price );
        if ( function_exists( 'wc_get_product' ) && $product->is_on_sale() && $product->get_regular_price() !== '' ) {
            $regular = (float) $product->get_regular_price();
            $current = (float) $price;
            if ( $regular > 0 && $current < $regular ) $lines[] = '🎁 تخفیف: ' . round( ( ( $regular - $current ) / $regular ) * 100 ) . '٪';
        }
        $lines[] = 'وضعیت: ' . self::stock_label( $product->get_stock_status() );
        if ( $product->get_sku() ) $lines[] = 'کد محصول: ' . self::clean( $product->get_sku() );
        $link = get_permalink( $product->get_id() );
        if ( $link ) { $lines[] = ''; $lines[] = '🔗 مشاهده محصول: ' . esc_url_raw( $link ); }
        return trim( implode( "\n", $lines ) );
    }

    public static function post( $post_id ) {
        $title = self::clean( get_the_title( $post_id ) );
        $content = get_post_field( 'post_content', $post_id );
        $content = self::clean( strip_shortcodes( $content ) );
        if ( '' === $content ) $content = self::clean( get_the_excerpt( $post_id ) );
        $lines = array( '📝 ' . $title );
        if ( '' !== $content ) $lines[] = ''; $lines[] = function_exists('mb_substr') ? mb_substr( $content, 0, 12000 ) : substr( $content, 0, 12000 );
        $link = get_permalink( $post_id );
        if ( $link ) $lines[] = "\n🔗 ادامه مطلب: " . esc_url_raw( $link );
        return trim( implode( "\n", $lines ) );
    }

    private static function price( $raw ) {
        return function_exists( 'wc_price' ) ? self::clean( wc_price( $raw ) ) : number_format_i18n( (float) $raw );
    }

    private static function stock_label( $status ) {
        $map = array( 'instock' => 'موجود', 'outofstock' => 'ناموجود', 'onbackorder' => 'پیش‌خرید' );
        return $map[ $status ] ?? (string) $status;
    }

    private static function clean( $value ) {
        return trim( html_entity_decode( wp_strip_all_tags( (string) $value ), ENT_QUOTES, 'UTF-8' ) );
    }
}
