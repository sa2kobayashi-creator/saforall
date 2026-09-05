-- Pre-estimate + user plan budget settings
INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('billing.user_plan', 'unlimited'),
  ('billing.user.monthly_usd', '')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
