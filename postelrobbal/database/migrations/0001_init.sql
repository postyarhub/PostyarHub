-- ============================================================================
-- Postyar initial schema (MySQL 8 / MariaDB 10.6+)
-- Migration 0001 — canonical, deterministic, idempotent-unsafe by design
-- (applied exactly once; deployment only applies existing migrations)
-- ============================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE users (
  id              CHAR(26)     NOT NULL,
  first_name      VARCHAR(80)  NOT NULL,
  last_name       VARCHAR(80)  NOT NULL,
  mobile          VARCHAR(20)  NOT NULL,
  email           VARCHAR(190) NOT NULL,
  business_name   VARCHAR(160) NOT NULL,
  business_type   VARCHAR(80)  NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  referral_code   CHAR(12)     NULL,
  role            ENUM('SUPER_ADMIN','SUPPORT','USER') NOT NULL DEFAULT 'USER',
  status          ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  timezone        VARCHAR(64)  NOT NULL DEFAULT 'Asia/Tehran',
  last_login_at   DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_mobile (mobile),
  UNIQUE KEY uq_users_referral_code (referral_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id            CHAR(26)    NOT NULL,
  user_id       CHAR(26)    NOT NULL,
  token_hash    CHAR(64)    NOT NULL,
  csrf_secret   CHAR(64)    NOT NULL,
  user_agent    VARCHAR(255) NULL,
  ip            VARCHAR(64)  NULL,
  expires_at    DATETIME    NOT NULL,
  revoked_at    DATETIME    NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_reset_tokens (
  id           CHAR(26) NOT NULL,
  user_id      CHAR(26) NOT NULL,
  token_hash   CHAR(64) NOT NULL,
  expires_at   DATETIME NOT NULL,
  used_at      DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prt_token (token_hash),
  KEY idx_prt_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE plans (
  id            CHAR(26)     NOT NULL,
  code          VARCHAR(40)  NOT NULL,
  name_fa       VARCHAR(80)  NOT NULL,
  price_rial    BIGINT       NOT NULL DEFAULT 0,
  period_days   INT          NOT NULL DEFAULT 30,
  limits_json   JSON         NOT NULL,
  features_json JSON         NOT NULL,
  sort_order    INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscriptions (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  plan_id       CHAR(26) NOT NULL,
  state         ENUM('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  started_at    DATETIME NOT NULL,
  expires_at    DATETIME NOT NULL,
  cancelled_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subs_tenant_state (tenant_id, state),
  KEY idx_subs_expiry (state, expires_at),
  CONSTRAINT fk_subs_tenant FOREIGN KEY (tenant_id) REFERENCES users (id),
  CONSTRAINT fk_subs_plan FOREIGN KEY (plan_id) REFERENCES plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_registry (
  platform      ENUM('telegram','bale','rubika') NOT NULL,
  channel_ref   VARCHAR(190) NOT NULL,
  tenant_id     CHAR(26)     NULL,
  claimed_at    DATETIME     NULL,
  released_at   DATETIME     NULL,
  PRIMARY KEY (platform, channel_ref),
  KEY idx_registry_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channels (
  id              CHAR(26) NOT NULL,
  tenant_id       CHAR(26) NOT NULL,
  platform        ENUM('telegram','bale','rubika') NOT NULL,
  channel_ref     VARCHAR(190) NOT NULL,
  title           VARCHAR(190) NOT NULL,
  type            VARCHAR(40)  NOT NULL DEFAULT 'channel',
  mode            ENUM('bot_admin','bot_post') NOT NULL DEFAULT 'bot_post',
  bot_id          CHAR(26)     NULL,
  status          ENUM('PENDING_VERIFY','ACTIVE','DISABLED','ERROR') NOT NULL DEFAULT 'PENDING_VERIFY',
  health_json     JSON         NULL,
  last_verified_at DATETIME    NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channels_tenant_ref (tenant_id, platform, channel_ref),
  KEY idx_channels_tenant (tenant_id),
  CONSTRAINT fk_channels_tenant FOREIGN KEY (tenant_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bots (
  id              CHAR(26) NOT NULL,
  tenant_id       CHAR(26) NOT NULL,
  platform        ENUM('telegram','bale','rubika') NOT NULL,
  token_encrypted TEXT     NOT NULL,
  token_masked    VARCHAR(64) NOT NULL,
  username        VARCHAR(190) NULL,
  title           VARCHAR(190) NOT NULL,
  status          ENUM('PENDING_VERIFY','ACTIVE','DISABLED','ERROR') NOT NULL DEFAULT 'PENDING_VERIFY',
  mode            ENUM('WEBHOOK','POLLING') NOT NULL DEFAULT 'POLLING',
  webhook_secret  CHAR(64)  NULL,
  webhook_url     VARCHAR(255) NULL,
  webhook_registered_at DATETIME NULL,
  health_json     JSON      NULL,
  ai_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  ai_system_prompt TEXT     NULL,
  last_event_at   DATETIME  NULL,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bots_tenant (tenant_id),
  CONSTRAINT fk_bots_tenant FOREIGN KEY (tenant_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bot_users (
  id               CHAR(26) NOT NULL,
  bot_id           CHAR(26) NOT NULL,
  platform_user_id VARCHAR(190) NOT NULL,
  username         VARCHAR(190) NULL,
  display_name     VARCHAR(190) NULL,
  first_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  state_json       JSON     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_users (bot_id, platform_user_id),
  KEY idx_bot_users_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bot_commands (
  id          CHAR(26) NOT NULL,
  bot_id      CHAR(26) NOT NULL,
  tenant_id   CHAR(26) NOT NULL,
  command     VARCHAR(64) NOT NULL,
  description_fa VARCHAR(190) NOT NULL DEFAULT '',
  response_kind ENUM('TEXT','BUTTONS','AI','WORKFLOW') NOT NULL DEFAULT 'TEXT',
  response_payload JSON NULL,
  is_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_commands (bot_id, command)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bot_keywords (
  id          CHAR(26) NOT NULL,
  bot_id      CHAR(26) NOT NULL,
  tenant_id   CHAR(26) NOT NULL,
  keyword     VARCHAR(190) NOT NULL,
  match_kind  ENUM('EXACT','CONTAINS') NOT NULL DEFAULT 'CONTAINS',
  response_kind ENUM('TEXT','BUTTONS','AI','WORKFLOW') NOT NULL DEFAULT 'TEXT',
  response_payload JSON NULL,
  is_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bot_keywords_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workflows (
  id          CHAR(26) NOT NULL,
  tenant_id   CHAR(26) NOT NULL,
  bot_id      CHAR(26) NOT NULL,
  name_fa     VARCHAR(190) NOT NULL,
  definition_json JSON NOT NULL,
  is_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  run_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workflows_tenant (tenant_id),
  KEY idx_workflows_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workflow_runs (
  id            CHAR(26) NOT NULL,
  workflow_id   CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  trigger_kind  VARCHAR(40) NOT NULL,
  trigger_ref   VARCHAR(190) NULL,
  status        ENUM('RUNNING','COMPLETED','FAILED','TIMEOUT','ABORTED') NOT NULL DEFAULT 'RUNNING',
  steps_executed INT NOT NULL DEFAULT 0,
  log_json      JSON NULL,
  error_code    VARCHAR(80) NULL,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_wfruns_workflow (workflow_id, started_at),
  KEY idx_wfruns_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bot_events (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  bot_id        CHAR(26) NOT NULL,
  platform      ENUM('telegram','bale','rubika') NOT NULL,
  external_id   VARCHAR(190) NULL,
  dedup_hash    CHAR(64) NOT NULL,
  kind          VARCHAR(40) NOT NULL,
  chat_ref      VARCHAR(190) NULL,
  sender_ref    VARCHAR(190) NULL,
  payload_json  JSON NOT NULL,
  state         ENUM('PENDING','PROCESSED','FAILED') NOT NULL DEFAULT 'PENDING',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_events_dedup (bot_id, dedup_hash),
  KEY idx_bot_events_tenant_state (tenant_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  mime          VARCHAR(120) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  width         INT NULL,
  height        INT NULL,
  checksum      CHAR(64) NOT NULL,
  storage_path  VARCHAR(255) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  title         VARCHAR(190) NULL,
  body          TEXT NOT NULL,
  parse_mode    ENUM('NONE','HTML','MARKDOWN') NOT NULL DEFAULT 'NONE',
  media_id      CHAR(26) NULL,
  buttons_json  JSON NULL,
  source        ENUM('MANUAL','GOLD','WORDPRESS','WORKFLOW') NOT NULL DEFAULT 'MANUAL',
  state         ENUM('DRAFT','SCHEDULED','QUEUED','PUBLISHING','PUBLISHED','PARTIAL','FAILED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  scheduled_at  DATETIME NULL,
  published_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_posts_tenant_state (tenant_id, state),
  KEY idx_posts_schedule (state, scheduled_at),
  CONSTRAINT fk_posts_media FOREIGN KEY (media_id) REFERENCES media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_targets (
  id            CHAR(26) NOT NULL,
  post_id       CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  channel_id    CHAR(26) NOT NULL,
  state         ENUM('PENDING','PROCESSING','SENT','RETRYING','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  attempts      INT NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  provider_message_id VARCHAR(190) NULL,
  error_code    VARCHAR(80) NULL,
  error_message VARCHAR(255) NULL,
  sent_at       DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_targets (post_id, channel_id),
  KEY idx_pt_tenant_state (tenant_id, state),
  KEY idx_pt_retry (state, next_retry_at),
  CONSTRAINT fk_pt_post FOREIGN KEY (post_id) REFERENCES posts (id),
  CONSTRAINT fk_pt_channel FOREIGN KEY (channel_id) REFERENCES channels (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox_events (
  id             CHAR(26) NOT NULL,
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id   CHAR(26) NOT NULL,
  event_type     VARCHAR(80) NOT NULL,
  payload_json   JSON NOT NULL,
  state          ENUM('PENDING','DISPATCHED','FAILED') NOT NULL DEFAULT 'PENDING',
  attempts       INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_outbox_pending (state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE idempotency_keys (
  scope        VARCHAR(80) NOT NULL,
  idem_key     VARCHAR(190) NOT NULL,
  tenant_id    CHAR(26) NULL,
  state        ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL DEFAULT 'IN_PROGRESS',
  result_json  JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  PRIMARY KEY (scope, idem_key),
  KEY idx_idem_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_jobs (
  id           CHAR(26) NOT NULL,
  tenant_id    CHAR(26) NOT NULL,
  purpose      ENUM('CAPTION','AUTO_REPLY','CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  provider     VARCHAR(40) NOT NULL,
  model        VARCHAR(80) NULL,
  input_text   TEXT NOT NULL,
  output_text  TEXT NULL,
  status       ENUM('QUEUED','RUNNING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
  prompt_tokens INT NULL,
  completion_tokens INT NULL,
  error_code   VARCHAR(80) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_ai_tenant (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_usage_monthly (
  tenant_id    CHAR(26) NOT NULL,
  period_ym    CHAR(7)  NOT NULL,
  request_count INT UNSIGNED NOT NULL DEFAULT 0,
  token_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, period_ym)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wordpress_sites (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  site_url      VARCHAR(255) NOT NULL,
  site_key      CHAR(32) NOT NULL,
  secret_hash   CHAR(64) NOT NULL,
  status        ENUM('PENDING','ACTIVE','DISABLED','ERROR') NOT NULL DEFAULT 'PENDING',
  auto_publish  TINYINT(1) NOT NULL DEFAULT 1,
  category_map_json JSON NULL,
  last_sync_at  DATETIME NULL,
  last_error    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wp_key (site_key),
  UNIQUE KEY uq_wp_tenant_url (tenant_id, site_url),
  CONSTRAINT fk_wp_tenant FOREIGN KEY (tenant_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wordpress_products (
  id            CHAR(26) NOT NULL,
  site_id       CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  wc_product_id BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(255) NOT NULL,
  price_rial    BIGINT NULL,
  permalink     VARCHAR(255) NULL,
  image_url     VARCHAR(512) NULL,
  content_hash  CHAR(64) NULL,
  last_synced_at DATETIME NULL,
  last_published_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wpprod (site_id, wc_product_id),
  KEY idx_wpprod_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE gold_configs (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  source_url    VARCHAR(512) NOT NULL,
  template_text TEXT NOT NULL,
  channel_ids   JSON NOT NULL,
  frequency_minutes INT NOT NULL DEFAULT 60,
  timezone      VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
  change_only   TINYINT(1) NOT NULL DEFAULT 1,
  is_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  last_snapshot_json JSON NULL,
  last_run_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gold_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE gold_snapshots (
  id            CHAR(26) NOT NULL,
  config_id     CHAR(26) NOT NULL,
  prices_json   JSON NOT NULL,
  content_hash  CHAR(64) NOT NULL,
  captured_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_gold_snap (config_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  purpose       ENUM('SUBSCRIPTION','WALLET_TOPUP') NOT NULL DEFAULT 'SUBSCRIPTION',
  plan_id       CHAR(26) NULL,
  months        INT NOT NULL DEFAULT 1,
  amount_rial   BIGINT NOT NULL,
  gateway       VARCHAR(40) NOT NULL,
  gateway_ref   VARCHAR(190) NULL,
  authority     VARCHAR(190) NULL,
  state         ENUM('CREATED','REDIRECTED','VERIFIED','FAILED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'CREATED',
  verified_at   DATETIME NULL,
  meta_json     JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_authority (gateway, authority),
  KEY idx_payments_tenant (tenant_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallet_accounts (
  tenant_id     CHAR(26) NOT NULL,
  balance_rial  BIGINT NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallet_ledger (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  entry_kind    ENUM('CREDIT','DEBIT','REFUND','BONUS','PAYMENT','ADJUSTMENT') NOT NULL,
  amount_rial   BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  ref_type      VARCHAR(60) NULL,
  ref_id        CHAR(26) NULL,
  memo_fa       VARCHAR(255) NOT NULL DEFAULT '',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_tenant (tenant_id, created_at),
  UNIQUE KEY uq_ledger_ref (ref_type, ref_id, entry_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE point_ledger (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  entry_kind    ENUM('EARN','SPEND','ADJUSTMENT') NOT NULL,
  amount        INT NOT NULL,
  balance_after INT NOT NULL,
  ref_type      VARCHAR(60) NULL,
  ref_id        CHAR(26) NULL,
  memo_fa       VARCHAR(255) NOT NULL DEFAULT '',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_point_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE referrals (
  id                 CHAR(26) NOT NULL,
  referrer_tenant_id CHAR(26) NOT NULL,
  referred_tenant_id CHAR(26) NOT NULL,
  referral_code      VARCHAR(32) NOT NULL,
  state              ENUM('REGISTERED','REWARDED','FAILED') NOT NULL DEFAULT 'REGISTERED',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referrals_referred (referred_tenant_id),
  KEY idx_referrals_referrer (referrer_tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE referral_rewards (
  id           CHAR(26) NOT NULL,
  referral_id  CHAR(26) NOT NULL,
  reward_kind  ENUM('REGISTER','FIRST_PURCHASE') NOT NULL,
  amount       INT NOT NULL,
  ledger_ref   CHAR(26) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referral_rewards (referral_id, reward_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          CHAR(26) NOT NULL,
  tenant_id   CHAR(26) NOT NULL,
  kind        VARCHAR(80) NOT NULL,
  title_fa    VARCHAR(190) NOT NULL,
  body_fa     TEXT NOT NULL,
  read_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_outbound (
  id            CHAR(26) NOT NULL,
  kind          VARCHAR(80) NOT NULL,
  subject_id    CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  destination   ENUM('INAPP','TELEGRAM','BALE','RUBIKA','EMAIL','SMS') NOT NULL,
  state         ENUM('PENDING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  attempts      INT NOT NULL DEFAULT 0,
  last_error    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notif_outbound (kind, subject_id, destination),
  KEY idx_notif_out_state (state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE events (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NULL,
  name          VARCHAR(80) NOT NULL,
  subject_type  VARCHAR(60) NULL,
  subject_id    CHAR(26) NULL,
  props_json    JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_tenant_time (tenant_id, created_at),
  KEY idx_events_name (name, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE event_daily (
  tenant_id    CHAR(26) NOT NULL,
  day          DATE NOT NULL,
  event_name   VARCHAR(80) NOT NULL,
  event_count  INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, event_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media_access_tokens (
  id          CHAR(26) NOT NULL,
  media_id    CHAR(26) NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mat_token (token_hash),
  KEY idx_mat_media (media_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id            CHAR(26) NOT NULL,
  actor_id      CHAR(26) NULL,
  actor_role    VARCHAR(40) NULL,
  action        VARCHAR(80) NOT NULL,
  subject_type  VARCHAR(60) NULL,
  subject_id    CHAR(26) NULL,
  ip            VARCHAR(64) NULL,
  meta_json     JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tickets (
  id           CHAR(26) NOT NULL,
  tenant_id    CHAR(26) NOT NULL,
  subject      VARCHAR(190) NOT NULL,
  category     VARCHAR(80) NOT NULL DEFAULT 'GENERAL',
  state        ENUM('OPEN','ANSWERED','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tickets_tenant (tenant_id, state),
  CONSTRAINT fk_tickets_tenant FOREIGN KEY (tenant_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_messages (
  id           CHAR(26) NOT NULL,
  ticket_id    CHAR(26) NOT NULL,
  author_id    CHAR(26) NULL,
  author_role  ENUM('USER','SUPPORT','SUPER_ADMIN','SYSTEM') NOT NULL DEFAULT 'USER',
  body         TEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tmsg_ticket (ticket_id, created_at),
  CONSTRAINT fk_tmsg_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  setting_key  VARCHAR(80) NOT NULL,
  value_json   JSON NOT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE link_clicks (
  id            CHAR(26) NOT NULL,
  tenant_id     CHAR(26) NOT NULL,
  post_target_id CHAR(26) NULL,
  link_key      VARCHAR(80) NOT NULL,
  visitor_hash  CHAR(64) NOT NULL,
  referer       VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clicks_tenant (tenant_id, created_at),
  KEY idx_clicks_target (post_target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
