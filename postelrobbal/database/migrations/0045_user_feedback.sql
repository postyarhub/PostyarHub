CREATE TABLE `user_feedback` (
  `id` CHAR(26) NOT NULL,
  `user_id` CHAR(26) NOT NULL,
  `display_name` VARCHAR(80) NOT NULL,
  `message` TEXT NOT NULL,
  `show_on_homepage` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('PENDING','APPROVED','REJECTED','CLOSED') NOT NULL DEFAULT 'PENDING',
  `reviewed_by` CHAR(26) NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_feedback_user_created` (`user_id`,`created_at`),
  KEY `idx_user_feedback_status_created` (`status`,`created_at`),
  KEY `idx_user_feedback_public` (`status`,`show_on_homepage`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
