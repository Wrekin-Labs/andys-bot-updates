<?php
/**
 * Plugin Name: Wrekin WordPress Connector
 * Description: Secure connector for Wrekin Cloud WordPress inspection, diagnostics and approved maintenance actions.
 * Version: 0.1.0
 * Author: Wrekin Labs
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Wrekin_WordPress_Connector {
    const VERSION = '0.1.0';
    const OPTION_SECRET = 'wrekin_connector_secret';
    const REST_NS = 'wrekin/v1';
    const MAX_CLOCK_SKEW = 300;

    public static function init() {
        register_activation_hook(__FILE__, [__CLASS__, 'activate']);
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('admin_post_wrekin_regenerate_secret', [__CLASS__, 'regenerate_secret']);
    }

    public static function activate() {
        if (!get_option(self::OPTION_SECRET)) {
            update_option(self::OPTION_SECRET, wp_generate_password(64, false, false), false);
        }
    }

    public static function register_routes() {
        register_rest_route(self::REST_NS, '/status', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'status'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/plugins', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'plugins'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/themes', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'themes'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/cron', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'cron_status'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/forms', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'forms_status'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/cache/purge', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'cache_purge'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/plugin/update-plan', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'plugin_update_plan'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/plugin/update', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'plugin_update'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/theme/update-plan', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'theme_update_plan'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
        register_rest_route(self::REST_NS, '/theme/update', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'theme_update'],
            'permission_callback' => [__CLASS__, 'authorize'],
        ]);
    }

    public static function authorize(WP_REST_Request $request) {
        $secret = get_option(self::OPTION_SECRET);
        if (!$secret || !is_string($secret)) {
            return new WP_Error('wrekin_not_configured', 'Connector secret is not configured.', ['status' => 503]);
        }

        $timestamp = $request->get_header('x-wrekin-timestamp');
        $signature = $request->get_header('x-wrekin-signature');
        if (!$timestamp || !$signature || !ctype_digit((string)$timestamp)) {
            return new WP_Error('wrekin_unauthorized', 'Missing signature.', ['status' => 401]);
        }

        $ts = (int)$timestamp;
        if (abs(time() - $ts) > self::MAX_CLOCK_SKEW) {
            return new WP_Error('wrekin_stale_request', 'Request timestamp is outside the accepted window.', ['status' => 401]);
        }

        $method = strtoupper($request->get_method());
        $route = $request->get_route();
        $body = (string)$request->get_body();
        $canonical = $timestamp . "\n" . $method . "\n" . $route . "\n" . hash('sha256', $body);
        $expected = hash_hmac('sha256', $canonical, $secret);

        if (!hash_equals($expected, strtolower(trim($signature)))) {
            return new WP_Error('wrekin_unauthorized', 'Invalid signature.', ['status' => 401]);
        }

        return true;
    }

    public static function status() {
        global $wp_version;
        return rest_ensure_response([
            'ok' => true,
            'connector_version' => self::VERSION,
            'wordpress_version' => $wp_version,
            'php_version' => PHP_VERSION,
            'site_url' => site_url(),
            'home_url' => home_url(),
            'multisite' => is_multisite(),
            'debug' => defined('WP_DEBUG') && WP_DEBUG,
        ]);
    }

    public static function plugins() {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        wp_update_plugins();
        $plugins = get_plugins();
        $updates = get_site_transient('update_plugins');
        $active = (array)get_option('active_plugins', []);
        $out = [];

        foreach ($plugins as $file => $data) {
            $update = isset($updates->response[$file]) ? $updates->response[$file] : null;
            $out[] = [
                'file' => $file,
                'name' => isset($data['Name']) ? $data['Name'] : $file,
                'version' => isset($data['Version']) ? $data['Version'] : '',
                'active' => in_array($file, $active, true),
                'update_available' => (bool)$update,
                'update_version' => $update && isset($update->new_version) ? $update->new_version : null,
                'package_available' => $update && !empty($update->package),
            ];
        }
        return rest_ensure_response(['plugins' => $out]);
    }

    public static function themes() {
        wp_update_themes();
        $updates = get_site_transient('update_themes');
        $active = get_stylesheet();
        $out = [];

        foreach (wp_get_themes() as $slug => $theme) {
            $update = isset($updates->response[$slug]) ? $updates->response[$slug] : null;
            $out[] = [
                'slug' => $slug,
                'name' => $theme->get('Name'),
                'version' => $theme->get('Version'),
                'active' => $slug === $active,
                'update_available' => (bool)$update,
                'update_version' => $update && isset($update['new_version']) ? $update['new_version'] : null,
                'package_available' => $update && !empty($update['package']),
            ];
        }
        return rest_ensure_response(['themes' => $out]);
    }

    public static function cron_status() {
        $crons = _get_cron_array();
        $next = [];
        if (is_array($crons)) {
            $timestamps = array_keys($crons);
            sort($timestamps, SORT_NUMERIC);
            foreach (array_slice($timestamps, 0, 20) as $ts) {
                foreach ($crons[$ts] as $hook => $events) {
                    $next[] = ['timestamp' => (int)$ts, 'hook' => $hook, 'count' => count($events)];
                }
            }
        }
        return rest_ensure_response([
            'disabled' => defined('DISABLE_WP_CRON') && DISABLE_WP_CRON,
            'next_events' => $next,
        ]);
    }

    public static function forms_status() {
        $result = [
            'contact_form_7' => [
                'active' => defined('WPCF7_VERSION'),
                'version' => defined('WPCF7_VERSION') ? WPCF7_VERSION : null,
                'forms' => 0,
            ],
            'wp_mail_smtp' => [
                'active' => defined('WPMS_PLUGIN_VER') || defined('WP_MAIL_SMTP_VERSION'),
            ],
        ];
        if (post_type_exists('wpcf7_contact_form')) {
            $counts = wp_count_posts('wpcf7_contact_form');
            $result['contact_form_7']['forms'] = isset($counts->publish) ? (int)$counts->publish : 0;
        }
        return rest_ensure_response($result);
    }

    public static function cache_purge(WP_REST_Request $request) {
        $params = self::json_params($request);
        if (empty($params['approved'])) {
            return new WP_Error('wrekin_approval_required', 'Explicit approval is required.', ['status' => 409]);
        }
        $ok = wp_cache_flush();
        if (function_exists('rocket_clean_domain')) {
            rocket_clean_domain();
        }
        do_action('wrekin_connector_cache_purged');
        return rest_ensure_response(['ok' => (bool)$ok, 'action' => 'cache_purge']);
    }

    public static function plugin_update_plan(WP_REST_Request $request) {
        $params = self::json_params($request);
        $file = isset($params['file']) ? sanitize_text_field($params['file']) : '';
        if (!$file) {
            return new WP_Error('wrekin_invalid_plugin', 'Plugin file is required.', ['status' => 400]);
        }
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        wp_update_plugins();
        $plugins = get_plugins();
        if (!isset($plugins[$file])) {
            return new WP_Error('wrekin_plugin_missing', 'Plugin is not installed.', ['status' => 404]);
        }
        $updates = get_site_transient('update_plugins');
        $update = isset($updates->response[$file]) ? $updates->response[$file] : null;
        return rest_ensure_response([
            'file' => $file,
            'name' => $plugins[$file]['Name'],
            'from_version' => $plugins[$file]['Version'],
            'to_version' => $update && isset($update->new_version) ? $update->new_version : null,
            'update_available' => (bool)$update,
            'package_available' => $update && !empty($update->package),
            'requires_approval' => true,
        ]);
    }

    public static function plugin_update(WP_REST_Request $request) {
        $params = self::json_params($request);
        if (empty($params['approved'])) {
            return new WP_Error('wrekin_approval_required', 'Explicit approval is required.', ['status' => 409]);
        }
        $file = isset($params['file']) ? sanitize_text_field($params['file']) : '';
        $plan_response = self::plugin_update_plan($request);
        if (is_wp_error($plan_response)) return $plan_response;
        $plan = $plan_response->get_data();
        if (empty($plan['update_available'])) {
            return rest_ensure_response(['ok' => true, 'changed' => false, 'plan' => $plan]);
        }
        if (empty($plan['package_available'])) {
            return new WP_Error('wrekin_license_or_package_required', 'No update package is available; licence or vendor access may be required.', ['status' => 409]);
        }

        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Plugin_Upgrader($skin);
        $result = $upgrader->upgrade($file);
        if (is_wp_error($result)) return $result;
        if ($result === false) {
            return new WP_Error('wrekin_update_failed', 'Plugin update failed.', ['status' => 500]);
        }

        wp_clean_plugins_cache(true);
        $plugins = get_plugins();
        $after = isset($plugins[$file]['Version']) ? $plugins[$file]['Version'] : null;
        return rest_ensure_response([
            'ok' => $after === $plan['to_version'],
            'changed' => true,
            'from_version' => $plan['from_version'],
            'expected_version' => $plan['to_version'],
            'actual_version' => $after,
        ]);
    }

    public static function theme_update_plan(WP_REST_Request $request) {
        $params = self::json_params($request);
        $slug = isset($params['slug']) ? sanitize_key($params['slug']) : '';
        $themes = wp_get_themes();
        if (!$slug || !isset($themes[$slug])) {
            return new WP_Error('wrekin_theme_missing', 'Theme is not installed.', ['status' => 404]);
        }
        wp_update_themes();
        $updates = get_site_transient('update_themes');
        $update = isset($updates->response[$slug]) ? $updates->response[$slug] : null;
        return rest_ensure_response([
            'slug' => $slug,
            'name' => $themes[$slug]->get('Name'),
            'from_version' => $themes[$slug]->get('Version'),
            'to_version' => $update && isset($update['new_version']) ? $update['new_version'] : null,
            'update_available' => (bool)$update,
            'package_available' => $update && !empty($update['package']),
            'requires_approval' => true,
        ]);
    }

    public static function theme_update(WP_REST_Request $request) {
        $params = self::json_params($request);
        if (empty($params['approved'])) {
            return new WP_Error('wrekin_approval_required', 'Explicit approval is required.', ['status' => 409]);
        }
        $plan_response = self::theme_update_plan($request);
        if (is_wp_error($plan_response)) return $plan_response;
        $plan = $plan_response->get_data();
        if (empty($plan['update_available'])) {
            return rest_ensure_response(['ok' => true, 'changed' => false, 'plan' => $plan]);
        }
        if (empty($plan['package_available'])) {
            return new WP_Error('wrekin_license_or_package_required', 'No update package is available; licence or vendor access may be required.', ['status' => 409]);
        }

        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Theme_Upgrader($skin);
        $result = $upgrader->upgrade($plan['slug']);
        if (is_wp_error($result)) return $result;
        if ($result === false) {
            return new WP_Error('wrekin_update_failed', 'Theme update failed.', ['status' => 500]);
        }

        wp_clean_themes_cache(true);
        $themes = wp_get_themes();
        $after = isset($themes[$plan['slug']]) ? $themes[$plan['slug']]->get('Version') : null;
        return rest_ensure_response([
            'ok' => $after === $plan['to_version'],
            'changed' => true,
            'from_version' => $plan['from_version'],
            'expected_version' => $plan['to_version'],
            'actual_version' => $after,
        ]);
    }

    private static function json_params(WP_REST_Request $request) {
        $params = $request->get_json_params();
        return is_array($params) ? $params : [];
    }

    public static function admin_menu() {
        add_options_page(
            'Wrekin Connector',
            'Wrekin Connector',
            'manage_options',
            'wrekin-connector',
            [__CLASS__, 'admin_page']
        );
    }

    public static function admin_page() {
        if (!current_user_can('manage_options')) return;
        $secret = get_option(self::OPTION_SECRET);
        ?>
        <div class="wrap">
            <h1>Wrekin WordPress Connector</h1>
            <p>Use this token only when connecting this site to Wrekin Cloud. Treat it like a password.</p>
            <table class="form-table">
                <tr>
                    <th scope="row">Connector status</th>
                    <td><strong><?php echo $secret ? 'Ready' : 'Not configured'; ?></strong></td>
                </tr>
                <tr>
                    <th scope="row">Connector token</th>
                    <td><input type="password" readonly style="width:520px;max-width:100%" value="<?php echo esc_attr($secret); ?>" onclick="this.type='text';this.select();" /></td>
                </tr>
                <tr>
                    <th scope="row">Endpoint</th>
                    <td><code><?php echo esc_html(rest_url(self::REST_NS)); ?></code></td>
                </tr>
            </table>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="wrekin_regenerate_secret" />
                <?php wp_nonce_field('wrekin_regenerate_secret'); ?>
                <?php submit_button('Regenerate connector token', 'secondary'); ?>
            </form>
        </div>
        <?php
    }

    public static function regenerate_secret() {
        if (!current_user_can('manage_options')) wp_die('Forbidden');
        check_admin_referer('wrekin_regenerate_secret');
        update_option(self::OPTION_SECRET, wp_generate_password(64, false, false), false);
        wp_safe_redirect(admin_url('options-general.php?page=wrekin-connector&regenerated=1'));
        exit;
    }
}

Wrekin_WordPress_Connector::init();
