<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/ChatService.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$body = Request::jsonBody();
$engine = isset($body['engine']) && is_string($body['engine'])
    ? strtolower(trim($body['engine']))
    : 'openai';

if ($engine !== 'openai') {
    Response::error('INVALID_ENGINE', '現状は engine=openai のみ対応です', 400);
}

$pdo = Database::connection();
$settings = AppSettings::load($pdo);

$apiKey = AppSettings::secret($settings, 'llm.openai.api_key', 'OPENAI_API_KEY');
if ($apiKey === '') {
    $apiKey = AppSettings::secret($settings, 'llm.api_key', 'SAFORALL_API_KEY');
}
if ($apiKey === '') {
    Response::error('LLM_NOT_CONFIGURED', 'OpenAI API キーが未設定です。先に保存してください。', 400);
}

$baseUrl = AppSettings::str($settings, 'llm.openai.base_url', '');
if ($baseUrl === '') {
    $baseUrl = AppSettings::str($settings, 'llm.base_url', 'https://api.openai.com/v1');
}
$baseUrl = ChatService::normalizeOpenAiCompatibleBaseUrl($baseUrl);

$model = isset($body['model']) && is_string($body['model']) && trim($body['model']) !== ''
    ? trim($body['model'])
    : 'gpt-4.1-mini';

try {
    $text = LlmClient::chat(
        $baseUrl,
        $apiKey,
        $model,
        [
            ['role' => 'user', 'content' => 'Reply with exactly: ok'],
        ]
    );
} catch (Throwable $e) {
    Response::error('LLM_TEST_FAILED', $e->getMessage(), 502);
}

Response::ok([
    'ok' => true,
    'engine' => 'openai',
    'model' => $model,
    'base_url' => $baseUrl,
    'sample' => mb_substr(trim($text), 0, 120),
    'note' => 'ブラウザで /v1 を開くと 404 になりますが正常です。このテスト成功なら API は使えます。',
]);
