<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/UsageService.php';
require_once dirname(__DIR__) . '/src/AiRouter.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';
require_once dirname(__DIR__) . '/src/GeminiClient.php';
require_once dirname(__DIR__) . '/src/ClaudeClient.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$prepared = ChatService::prepare($pdo, $body);

if ($prepared['engine'] === 'cursor') {
    Response::error('USE_CURSOR_SDK', 'Cursor は Electron の SDK 経由で実行します。', 409);
}

try {
    if ($prepared['engine'] === 'gemini') {
        $assistantText = GeminiClient::chat(
            $prepared['api_key'],
            $prepared['model'],
            $prepared['messages']
        );
    } elseif ($prepared['engine'] === 'claude') {
        $assistantText = ClaudeClient::chat(
            $prepared['api_key'],
            $prepared['model'],
            $prepared['messages'],
            (string) ($prepared['base_url'] ?? '')
        );
    } else {
        $assistantText = LlmClient::chat(
            $prepared['base_url'],
            $prepared['api_key'],
            $prepared['model'],
            $prepared['messages'],
            $prepared['extra_headers']
        );
    }
} catch (Throwable $e) {
    Response::error('LLM_REQUEST_FAILED', $e->getMessage(), 502);
}

$assistantMessage = ChatService::saveAssistant($pdo, $prepared['session_id'], $assistantText);
$userMessage = ChatService::fetchMessage($pdo, $prepared['user_message_id']);
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

Response::ok([
    'model' => $prepared['model'],
    'engine' => $prepared['engine'],
    'task_type' => $prepared['task_type'],
    'estimated_usd' => $estimated,
    'user_message' => $userMessage,
    'assistant_message' => $assistantMessage,
]);
