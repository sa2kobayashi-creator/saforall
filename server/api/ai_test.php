<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/ModelCatalog.php';
require_once dirname(__DIR__) . '/src/ChatService.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';
require_once dirname(__DIR__) . '/src/GeminiClient.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$body = Request::jsonBody();
$engine = isset($body['engine']) && is_string($body['engine'])
    ? strtolower(trim($body['engine']))
    : '';

if (!in_array($engine, ['openai', 'gemini', 'workers', 'cursor'], true)) {
    Response::error('INVALID_ENGINE', 'engine=openai|gemini|workers|cursor を指定してください', 400);
}

$pdo = Database::connection();
$settings = AppSettings::load($pdo);

$forcedModel = isset($body['model']) && is_string($body['model']) ? trim($body['model']) : null;
if ($forcedModel === '') {
    $forcedModel = null;
}

$messages = [
    ['role' => 'user', 'content' => 'Reply with exactly: ok'],
];

try {
    if ($engine === 'cursor') {
        $apiKey = AppSettings::secret($settings, 'llm.cursor.api_key', 'CURSOR_API_KEY');
        if ($apiKey === '') {
            Response::error('LLM_NOT_CONFIGURED', 'Cursor API キーが未設定です。先に保存してください。', 400);
        }
        Response::ok([
            'ok' => true,
            'engine' => 'cursor',
            'model' => $forcedModel ?? AppSettings::str($settings, 'llm.cursor.model', 'auto'),
            'base_url' => 'cursor-sdk',
            'sample' => 'API キーは設定済みです',
            'note' => 'Cursor は Electron SDK で実行します。実接続はチャットで Cursor を選んで確認してください。',
        ]);
    }

    $provider = ChatService::providerConfig($settings, $engine, 'light_qa', $forcedModel);

    if ($engine === 'gemini') {
        $text = GeminiClient::chat($provider['api_key'], $provider['model'], $messages);
        $baseUrl = 'gemini-native';
    } else {
        $text = LlmClient::chat(
            $provider['base_url'],
            $provider['api_key'],
            $provider['model'],
            $messages,
            $provider['extra_headers']
        );
        $baseUrl = $provider['base_url'];
    }
} catch (Throwable $e) {
    Response::error('LLM_TEST_FAILED', $e->getMessage(), 502);
}

Response::ok([
    'ok' => true,
    'engine' => $engine,
    'model' => $provider['model'],
    'base_url' => $baseUrl,
    'sample' => mb_substr(trim($text), 0, 120),
    'note' => '接続テスト成功。このエンジンは利用可能です。',
]);
