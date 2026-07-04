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

try {
    $assistantText = LlmClient::chat(
        $prepared['base_url'],
        $prepared['api_key'],
        $prepared['model'],
        $prepared['messages']
    );
} catch (Throwable $e) {
    Response::error('LLM_REQUEST_FAILED', $e->getMessage(), 502);
}

$assistantMessage = ChatService::saveAssistant($pdo, $prepared['session_id'], $assistantText);
$userMessage = ChatService::fetchMessage($pdo, $prepared['user_message_id']);

Response::ok([
    'model' => $prepared['model'],
    'user_message' => $userMessage,
    'assistant_message' => $assistantMessage,
]);
