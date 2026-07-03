-- saforall MySQL schema (XAMPP)
-- phpMyAdmin または mysql クライアントで実行してください。

CREATE DATABASE IF NOT EXISTS `saforall`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `saforall`;

CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key`   VARCHAR(191) NOT NULL,
  `setting_value` TEXT NULL,
  `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workspaces` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `path`           VARCHAR(1024) NOT NULL,
  `display_name`   VARCHAR(255) NULL,
  `last_opened_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_workspaces_last_opened` (`last_opened_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_sessions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `workspace_id` BIGINT UNSIGNED NULL,
  `title`        VARCHAR(255) NOT NULL DEFAULT 'New chat',
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_sessions_workspace` (`workspace_id`),
  CONSTRAINT `fk_chat_sessions_workspace`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `role`       ENUM('user', 'assistant', 'system') NOT NULL,
  `content`    MEDIUMTEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_session` (`session_id`, `created_at`),
  CONSTRAINT `fk_chat_messages_session`
    FOREIGN KEY (`session_id`) REFERENCES `chat_sessions` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('llm.base_url', 'https://api.openai.com/v1'),
  ('llm.model', 'gpt-4o-mini'),
  ('app.locale', 'ja')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
