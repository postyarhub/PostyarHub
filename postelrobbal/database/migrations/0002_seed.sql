-- Migration 0002 — seed default plans + system settings
SET NAMES utf8mb4;

INSERT INTO plans (id, code, name_fa, price_rial, period_days, limits_json, features_json, sort_order) VALUES
('01HPLAN0000000000000FREE0', 'free',       'رایگان',   0,                30, '{"max_channels":2,"max_posts":10,"max_bots":0,"max_schedules":3,"ai_monthly":0,"storage_mb":50}', '{"gold_ticker":false,"auto_responder":false,"woocommerce":false,"api_access":false}', 1),
('01HPLAN000000000000BASE00', 'basic',      'پایه',     9900000,          30, '{"max_channels":5,"max_posts":150,"max_bots":1,"max_schedules":50,"ai_monthly":50,"storage_mb":500}', '{"gold_ticker":true,"auto_responder":true,"woocommerce":false,"api_access":false}', 2),
('01HPLAN000000000000PROFES0', 'professional','حرفه‌ای',  24900000,         30, '{"max_channels":15,"max_posts":600,"max_bots":5,"max_schedules":300,"ai_monthly":300,"storage_mb":2048}', '{"gold_ticker":true,"auto_responder":true,"woocommerce":true,"api_access":true}', 3),
('01HPLAN000000000000BUSINES', 'business',   'تجاری',    59900000,         30, '{"max_channels":40,"max_posts":2000,"max_bots":15,"max_schedules":1000,"ai_monthly":1000,"storage_mb":8192}', '{"gold_ticker":true,"auto_responder":true,"woocommerce":true,"api_access":true}', 4),
('01HPLAN000000000000ENTERPR', 'enterprise', 'سازمانی',  0,                30, '{"max_channels":100,"max_posts":0,"max_bots":50,"max_schedules":0,"ai_monthly":5000,"storage_mb":20480}', '{"gold_ticker":true,"auto_responder":true,"woocommerce":true,"api_access":true}', 5)
ON DUPLICATE KEY UPDATE name_fa = VALUES(name_fa);

INSERT INTO system_settings (setting_key, value_json) VALUES
('referral', '{"register_reward_points":100,"first_purchase_percent":10,"monthly_cap_points":5000,"point_to_rial":10}'),
('gold', '{"default_source_url":"https://www.tgju.org/","frequency_minutes":60,"change_only":true}'),
('ai', '{"default_provider":"openai","timeout_seconds":60}'),
('sms', '{"provider":"smsir","per_phone_hourly_limit":3}'),
('booking', '{"expiry_warning_days":7}')
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);
