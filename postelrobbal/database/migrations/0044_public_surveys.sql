CREATE TABLE IF NOT EXISTS `surveys` (
  `id` CHAR(26) NOT NULL,
  `creator_id` CHAR(26) NOT NULL,
  `question` VARCHAR(200) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED','CLOSED') NOT NULL DEFAULT 'PENDING',
  `is_featured` TINYINT NOT NULL DEFAULT 0,
  `reviewed_by` CHAR(26) NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_surveys_creator_status` (`creator_id`,`status`,`created_at`),
  KEY `idx_surveys_public_featured` (`status`,`is_featured`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `survey_options` (
  `id` CHAR(26) NOT NULL,
  `survey_id` CHAR(26) NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_survey_options_survey` (`survey_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `survey_votes` (
  `id` CHAR(26) NOT NULL,
  `survey_id` CHAR(26) NOT NULL,
  `option_id` CHAR(26) NOT NULL,
  `voter_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_survey_votes_voter` (`survey_id`,`voter_hash`),
  KEY `idx_survey_votes_option` (`survey_id`,`option_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `survey_events` (
  `id` CHAR(26) NOT NULL,
  `survey_id` CHAR(26) NOT NULL,
  `actor_id` CHAR(26) NULL,
  `action` ENUM('SUBMITTED','APPROVED','REJECTED','CLOSED') NOT NULL,
  `note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_survey_events_survey` (`survey_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
