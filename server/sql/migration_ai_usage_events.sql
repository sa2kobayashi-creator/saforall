-- Additive usage-event log for AI Router (does not alter existing ai_usage).

USE `saforall`;

CREATE TABLE IF NOT EXISTS `ai_usage_events` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id`      VARCHAR(191) NOT NULL,
  `provider`        VARCHAR(32) NOT NULL,
  `model`           VARCHAR(191) NULL,
  `input_tokens`    INT UNSIGNED NOT NULL DEFAULT 0,
  `output_tokens`   INT UNSIGNED NOT NULL DEFAULT 0,
  `total_tokens`    INT UNSIGNED NOT NULL DEFAULT 0,
  `estimated_cost`  DECIMAL(10, 6) NOT NULL DEFAULT 0,
  `status`          VARCHAR(32) NOT NULL DEFAULT 'ok',
  `session_id`      BIGINT UNSIGNED NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_usage_events_created` (`created_at`),
  KEY `idx_ai_usage_events_provider` (`provider`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
