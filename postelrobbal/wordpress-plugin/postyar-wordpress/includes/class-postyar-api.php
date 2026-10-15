<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Postyar_WP_API {
    const BASE_URL = 'https://postyarhub.ir/api/v1';
    const API_OPTION = 'postyar_wp_api_base_url';

    public static function configured() {
        return (bool) get_option( 'postyar_wp_site_key', '' ) && (bool) get_option( 'postyar_wp_secret', '' );
    }

    public static function base_url() {
        $configured = trim( (string) get_option( self::API_OPTION, '' ) );
        $base = $configured !== '' ? $configured : self::BASE_URL;
        return apply_filters( 'postyar_wp_api_base_url', $base );
    }

    public static function request( $method, $path, $body = null ) {
        $site_key = (string) get_option( 'postyar_wp_site_key', '' );
        $secret = (string) get_option( 'postyar_wp_secret', '' );
        if ( ! $site_key || ! $secret ) return new WP_Error( 'not_connected', 'اتصال پست‌یار هنوز انجام نشده است.' );

        $args = array(
            'method' => strtoupper( $method ),
            'timeout' => 20,
            'redirection' => 3,
            'headers' => array(
                'Accept' => 'application/json',
                'Content-Type' => 'application/json; charset=utf-8',
                'X-Postyar-Site-Key' => $site_key,
                'X-Postyar-Secret' => $secret,
                'User-Agent' => 'Postyar-WordPress/' . POSTYAR_WP_VERSION,
            ),
        );
        if ( null !== $body ) $args['body'] = wp_json_encode( $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        $url = trailingslashit( self::base_url() ) . ltrim( $path, '/' );
        $response = wp_remote_request( $url, $args );
        if ( is_wp_error( $response ) ) return $response;

        $status = (int) wp_remote_retrieve_response_code( $response );
        $json = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( $status < 200 || $status >= 300 ) {
            $message = is_array( $json ) && ! empty( $json['error']['message'] ) ? $json['error']['message'] : 'ارتباط با پست‌یار ناموفق بود.';
            return new WP_Error( 'http_' . $status, $message, array( 'status' => $status ) );
        }
        if ( ! is_array( $json ) ) return new WP_Error( 'invalid_response', 'پاسخ نامعتبر از پست‌یار دریافت شد.' );
        return isset( $json['data'] ) && is_array( $json['data'] ) ? $json['data'] : $json;
    }

    public static function parse_connection_code( $code ) {
        $code = trim( preg_replace( '/\s+/', '', (string) $code ) );
        if ( ! $code ) return false;
        $normalized = strtr( $code, '-_', '+/' );
        $padding = strlen( $normalized ) % 4;
        if ( $padding ) $normalized .= str_repeat( '=', 4 - $padding );
        $decoded = base64_decode( $normalized, true );
        if ( false !== $decoded ) {
            $json = json_decode( $decoded, true );
            if ( is_array( $json ) && isset( $json['site'], $json['secret'] )
                && preg_match( '/^[0-9a-f]{32}$/i', (string) $json['site'] )
                && preg_match( '/^[0-9a-f]{32}$/i', (string) $json['secret'] )
            ) {
                $api = isset( $json['api'] ) ? esc_url_raw( (string) $json['api'] ) : '';
                if ( $api && preg_match( '#^https?://#i', $api ) ) {
                    return array( 'site_key' => $json['site'], 'secret' => $json['secret'], 'api_base_url' => rtrim( $api, '/' ) );
                }
            }
            if ( strpos( $decoded, ':' ) !== false ) {
                $parts = explode( ':', $decoded, 2 );
                if ( preg_match( '/^[0-9a-f]{32}$/i', $parts[0] ?? '' ) && preg_match( '/^[0-9a-f]{32}$/i', $parts[1] ?? '' ) ) {
                    return array( 'site_key' => $parts[0], 'secret' => $parts[1], 'api_base_url' => '' );
                }
            }
        }
        if ( preg_match( '/^([0-9a-f]{32})\.([0-9a-f]{32})$/i', $code, $m ) ) {
            return array( 'site_key' => $m[1], 'secret' => $m[2], 'api_base_url' => '' );
        }
        return false;
    }

    public static function connection_code( $site_key, $secret ) {
        return rtrim( strtr( base64_encode( $site_key . ':' . $secret ), '+/', '-_' ), '=' );
    }
}
