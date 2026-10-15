CREATE TABLE bot_conversations (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  bot_id CHAR(26) NOT NULL,
  platform ENUM('telegram','bale','rubika') NOT NULL,
  chat_ref VARCHAR(190) NOT NULL,
  platform_user_id VARCHAR(190) NOT NULL DEFAULT '',
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bot_conversation_scope (bot_id, platform, chat_ref, platform_user_id),
  KEY idx_bot_conv_tenant (tenant_id, bot_id, last_activity_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bot_messages (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  bot_id CHAR(26) NOT NULL,
  conversation_id CHAR(26) NOT NULL,
  platform ENUM('telegram','bale','rubika') NOT NULL,
  direction ENUM('INBOUND','OUTBOUND') NOT NULL,
  platform_message_id VARCHAR(190) NULL,
  sender_ref VARCHAR(190) NULL,
  text TEXT NULL,
  action_type VARCHAR(80) NULL,
  action_ref VARCHAR(190) NULL,
  status ENUM('RECEIVED','SENT','FAILED') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bot_messages_conversation (conversation_id, created_at),
  KEY idx_bot_messages_bot_created (bot_id, created_at),
  KEY idx_bot_messages_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
