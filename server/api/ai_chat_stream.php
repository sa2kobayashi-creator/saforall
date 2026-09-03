<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/UsageService.php';
require_once dirname(__DIR__) . '/src/AiRouter.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$prepared = ChatService::prepare($pdo, $body);

if ($prepared['engine'] === 'cursor') {
    Response::error(
        'USE_CURSOR_SDK',
        'Cursor は Electron の SDK 経由で実行します。',
        409
    );
}

while (ob_get_level() > 0) {
    ob_end_flush();
}
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');
header('Access-Control-Allow-Origin: *');

$send = static function (array $payload): void {
    echo 'data: ' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
};

try {
    $userMessage = ChatService::fetchMessage($pdo, $prepared['user_message_id']);
    $send([
        'type' => 'user_message',
        'message' => $userMessage,
    ]);
    $send([
        'type' => 'route',
        'engine' => $prepared['engine'],
        'task_type' => $prepared['task_type'],
        'model' => $prepared['model'],
        'fallback_reason' => $prepared['fallback_reason'],
    ]);

    $assistantText = LlmClient::chatStream(
        $prepared['base_url'],
        $prepared['api_key'],
        $prepared['model'],
        $prepared['messages'],
        static function (string $delta) use ($send): void {
            $send([
                'type' => 'delta',
                'text' => $delta,
            ]);
        },
        $prepared['extra_headers']
    );

    $assistantMessage = ChatService::saveAssistant($pdo, $prepared['session_id'], $assistantText);
    $inputTokens = UsageService::tokensFromText($prepared['messages'][count($prepared['messages']) - 1]['content'] ?? '');
    $outputTokens = UsageService::tokensFromText($assistantText);
    $estimated = UsageService::estimateUsd($prepared['engine'], $inputTokens, $outputTokens);
    UsageService::record($pdo, [
        'session_id' => $prepared['session_id'],
        'engine' => $prepared['engine'],
        'task_type' => $prepared['task_type'],
        'model' => $prepared['model'],
        'input_tokens' => $inputTokens,
        'output_tokens' => $outputTokens,
        'estimated_usd' => $estimated,
        'fallback_from' => $prepared['fallback_from'],
    ]);

    $settings = AppSettings::load($pdo);
    $send([
        'type' => 'done',
        'model' => $prepared['model'],
        'engine' => $prepared['engine'],
        'task_type' => $prepared['task_type'],
        'estimated_usd' => $estimated,
        'usage' => UsageService::monthSummary($pdo, $settings),
        'assistant_message' => $assistantMessage,
    ]);
} catch (Throwable $e) {
    $send([
        'type' => 'error',
        'code' => 'LLM_REQUEST_FAILED',
        'message' => $e->getMessage(),
    ]);
}

exit;
