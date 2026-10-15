CREATE TABLE IF NOT EXISTS analytics_events (
    id CHAR(26) NOT NULL,
    user_id CHAR(26) NULL,
    event_type VARCHAR(64) NOT NULL,

    occurred_at DATETIME(3) NOT NULL,

    post_id CHAR(26) NULL,
    target_id CHAR(26) NULL,
    channel_id CHAR(26) NULL,
    campaign_id CHAR(26) NULL,
    link_id CHAR(26) NULL,

    platform VARCHAR(24) NULL,
    source VARCHAR(32) NULL,

    value BIGINT NOT NULL DEFAULT 1,
    metadata_json LONGTEXT NULL,

    dedupe_key VARCHAR(191) NULL,

    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_analytics_user_time (user_id, occurred_at),
    KEY idx_analytics_event_time (event_type, occurred_at),
    KEY idx_analytics_post_time (post_id, occurred_at),
    KEY idx_analytics_target_time (target_id, occurred_at),
    KEY idx_analytics_channel_time (channel_id, occurred_at),
    KEY idx_analytics_campaign_time (campaign_id, occurred_at),
    KEY idx_analytics_link_time (link_id, occurred_at),
    KEY idx_analytics_platform_time (platform, occurred_at),
    KEY idx_analytics_dedupe (dedupe_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_links (
    id CHAR(26) NOT NULL,
    user_id CHAR(26) NOT NULL,

    post_id CHAR(26) NULL,
    target_id CHAR(26) NULL,
    channel_id CHAR(26) NULL,
    campaign_id CHAR(26) NULL,

    token VARCHAR(96) NOT NULL,
    destination_url TEXT NOT NULL,

    click_count BIGINT NOT NULL DEFAULT 0,
    last_clicked_at DATETIME(3) NULL,

    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),
    UNIQUE KEY uq_analytics_links_token (token),

    KEY idx_analytics_links_user (user_id),
    KEY idx_analytics_links_post (post_id),
    KEY idx_analytics_links_target (target_id),
    KEY idx_analytics_links_channel (channel_id),
    KEY idx_analytics_links_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_link_clicks (
    id CHAR(26) NOT NULL,
    link_id CHAR(26) NOT NULL,

    clicked_at DATETIME(3) NOT NULL,

    platform VARCHAR(24) NULL,
    source VARCHAR(32) NULL,

    referrer VARCHAR(1024) NULL,
    user_agent VARCHAR(1024) NULL,
    ip_hash CHAR(64) NULL,

    metadata_json LONGTEXT NULL,

    PRIMARY KEY (id),

    KEY idx_link_clicks_link_time (link_id, clicked_at),
    KEY idx_link_clicks_platform_time (platform, clicked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
