<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/UsageService.php';
require_once dirname(__DIR__) . '/src/AiRouter.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$prepared = ChatService::prepare($pdo, $body);
$includeSecrets = ($_SERVER['HTTP_X_SAFORALL_CLIENT'] ?? '') === 'electron-main';

$cursorRunId = null;
if ($prepared['engine'] === 'cursor') {
    $cwd = isset($body['workspace_path']) && is_string($body['workspace_path'])
        ? $body['workspace_path']
        : null;
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO cursor_runs (session_id, status, runtime, model, cwd)
             VALUES (:session_id, :status, :runtime, :model, :cwd)'
        );
        $stmt->execute([
            ':session_id' => $prepared['session_id'],
            ':status' => 'queued',
            ':runtime' => 'local',
            ':model' => $prepared['model'],
            ':cwd' => $cwd,
        ]);
        $cursorRunId = (int) $pdo->lastInsertId();
    } catch (Throwable) {
        $cursorRunId = null;
    }
}

$userMessage = ChatService::fetchMessage($pdo, $prepared['user_message_id']);
$settings = AppSettings::load($pdo);

Response::ok([
    'engine' => $prepared['engine'],
    'requested' => $prepared['requested'],
    'task_type' => $prepared['task_type'],
    'fallback_from' => $prepared['fallback_from'],
    'fallback_reason' => $prepared['fallback_reason'],
    'model' => $prepared['model'],
    'session_id' => $prepared['session_id'],
    'user_message_id' => $prepared['user_message_id'],
    'user_message' => $userMessage,
    'cursor_run_id' => $cursorRunId,
    'usage' => UsageService::monthSummary($pdo, $settings),
    'cursor_api_key' => $includeSecrets && $prepared['engine'] === 'cursor'
        ? $prepared['api_key']
        : null,
]);
