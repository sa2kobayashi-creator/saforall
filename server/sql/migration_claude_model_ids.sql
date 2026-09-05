-- Fix invalid Claude model IDs (claude-sonnet-4-20250514 was not a real API id).
UPDATE `settings`
SET `setting_value` = 'claude-sonnet-5'
WHERE `setting_key` = 'llm.claude.model';

UPDATE `settings`
SET `setting_value` = '["claude-sonnet-5","claude-haiku-4-5-20251001"]'
WHERE `setting_key` = 'llm.claude.models';
