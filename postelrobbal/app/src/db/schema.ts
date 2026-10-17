/**
 * Drizzle schema — canonical ORM representation of the current migration set.
 * MySQL/MariaDB, money = BIGINT Rial, ids = CHAR(26) ULID.
 */
import {
  bigint,
  char,
  date,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

const ts = () => datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = mysqlTable('users', {
  id: char('id', { length: 26 }).primaryKey(),
  firstName: varchar('first_name', { length: 80 }).notNull(),
  lastName: varchar('last_name', { length: 80 }).notNull(),
  mobile: varchar('mobile', { length: 20 }).notNull(),
  email: varchar('email', { length: 190 }).notNull(),
  businessName: varchar('business_name', { length: 160 }).notNull(),
  businessType: varchar('business_type', { length: 80 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  referralCode: char('referral_code', { length: 12 }),
  role: mysqlEnum('role', ['SUPER_ADMIN', 'SUPPORT', 'USER']).notNull().default('USER'),
  status: mysqlEnum('status', ['ACTIVE', 'SUSPENDED']).notNull().default('ACTIVE'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
  // Round 17 avatars: 'character' → avatar_value holds an AVATAR_CHARACTERS key
  // (frontend SVG); 'photo' → avatar_media_id → media row (512×512 WebP).
  avatarKind: mysqlEnum('avatar_kind', ['character', 'photo']).notNull().default('character'),
  avatarValue: varchar('avatar_value', { length: 32 }).notNull().default(''),
  avatarMediaId: char('avatar_media_id', { length: 26 }),
  lastLoginAt: datetime('last_login_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [unique('uq_users_email').on(t.email), unique('uq_users_mobile').on(t.mobile)]);

export const sessions = mysqlTable('sessions', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  csrfSecret: char('csrf_secret', { length: 64 }).notNull(),
  userAgent: varchar('user_agent', { length: 255 }),
  ip: varchar('ip', { length: 64 }),
  expiresAt: datetime('expires_at').notNull(),
  revokedAt: datetime('revoked_at'),
  createdAt: ts(),
}, (t) => [unique('uq_sessions_token').on(t.tokenHash), index('idx_sessions_user').on(t.userId)]);

export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  createdAt: ts(),
}, (t) => [unique('uq_prt_token').on(t.tokenHash)]);

export const plans = mysqlTable('plans', {
  id: char('id', { length: 26 }).primaryKey(),
  code: varchar('code', { length: 40 }).notNull(),
  nameFa: varchar('name_fa', { length: 80 }).notNull(),
  priceRial: bigint('price_rial', { mode: 'number' }).notNull().default(0),
  periodDays: int('period_days').notNull().default(30),
  limitsJson: json('limits_json').$type<PlanLimits>().notNull(),
  featuresJson: json('features_json').$type<PlanFeatures>().notNull(),
  // Round 19: discount model — { renewalDiscountPercent, durationDiscounts }.
  pricingJson: json('pricing_json').$type<PlanPricing>().notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: tinyint('is_active').notNull().default(1),
  createdAt: ts(),
}, (t) => [unique('uq_plans_code').on(t.code)]);

export interface PlanLimits {
  max_channels: number;
  max_posts: number;
  max_bots: number;
  max_schedules: number;
  ai_monthly: number;
  storage_mb: number;
}
export interface PlanFeatures {
  gold_ticker: boolean;
  auto_responder: boolean;
  woocommerce: boolean;
  // Optional for older plan rows; absence preserves the legacy WooCommerce fallback.
  wordpress_campaigns?: boolean;
  content_summarization?: boolean;
}

/**
 * Round 19 pricing model (migration 0005):
 *  - renewalDiscountPercent: تخفیف تمدید/ارتقا — applied when the buyer still
 *    holds an ACTIVE, unexpired subscription (early renewal or upgrade; free
 *    plan users qualify until their free period ends).
 *  - durationDiscounts: تخفیف مدت خرید — map of months → percent (3/6/12 or
 *    any other purchasable duration).
 * Both are 0-90 and combine additively at checkout (capped at 90).
 */
export interface PlanPricing {
  renewalDiscountPercent: number;
  durationDiscounts: Record<string, number>;
}

export const subscriptions = mysqlTable('subscriptions', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  planId: char('plan_id', { length: 26 }).notNull(),
  state: mysqlEnum('state', ['ACTIVE', 'EXPIRED', 'CANCELLED']).notNull().default('ACTIVE'),
  startedAt: datetime('started_at').notNull(),
  expiresAt: datetime('expires_at').notNull(),
  cancelledAt: datetime('cancelled_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_subs_tenant_state').on(t.tenantId, t.state),
  index('idx_subs_expiry').on(t.state, t.expiresAt),
]);

export const channelRegistry = mysqlTable('channel_registry', {
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  channelRef: varchar('channel_ref', { length: 190 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }),
  claimedAt: datetime('claimed_at'),
  releasedAt: datetime('released_at'),
}, (t) => [primaryKey({ columns: [t.platform, t.channelRef] })]);

export const channels = mysqlTable('channels', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  channelRef: varchar('channel_ref', { length: 190 }).notNull(),
  title: varchar('title', { length: 190 }).notNull(),
  type: varchar('type', { length: 40 }).notNull().default('channel'),
  mode: mysqlEnum('mode', ['bot_admin', 'bot_post']).notNull().default('bot_post'),
  botId: char('bot_id', { length: 26 }),
  status: mysqlEnum('status', ['PENDING_VERIFY', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING_VERIFY'),
  healthJson: json('health_json').$type<Record<string, unknown>>(),
  lastVerifiedAt: datetime('last_verified_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_channels_tenant_ref').on(t.tenantId, t.platform, t.channelRef),
  index('idx_channels_tenant').on(t.tenantId),
]);

export const bots = mysqlTable('bots', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  tokenEncrypted: text('token_encrypted').notNull(),
  tokenMasked: varchar('token_masked', { length: 64 }).notNull(),
  username: varchar('username', { length: 190 }),
  title: varchar('title', { length: 190 }).notNull(),
  status: mysqlEnum('status', ['PENDING_VERIFY', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING_VERIFY'),
  mode: mysqlEnum('mode', ['WEBHOOK', 'POLLING']).notNull().default('POLLING'),
  webhookSecret: char('webhook_secret', { length: 64 }),
  webhookUrl: varchar('webhook_url', { length: 255 }),
  webhookRegisteredAt: datetime('webhook_registered_at'),
  healthJson: json('health_json').$type<Record<string, unknown>>(),
  aiEnabled: tinyint('ai_enabled').notNull().default(0),
  aiSystemPrompt: text('ai_system_prompt'),
  lastEventAt: datetime('last_event_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_bots_tenant').on(t.tenantId)]);

export const botUsers = mysqlTable('bot_users', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  platformUserId: varchar('platform_user_id', { length: 190 }).notNull(),
  username: varchar('username', { length: 190 }),
  displayName: varchar('display_name', { length: 190 }),
  firstSeenAt: datetime('first_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: datetime('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  stateJson: json('state_json').$type<Record<string, unknown>>(),
}, (t) => [unique('uq_bot_users').on(t.botId, t.platformUserId)]);

export const botConversations = mysqlTable('bot_conversations', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  chatRef: varchar('chat_ref', { length: 190 }).notNull(),
  platformUserId: varchar('platform_user_id', { length: 190 }).notNull().default(''),
  lastActivityAt: datetime('last_activity_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_bot_conversation_scope').on(t.botId, t.platform, t.chatRef, t.platformUserId),
  index('idx_bot_conv_tenant').on(t.tenantId, t.botId, t.lastActivityAt),
]);

export const botMessages = mysqlTable('bot_messages', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  conversationId: char('conversation_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  direction: mysqlEnum('direction', ['INBOUND', 'OUTBOUND']).notNull(),
  platformMessageId: varchar('platform_message_id', { length: 190 }),
  senderRef: varchar('sender_ref', { length: 190 }),
  text: text('text'),
  actionType: varchar('action_type', { length: 80 }),
  actionRef: varchar('action_ref', { length: 190 }),
  status: mysqlEnum('status', ['RECEIVED', 'SENT', 'FAILED']).notNull(),
  createdAt: ts(),
}, (t) => [
  index('idx_bot_messages_conversation').on(t.conversationId, t.createdAt),
  index('idx_bot_messages_bot_created').on(t.botId, t.createdAt),
  index('idx_bot_messages_tenant').on(t.tenantId, t.createdAt),
]);

export const botCommands = mysqlTable('bot_commands', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  command: varchar('command', { length: 64 }).notNull(),
  descriptionFa: varchar('description_fa', { length: 190 }).notNull().default(''),
  responseKind: mysqlEnum('response_kind', ['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).notNull().default('TEXT'),
  responsePayload: json('response_payload').$type<Record<string, unknown>>(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  createdAt: ts(),
}, (t) => [unique('uq_bot_commands').on(t.botId, t.command)]);

export const botKeywords = mysqlTable('bot_keywords', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  keyword: varchar('keyword', { length: 190 }).notNull(),
  matchKind: mysqlEnum('match_kind', ['EXACT', 'CONTAINS']).notNull().default('CONTAINS'),
  responseKind: mysqlEnum('response_kind', ['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).notNull().default('TEXT'),
  responsePayload: json('response_payload').$type<Record<string, unknown>>(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  createdAt: ts(),
}, (t) => [index('idx_bot_keywords_bot').on(t.botId)]);

export const workflows = mysqlTable('workflows', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  nameFa: varchar('name_fa', { length: 190 }).notNull(),
  definitionJson: json('definition_json').$type<unknown>().notNull(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  runCount: int('run_count').notNull().default(0),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_workflows_tenant').on(t.tenantId)]);

export const workflowRuns = mysqlTable('workflow_runs', {
  id: char('id', { length: 26 }).primaryKey(),
  workflowId: char('workflow_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  triggerKind: varchar('trigger_kind', { length: 40 }).notNull(),
  triggerRef: varchar('trigger_ref', { length: 190 }),
  status: mysqlEnum('status', ['RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'ABORTED']).notNull().default('RUNNING'),
  stepsExecuted: int('steps_executed').notNull().default(0),
  logJson: json('log_json').$type<unknown>(),
  errorCode: varchar('error_code', { length: 80 }),
  startedAt: ts(),
  finishedAt: datetime('finished_at'),
}, (t) => [index('idx_wfruns_workflow').on(t.workflowId, t.startedAt)]);

export const botEvents = mysqlTable('bot_events', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  externalId: varchar('external_id', { length: 190 }),
  dedupHash: char('dedup_hash', { length: 64 }).notNull(),
  kind: varchar('kind', { length: 40 }).notNull(),
  chatRef: varchar('chat_ref', { length: 190 }),
  senderRef: varchar('sender_ref', { length: 190 }),
  payloadJson: json('payload_json').$type<unknown>().notNull(),
  state: mysqlEnum('state', ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED']).notNull().default('PENDING'),
  createdAt: ts(),
  processedAt: datetime('processed_at'),
}, (t) => [
  unique('uq_bot_events_dedup').on(t.botId, t.dedupHash),
  index('idx_bot_events_tenant_state').on(t.tenantId, t.state),
]);

export const media = mysqlTable('media', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: int('width'),
  height: int('height'),
  checksum: char('checksum', { length: 64 }).notNull(),
  storagePath: varchar('storage_path', { length: 255 }).notNull(),
  createdAt: ts(),
}, (t) => [index('idx_media_tenant').on(t.tenantId)]);

export const posts = mysqlTable('posts', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  title: varchar('title', { length: 190 }),
  body: text('body').notNull(),
  parseMode: mysqlEnum('parse_mode', ['NONE', 'HTML', 'MARKDOWN']).notNull().default('NONE'),
  mediaId: char('media_id', { length: 26 }),
  /** Ordered media collection; mediaId remains the legacy first-item pointer. */
  mediaIds: json('media_ids_json').$type<string[]>(),
  buttonsJson: json('buttons_json').$type<PostButtons>(),
  source: mysqlEnum('source', ['MANUAL', 'GOLD', 'WORDPRESS', 'WORKFLOW']).notNull().default('MANUAL'),
  state: mysqlEnum('state', ['DRAFT', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED']).notNull().default('DRAFT'),
  scheduledAt: datetime('scheduled_at'),
  publishedAt: datetime('published_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_posts_tenant_state').on(t.tenantId, t.state),
  index('idx_posts_schedule').on(t.state, t.scheduledAt),
]);

export type PostButtonTarget =
  | { type: 'URL'; value: string }
  | { type: 'PHONE'; value: string }
  | { type: 'TELEGRAM_ID'; value: string }
  | { type: 'BALE_ID'; value: string }
  | { type: 'RUBIKA_ID'; value: string }
  | { type: 'USERNAME'; value: string };

export interface PostButton {
  label: string;
  target?: PostButtonTarget;
  // Legacy URL/callback fields remain readable for backward compatibility.
  url?: string;
  callback?: string;
}

export interface PostButtons {
  /** Per-destination buttons override platform-wide defaults when present. */
  byChannel?: Record<string, PostButton[]>;
  /** Plain text appended after the shared message for this exact destination channel. */
  footerByChannel?: Record<string, string>;
  byPlatform?: {
    telegram?: PostButton[];
    bale?: PostButton[];
    rubika?: PostButton[];
  };
  inline?: PostButton[];
  links?: Array<{ label: string; url: string }>;
}

export const channelSavedButtons = mysqlTable('channel_saved_buttons', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  channelId: char('channel_id', { length: 26 }).notNull(),
  label: varchar('label', { length: 64 }).notNull(),
  targetType: varchar('target_type', { length: 24 }).$type<PostButtonTarget['type']>().notNull(),
  targetValue: varchar('target_value', { length: 255 }).notNull(),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_channel_saved_button_label').on(t.tenantId, t.channelId, t.label),
  index('idx_channel_saved_buttons_scope').on(t.tenantId, t.channelId, t.createdAt),
]);

export const postTargets = mysqlTable('post_targets', {
  id: char('id', { length: 26 }).primaryKey(),
  postId: char('post_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  channelId: char('channel_id', { length: 26 }).notNull(),
  state: mysqlEnum('state', ['PENDING', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'CANCELLED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  nextRetryAt: datetime('next_retry_at'),
  providerMessageId: varchar('provider_message_id', { length: 190 }),
  errorCode: varchar('error_code', { length: 80 }),
  errorMessage: varchar('error_message', { length: 255 }),
  sentAt: datetime('sent_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_post_targets').on(t.postId, t.channelId),
  index('idx_pt_tenant_state').on(t.tenantId, t.state),
  index('idx_pt_retry').on(t.state, t.nextRetryAt),
]);

export const outboxEvents = mysqlTable('outbox_events', {
  id: char('id', { length: 26 }).primaryKey(),
  aggregateType: varchar('aggregate_type', { length: 60 }).notNull(),
  aggregateId: char('aggregate_id', { length: 26 }).notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  payloadJson: json('payload_json').$type<Record<string, unknown>>().notNull(),
  state: mysqlEnum('state', ['PENDING', 'DISPATCHED', 'FAILED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  createdAt: ts(),
  dispatchedAt: datetime('dispatched_at'),
}, (t) => [index('idx_outbox_pending').on(t.state, t.createdAt)]);

export const idempotencyKeys = mysqlTable('idempotency_keys', {
  scope: varchar('scope', { length: 80 }).notNull(),
  idemKey: varchar('idem_key', { length: 190 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }),
  state: mysqlEnum('state', ['IN_PROGRESS', 'COMPLETED', 'FAILED']).notNull().default('IN_PROGRESS'),
  resultJson: json('result_json').$type<unknown>(),
  createdAt: ts(),
  expiresAt: datetime('expires_at').notNull(),
}, (t) => [primaryKey({ columns: [t.scope, t.idemKey] })]);

export const aiJobs = mysqlTable('ai_jobs', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  purpose: mysqlEnum('purpose', ['CAPTION', 'AUTO_REPLY', 'CUSTOM']).notNull().default('CUSTOM'),
  provider: varchar('provider', { length: 40 }).notNull(),
  model: varchar('model', { length: 80 }),
  inputText: text('input_text').notNull(),
  outputText: text('output_text'),
  status: mysqlEnum('status', ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).notNull().default('QUEUED'),
  promptTokens: int('prompt_tokens'),
  completionTokens: int('completion_tokens'),
  errorCode: varchar('error_code', { length: 80 }),
  createdAt: ts(),
  finishedAt: datetime('finished_at'),
}, (t) => [index('idx_ai_tenant').on(t.tenantId, t.status)]);

export const aiUsageMonthly = mysqlTable('ai_usage_monthly', {
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  periodYm: char('period_ym', { length: 7 }).notNull(),
  requestCount: int('request_count').notNull().default(0),
  tokenCount: bigint('token_count', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.periodYm] })]);

export const wordpressSites = mysqlTable('wordpress_sites', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  siteUrl: varchar('site_url', { length: 255 }).notNull(),
  siteKey: char('site_key', { length: 32 }).notNull(),
  secretHash: char('secret_hash', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['PENDING', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING'),
  autoPublish: tinyint('auto_publish').notNull().default(1),
  sendImage: tinyint('send_image').notNull().default(1),
  categoryMapJson: json('category_map_json').$type<Record<string, string>>(),
  channelIdsJson: json('channel_ids_json').$type<string[] | null>(),
  automationJson: json('automation_json').$type<Record<string, unknown> | null>(),
  messageStyle: varchar('message_style', { length: 32 }).notNull().default('shop'),
  lastSyncAt: datetime('last_sync_at'),
  lastError: varchar('last_error', { length: 255 }),
  createdAt: ts(),
}, (t) => [unique('uq_wp_key').on(t.siteKey), unique('uq_wp_tenant_url').on(t.tenantId, t.siteUrl)]);

export const wordpressProducts = mysqlTable('wordpress_products', {
  id: char('id', { length: 26 }).primaryKey(),
  siteId: char('site_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  wcProductId: bigint('wc_product_id', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  priceRial: bigint('price_rial', { mode: 'number' }),
  regularPriceRial: bigint('regular_price_rial', { mode: 'number' }),
  salePriceRial: bigint('sale_price_rial', { mode: 'number' }),
  oldPriceRial: bigint('old_price_rial', { mode: 'number' }),
  stockStatus: varchar('stock_status', { length: 30 }),
  isFeatured: tinyint('is_featured').notNull().default(0),
  salesCount: int('sales_count').notNull().default(0),
  sku: varchar('sku', { length: 190 }),
  excerpt: text('excerpt'),
  body: text('body'),
  categoriesJson: json('categories_json').$type<Array<{ id: number; name: string; slug: string }> | null>(),
  customTitle: varchar('custom_title', { length: 255 }),
  customBody: text('custom_body'),
  customImageUrl: varchar('custom_image_url', { length: 512 }),
  customImageMediaId: char('custom_image_media_id', { length: 26 }),
  permalink: varchar('permalink', { length: 255 }),
  imageUrl: varchar('image_url', { length: 512 }),
  contentHash: char('content_hash', { length: 64 }),
  lastSyncedAt: datetime('last_synced_at'),
  lastPublishedAt: datetime('last_published_at'),
}, (t) => [unique('uq_wpprod').on(t.siteId, t.wcProductId)]);

export const wordpressContents = mysqlTable('wordpress_contents', {
  id: char('id', { length: 26 }).primaryKey(),
  siteId: char('site_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  contentId: bigint('content_id', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  excerpt: text('excerpt'),
  permalink: varchar('permalink', { length: 512 }),
  imageUrl: varchar('image_url', { length: 512 }),
  contentType: varchar('content_type', { length: 32 }).notNull().default('post'),
  categoriesJson: json('categories_json').$type<Array<{ id: number; name: string; slug: string }> | null>(),
  customTitle: varchar('custom_title', { length: 255 }),
  customBody: text('custom_body'),
  customImageUrl: varchar('custom_image_url', { length: 512 }),
  customImageMediaId: char('custom_image_media_id', { length: 26 }),
  contentHash: char('content_hash', { length: 64 }).notNull(),
  postId: char('post_id', { length: 26 }).notNull(),
  lastPublishedAt: datetime('last_published_at'),
  createdAt: ts(),
}, (t) => [unique('uq_wpcontent').on(t.siteId, t.contentId)]);

export const messageTemplates = mysqlTable('message_templates', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 255 }),
  body: text('body').notNull(),
  settingsJson: json('settings_json').$type<Record<string, unknown> | null>(),
  category: varchar('category', { length: 40 }).notNull().default('general'),
  isDefault: tinyint('is_default').notNull().default(0),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_msg_tpl_tenant').on(t.tenantId), unique('uq_msg_tpl_name').on(t.tenantId, t.name)]);

export const wordpressCampaigns = mysqlTable('wordpress_campaigns', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  siteId: char('site_id', { length: 26 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  itemType: varchar('item_type', { length: 20 }).notNull().default('product'),
  selectionType: varchar('selection_type', { length: 40 }).notNull().default('latest'),
  selectionIdsJson: json('selection_ids_json').$type<number[] | string[] | null>(),
  templateId: char('template_id', { length: 26 }),
  channelIdsJson: json('channel_ids_json').$type<string[] | null>(),
  frequency: varchar('frequency', { length: 20 }).notNull().default('daily'),
  sendTime: varchar('send_time', { length: 5 }).notNull().default('12:00'),
  daysJson: json('days_json').$type<string[] | null>(),
  itemCount: int('item_count').notNull().default(3),
  isEnabled: tinyint('is_enabled').notNull().default(0),
  sentIdsJson: json('sent_ids_json').$type<number[] | string[] | null>(),
  lastRunAt: datetime('last_run_at'),
  lastResultJson: json('last_result_json').$type<unknown>(),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_wp_campaign_tenant').on(t.tenantId), index('idx_wp_campaign_due').on(t.isEnabled, t.sendTime), unique('uq_wp_campaign_name').on(t.tenantId, t.name)]);

export const telegramStickerSets = mysqlTable('telegram_sticker_sets', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }),
  telegramName: varchar('telegram_name', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  stickerType: varchar('sticker_type', { length: 30 }).notNull(),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_tg_sticker_sets_tenant').on(t.tenantId), index('idx_tg_sticker_sets_bot').on(t.tenantId, t.botId), unique('uq_tg_sticker_set').on(t.tenantId, t.telegramName)]);

export const telegramStickers = mysqlTable('telegram_stickers', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  setId: char('set_id', { length: 26 }).notNull(),
  fileId: varchar('file_id', { length: 512 }).notNull(),
  fileUniqueId: varchar('file_unique_id', { length: 255 }).notNull(),
  stickerType: varchar('sticker_type', { length: 30 }).notNull(),
  emoji: varchar('emoji', { length: 32 }),
  width: int('width'),
  height: int('height'),
  isAnimated: tinyint('is_animated').notNull().default(0),
  isVideo: tinyint('is_video').notNull().default(0),
  thumbnailFileId: varchar('thumbnail_file_id', { length: 512 }),
  customEmojiId: varchar('custom_emoji_id', { length: 255 }),
  positionIndex: int('position_index').notNull().default(0),
  createdAt: ts(),
}, (t) => [index('idx_tg_stickers_tenant').on(t.tenantId), index('idx_tg_stickers_set').on(t.setId, t.positionIndex), unique('uq_tg_sticker_file').on(t.tenantId, t.setId, t.fileUniqueId)]);


export const goldConfigs = mysqlTable('gold_configs', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  sourceUrl: varchar('source_url', { length: 512 }).notNull(),
  templateText: text('template_text').notNull(),
  channelIds: json('channel_ids').$type<string[]>().notNull(),
  frequencyMinutes: int('frequency_minutes').notNull().default(60),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
  changeOnly: tinyint('change_only').notNull().default(1),
  isEnabled: tinyint('is_enabled').notNull().default(0),
  lastSnapshotJson: json('last_snapshot_json').$type<unknown>(),
  lastRunAt: datetime('last_run_at'),
  createdAt: ts(),
}, (t) => [unique('uq_gold_tenant').on(t.tenantId)]);

export const goldSnapshots = mysqlTable('gold_snapshots', {
  id: char('id', { length: 26 }).primaryKey(),
  configId: char('config_id', { length: 26 }).notNull(),
  pricesJson: json('prices_json').$type<unknown>().notNull(),
  contentHash: char('content_hash', { length: 64 }).notNull(),
  // NOTE: this table's timestamp column is `captured_at` (not `created_at`),
  // so it must NOT use the shared ts() helper which hardcodes 'created_at'.
  capturedAt: datetime('captured_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  published: tinyint('published').notNull().default(0),
}, (t) => [index('idx_gold_snap').on(t.configId, t.capturedAt)]);

export const payments = mysqlTable('payments', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  purpose: mysqlEnum('purpose', ['SUBSCRIPTION', 'WALLET_TOPUP']).notNull().default('SUBSCRIPTION'),
  planId: char('plan_id', { length: 26 }),
  months: int('months').notNull().default(1),
  amountRial: bigint('amount_rial', { mode: 'number' }).notNull(),
  gateway: varchar('gateway', { length: 40 }).notNull(),
  gatewayRef: varchar('gateway_ref', { length: 190 }),
  authority: varchar('authority', { length: 190 }),
  reference: char('reference', { length: 26 }),
  state: mysqlEnum('state', ['CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PENDING_REVIEW', 'REJECTED', 'COMPLETED']).notNull().default('CREATED'),
  verifiedAt: datetime('verified_at'),
  metaJson: json('meta_json').$type<Record<string, unknown>>(),
  receiptMediaId: char('receipt_media_id', { length: 26 }),
  receiptNote: varchar('receipt_note', { length: 500 }),
  reviewedBy: char('reviewed_by', { length: 26 }),
  reviewedAt: datetime('reviewed_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_payments_authority').on(t.gateway, t.authority),
  unique('uq_payments_reference').on(t.reference),
  index('idx_payments_tenant').on(t.tenantId, t.state),
  index('idx_payments_state_created').on(t.state, t.createdAt),
]);

export const walletAccounts = mysqlTable('wallet_accounts', {
  tenantId: char('tenant_id', { length: 26 }).primaryKey(),
  balanceRial: bigint('balance_rial', { mode: 'number' }).notNull().default(0),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const walletLedger = mysqlTable('wallet_ledger', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  entryKind: mysqlEnum('entry_kind', ['CREDIT', 'DEBIT', 'REFUND', 'BONUS', 'PAYMENT', 'ADJUSTMENT']).notNull(),
  amountRial: bigint('amount_rial', { mode: 'number' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  refType: varchar('ref_type', { length: 60 }),
  refId: char('ref_id', { length: 26 }),
  memoFa: varchar('memo_fa', { length: 255 }).notNull().default(''),
  createdAt: ts(),
}, (t) => [
  index('idx_ledger_tenant').on(t.tenantId, t.createdAt),
  unique('uq_ledger_tenant_ref').on(t.tenantId, t.refType, t.refId, t.entryKind),
]);

export const pointLedger = mysqlTable('point_ledger', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  entryKind: mysqlEnum('entry_kind', ['EARN', 'SPEND', 'ADJUSTMENT']).notNull(),
  amount: int('amount').notNull(),
  balanceAfter: int('balance_after').notNull(),
  refType: varchar('ref_type', { length: 60 }),
  refId: char('ref_id', { length: 26 }),
  memoFa: varchar('memo_fa', { length: 255 }).notNull().default(''),
  createdAt: ts(),
}, (t) => [index('idx_point_tenant').on(t.tenantId, t.createdAt)]);

export const referrals = mysqlTable('referrals', {
  id: char('id', { length: 26 }).primaryKey(),
  referrerTenantId: char('referrer_tenant_id', { length: 26 }).notNull(),
  referredTenantId: char('referred_tenant_id', { length: 26 }).notNull(),
  referralCode: varchar('referral_code', { length: 32 }).notNull(),
  state: mysqlEnum('state', ['REGISTERED', 'REWARDED', 'FAILED']).notNull().default('REGISTERED'),
  createdAt: ts(),
}, (t) => [unique('uq_referrals_referred').on(t.referredTenantId)]);

export const referralRewards = mysqlTable('referral_rewards', {
  id: char('id', { length: 26 }).primaryKey(),
  referralId: char('referral_id', { length: 26 }).notNull(),
  rewardKind: mysqlEnum('reward_kind', ['REGISTER', 'FIRST_PURCHASE']).notNull(),
  amount: int('amount').notNull(),
  ledgerRef: char('ledger_ref', { length: 26 }),
  createdAt: ts(),
}, (t) => [unique('uq_referral_rewards').on(t.referralId, t.rewardKind)]);

export const notifications = mysqlTable('notifications', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  kind: varchar('kind', { length: 80 }).notNull(),
  subjectId: char('subject_id', { length: 26 }),
  titleFa: varchar('title_fa', { length: 190 }).notNull(),
  bodyFa: text('body_fa').notNull(),
  readAt: datetime('read_at'),
  createdAt: ts(),
}, (t) => [
  unique('uq_notif_subject').on(t.tenantId, t.kind, t.subjectId),
  index('idx_notif_tenant').on(t.tenantId, t.createdAt),
]);

export const notificationOutbound = mysqlTable('notification_outbound', {
  id: char('id', { length: 26 }).primaryKey(),
  kind: varchar('kind', { length: 80 }).notNull(),
  subjectId: char('subject_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  channelId: char('channel_id', { length: 26 }),
  destination: mysqlEnum('destination', ['INAPP', 'TELEGRAM', 'BALE', 'RUBIKA', 'EMAIL', 'SMS']).notNull(),
  state: mysqlEnum('state', ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 255 }),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  sentAt: datetime('sent_at'),
}, (t) => [
  unique('uq_notif_outbound').on(t.kind, t.subjectId, t.destination, t.channelId),
  index('idx_notif_out_state').on(t.state, t.createdAt),
]);

export const events = mysqlTable('events', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }),
  name: varchar('name', { length: 80 }).notNull(),
  subjectType: varchar('subject_type', { length: 60 }),
  subjectId: char('subject_id', { length: 26 }),
  propsJson: json('props_json').$type<Record<string, unknown>>(),
  createdAt: ts(),
}, (t) => [
  index('idx_events_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_events_name').on(t.name, t.createdAt),
]);

export const eventDaily = mysqlTable('event_daily', {
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  day: date('day').notNull(),
  eventName: varchar('event_name', { length: 80 }).notNull(),
  eventCount: int('event_count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.day, t.eventName] })]);

export const analyticsEvents = mysqlTable('analytics_events', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  occurredAt: datetime('occurred_at', { fsp: 3 }).notNull(),
  postId: char('post_id', { length: 26 }),
  targetId: char('target_id', { length: 26 }),
  channelId: char('channel_id', { length: 26 }),
  campaignId: char('campaign_id', { length: 26 }),
  linkId: char('link_id', { length: 26 }),
  platform: varchar('platform', { length: 24 }),
  source: varchar('source', { length: 32 }),
  value: bigint('value', { mode: 'bigint' }).notNull().default(1n),
  metadataJson: text('metadata_json'),
  dedupeKey: varchar('dedupe_key', { length: 191 }),
  createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  index('idx_analytics_user_time').on(t.userId, t.occurredAt),
  index('idx_analytics_event_time').on(t.eventType, t.occurredAt),
  index('idx_analytics_post_time').on(t.postId, t.occurredAt),
  index('idx_analytics_target_time').on(t.targetId, t.occurredAt),
  index('idx_analytics_channel_time').on(t.channelId, t.occurredAt),
  index('idx_analytics_campaign_time').on(t.campaignId, t.occurredAt),
  index('idx_analytics_link_time').on(t.linkId, t.occurredAt),
  index('idx_analytics_platform_time').on(t.platform, t.occurredAt),
  index('idx_analytics_dedupe').on(t.dedupeKey),
]);

export const analyticsLinks = mysqlTable('analytics_links', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }).notNull(),
  postId: char('post_id', { length: 26 }),
  targetId: char('target_id', { length: 26 }),
  channelId: char('channel_id', { length: 26 }),
  campaignId: char('campaign_id', { length: 26 }),
  token: varchar('token', { length: 96 }).notNull(),
  destinationUrl: text('destination_url').notNull(),
  clickCount: bigint('click_count', { mode: 'number' }).notNull().default(0),
  lastClickedAt: datetime('last_clicked_at', { fsp: 3 }),
  createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (t) => [
  unique('uq_analytics_link_token').on(t.token),
  index('idx_analytics_links_user').on(t.userId, t.createdAt),
  index('idx_analytics_links_post').on(t.postId, t.createdAt),
  index('idx_analytics_links_campaign').on(t.campaignId, t.createdAt),
]);

export const analyticsLinkClicks = mysqlTable('analytics_link_clicks', {
  id: char('id', { length: 26 }).primaryKey(),
  linkId: char('link_id', { length: 26 }).notNull(),
  clickedAt: datetime('clicked_at', { fsp: 3 }).notNull(),
  platform: varchar('platform', { length: 24 }),
  source: varchar('source', { length: 32 }),
  referrer: varchar('referrer', { length: 500 }),
  userAgent: varchar('user_agent', { length: 500 }),
  ipHash: char('ip_hash', { length: 64 }),
  metadataJson: text('metadata_json'),
}, (t) => [
  index('idx_analytics_clicks_link_time').on(t.linkId, t.clickedAt),
  index('idx_analytics_clicks_platform_time').on(t.platform, t.clickedAt),
]);

export const mediaAccessTokens = mysqlTable('media_access_tokens', {
  id: char('id', { length: 26 }).primaryKey(),
  mediaId: char('media_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  createdAt: ts(),
}, (t) => [unique('uq_mat_token').on(t.tokenHash)]);

export const auditLogs = mysqlTable('audit_logs', {
  id: char('id', { length: 26 }).primaryKey(),
  actorId: char('actor_id', { length: 26 }),
  actorRole: varchar('actor_role', { length: 40 }),
  action: varchar('action', { length: 80 }).notNull(),
  subjectType: varchar('subject_type', { length: 60 }),
  subjectId: char('subject_id', { length: 26 }),
  ip: varchar('ip', { length: 64 }),
  metaJson: json('meta_json').$type<Record<string, unknown>>(),
  createdAt: ts(),
}, (t) => [index('idx_audit_actor').on(t.actorId, t.createdAt)]);

export const tickets = mysqlTable('tickets', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  subject: varchar('subject', { length: 190 }).notNull(),
  category: varchar('category', { length: 80 }).notNull().default('GENERAL'),
  state: mysqlEnum('state', ['OPEN', 'ANSWERED', 'CLOSED']).notNull().default('OPEN'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_tickets_tenant').on(t.tenantId, t.state)]);

export const ticketMessages = mysqlTable('ticket_messages', {
  id: char('id', { length: 26 }).primaryKey(),
  ticketId: char('ticket_id', { length: 26 }).notNull(),
  authorId: char('author_id', { length: 26 }),
  authorRole: mysqlEnum('author_role', ['USER', 'SUPPORT', 'SUPER_ADMIN', 'SYSTEM']).notNull().default('USER'),
  body: text('body').notNull(),
  createdAt: ts(),
}, (t) => [index('idx_tmsg_ticket').on(t.ticketId, t.createdAt)]);

/** One attachment per ticket message (0003, uq_tatt_message). */
export const ticketMessageAttachments = mysqlTable('ticket_message_attachments', {
  id: char('id', { length: 26 }).primaryKey(),
  messageId: char('message_id', { length: 26 }).notNull(),
  mediaId: char('media_id', { length: 26 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  createdAt: ts(),
}, (t) => [
  unique('uq_tatt_message').on(t.messageId),
  index('idx_tatt_media').on(t.mediaId),
]);

export const systemSettings = mysqlTable('system_settings', {
  settingKey: varchar('setting_key', { length: 80 }).primaryKey(),
  valueJson: json('value_json').$type<Record<string, unknown>>().notNull(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const linkClicks = mysqlTable('link_clicks', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  postTargetId: char('post_target_id', { length: 26 }),
  linkKey: varchar('link_key', { length: 80 }).notNull(),
  visitorHash: char('visitor_hash', { length: 64 }).notNull(),
  referer: varchar('referer', { length: 255 }),
  createdAt: ts(),
}, (t) => [index('idx_clicks_tenant').on(t.tenantId, t.createdAt)]);

// Public survey workflow. Existing Postyar tables and publishing schema are unchanged.
export const surveys = mysqlTable('surveys', {
  id: char('id', { length: 26 }).primaryKey(),
  creatorId: char('creator_id', { length: 26 }).notNull(),
  question: varchar('question', { length: 200 }).notNull(),
  description: varchar('description', { length: 500 }),
  status: mysqlEnum('status', ['PENDING', 'APPROVED', 'REJECTED', 'CLOSED']).notNull().default('PENDING'),
  isFeatured: tinyint('is_featured').notNull().default(0),
  reviewedBy: char('reviewed_by', { length: 26 }),
  reviewedAt: datetime('reviewed_at'),
  reviewNote: varchar('review_note', { length: 500 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_surveys_creator_status').on(t.creatorId, t.status, t.createdAt),
  index('idx_surveys_public_featured').on(t.status, t.isFeatured, t.createdAt),
]);

export const surveyOptions = mysqlTable('survey_options', {
  id: char('id', { length: 26 }).primaryKey(),
  surveyId: char('survey_id', { length: 26 }).notNull(),
  label: varchar('label', { length: 100 }).notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('idx_survey_options_survey').on(t.surveyId, t.sortOrder)]);

export const surveyVotes = mysqlTable('survey_votes', {
  id: char('id', { length: 26 }).primaryKey(),
  surveyId: char('survey_id', { length: 26 }).notNull(),
  optionId: char('option_id', { length: 26 }).notNull(),
  voterHash: char('voter_hash', { length: 64 }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_survey_votes_voter').on(t.surveyId, t.voterHash),
  index('idx_survey_votes_option').on(t.surveyId, t.optionId),
]);

export const surveyEvents = mysqlTable('survey_events', {
  id: char('id', { length: 26 }).primaryKey(),
  surveyId: char('survey_id', { length: 26 }).notNull(),
  actorId: char('actor_id', { length: 26 }),
  action: mysqlEnum('action', ['SUBMITTED', 'APPROVED', 'REJECTED', 'CLOSED']).notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('idx_survey_events_survey').on(t.surveyId, t.createdAt)]);
