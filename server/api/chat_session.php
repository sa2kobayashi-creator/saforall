<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

/** @var int $sessionId */
if (!isset($sessionId) || $sessionId <= 0) {
    Response::error('BAD_REQUEST', 'session id required', 400);
}

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$find = $pdo->prepare(
    'SELECT id, workspace_id, title, created_at, updated_at
     FROM chat_sessions
     WHERE id = :id'
);
$find->execute([':id' => $sessionId]);
$session = $find->fetch();
if (!$session) {
    Response::error('NOT_FOUND', 'session not found', 404);
}

if ($method === 'GET') {
    Response::ok(['session' => $session]);
}

if ($method === 'PATCH' || $method === 'PUT') {
    $body = Request::jsonBody();
    $title = isset($body['title']) && is_string($body['title']) ? trim($body['title']) : '';
    if ($title === '') {
        Response::error('VALIDATION', 'title is required', 422);
    }
    if (mb_strlen($title) > 120) {
        $title = mb_substr($title, 0, 120);
    }

    $stmt = $pdo->prepare(
        'UPDATE chat_sessions
         SET title = :title, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $stmt->execute([
        ':title' => $title,
        ':id' => $sessionId,
    ]);

    $find->execute([':id' => $sessionId]);
    Response::ok(['session' => $find->fetch()]);
}

if ($method === 'DELETE') {
    $stmt = $pdo->prepare('DELETE FROM chat_sessions WHERE id = :id');
    $stmt->execute([':id' => $sessionId]);
    Response::ok(['deleted' => true, 'id' => $sessionId]);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET, PATCH, PUT, or DELETE', 405);
