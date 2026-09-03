<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/UsageService.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$sessionId = isset($body['session_id']) ? (int) $body['session_id'] : 0;
$content = isset($body['content']) && is_string($body['content']) ? $body['content'] : '';
$engine = isset($body['engine']) && is_string($body['engine']) ? $body['engine'] : 'cursor';
$taskType = isset($body['task_type']) && is_string($body['task_type']) ? $body['task_type'] : '';
$model = isset($body['model']) && is_string($body['model']) ? $body['model'] : '';
$cursorRunId = isset($body['cursor_run_id']) ? (int) $body['cursor_run_id'] : 0;
$agentId = isset($body['agent_id']) && is_string($body['agent_id']) ? $body['agent_id'] : null;
$sdkRunId = isset($body['sdk_run_id']) && is_string($body['sdk_run_id']) ? $body['sdk_run_id'] : null;
$status = isset($body['status']) && is_string($body['status']) ? $body['status'] : 'done';
$error = isset($body['error']) && is_string($body['error']) ? $body['error'] : null;
$fallbackFrom = isset($body['fallback_from']) && is_string($body['fallback_from']) ? $body['fallback_from'] : null;

if ($sessionId <= 0 || $content === '') {
    Response::error('INVALID_BODY', 'session_id and content are required', 400);
}

if ($cursorRunId > 0) {
    $update = $pdo->prepare(
        'UPDATE cursor_runs
         SET status = :status, agent_id = :agent_id, run_id = :run_id, error = :error
         WHERE id = :id'
    );
    $update->execute([
        ':status' => $status,
        ':agent_id' => $agentId,
        ':run_id' => $sdkRunId,
        ':error' => $error,
        ':id' => $cursorRunId,
    ]);
}

$assistantMessage = ChatService::saveAssistant($pdo, $sessionId, $content);
$inputTokens = isset($body['input_tokens']) ? (int) $body['input_tokens'] : UsageService::tokensFromText($content);
$outputTokens = isset($body['output_tokens']) ? (int) $body['output_tokens'] : UsageService::tokensFromText($content);
$estimated = UsageService::estimateUsd($engine, $inputTokens, $outputTokens);

UsageService::record($pdo, [
    'session_id' => $sessionId,
    'engine' => $engine,
    'task_type' => $taskType,
    'model' => $model,
    'input_tokens' => $inputTokens,
    'output_tokens' => $outputTokens,
    'estimated_usd' => $estimated,
    'fallback_from' => $fallbackFrom,
    'cursor_run_id' => $sdkRunId ?? (string) $cursorRunId,
]);

$settings = AppSettings::load($pdo);
Response::ok([
    'assistant_message' => $assistantMessage,
    'estimated_usd' => $estimated,
    'usage' => UsageService::monthSummary($pdo, $settings),
]);
