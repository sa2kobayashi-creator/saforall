INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('llm.claude.prepaid_remaining_usd', ''),
  ('llm.claude.prepaid_warn_usd', '1')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
