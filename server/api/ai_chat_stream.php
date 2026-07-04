<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$prepared = ChatService::prepare($pdo, $body);

// ここから SSE
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
        }
    );

    $assistantMessage = ChatService::saveAssistant($pdo, $prepared['session_id'], $assistantText);
    $send([
        'type' => 'done',
        'model' => $prepared['model'],
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
