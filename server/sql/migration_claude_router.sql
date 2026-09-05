-- Claude provider + product Router defaults (OpenAI / Gemini / Claude).
INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('llm.claude.api_key', ''),
  ('llm.claude.model', 'claude-sonnet-4-20250514'),
  ('llm.claude.models', '["claude-sonnet-4-20250514","claude-haiku-4-20250414"]'),
  ('llm.claude.base_url', 'https://api.anthropic.com'),
  ('cost.claude.monthly_usd', '10'),
  ('router.enabled_engines', '["openai","gemini","claude"]')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
