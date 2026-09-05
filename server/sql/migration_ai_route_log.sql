-- Route / Agent decision log for tuning Router from real usage.
CREATE TABLE IF NOT EXISTS `ai_route_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id`      BIGINT UNSIGNED NULL,
  `requested`       VARCHAR(32) NOT NULL DEFAULT '',
  `engine`          VARCHAR(32) NOT NULL DEFAULT '',
  `task_type`       VARCHAR(64) NOT NULL DEFAULT '',
  `mode`            VARCHAR(16) NOT NULL DEFAULT 'ask',
  `model`           VARCHAR(191) NULL,
  `estimated_usd`   DECIMAL(10, 6) NOT NULL DEFAULT 0,
  `fallback_from`   VARCHAR(32) NULL,
  `fallback_reason` TEXT NULL,
  `budget_warning`  TEXT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_route_log_created` (`created_at`),
  KEY `idx_ai_route_log_engine` (`engine`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
