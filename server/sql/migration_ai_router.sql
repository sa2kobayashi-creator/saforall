-- 既存 DB 向け（phpMyAdmin で実行）

USE `saforall`;

CREATE TABLE IF NOT EXISTS `ai_usage` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id`     BIGINT UNSIGNED NULL,
  `engine`         VARCHAR(32) NOT NULL,
  `task_type`      VARCHAR(64) NOT NULL DEFAULT '',
  `model`          VARCHAR(191) NULL,
  `input_tokens`   INT UNSIGNED NOT NULL DEFAULT 0,
  `output_tokens`  INT UNSIGNED NOT NULL DEFAULT 0,
  `estimated_usd`  DECIMAL(10, 6) NOT NULL DEFAULT 0,
  `fallback_from`  VARCHAR(32) NULL,
  `cursor_run_id`  VARCHAR(191) NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_usage_month_engine` (`created_at`, `engine`),
  KEY `idx_ai_usage_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cursor_runs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id`   BIGINT UNSIGNED NOT NULL,
  `status`       VARCHAR(32) NOT NULL DEFAULT 'queued',
  `runtime`      VARCHAR(16) NOT NULL DEFAULT 'local',
  `model`        VARCHAR(191) NULL,
  `agent_id`     VARCHAR(191) NULL,
  `run_id`       VARCHAR(191) NULL,
  `cwd`          VARCHAR(1024) NULL,
  `error`        TEXT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cursor_runs_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('llm.openai.model', 'gpt-4o-mini'),
  ('llm.gemini.base_url', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  ('llm.gemini.model', 'gemini-2.0-flash'),
  ('llm.cursor.model', 'grok-4.6'),
  ('cost.cursor.monthly_usd', '70'),
  ('cost.openai.monthly_usd', '20'),
  ('cost.gemini.monthly_usd', '10'),
  ('cost.workers.monthly_usd', '5'),
  ('llm.workers.model', '@cf/meta/llama-3.1-8b-instruct'),
  ('llm.workers.gateway_id', 'default')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
