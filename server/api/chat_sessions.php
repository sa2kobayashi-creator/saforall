<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $limit = isset($_GET['limit']) ? max(1, min(50, (int) $_GET['limit'])) : 20;
    $workspaceId = isset($_GET['workspace_id']) ? (int) $_GET['workspace_id'] : null;

    if ($workspaceId) {
        $stmt = $pdo->prepare(
            'SELECT id, workspace_id, title, created_at, updated_at
             FROM chat_sessions
             WHERE workspace_id = :workspace_id
             ORDER BY updated_at DESC
             LIMIT :limit'
        );
        $stmt->bindValue(':workspace_id', $workspaceId, PDO::PARAM_INT);
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, workspace_id, title, created_at, updated_at
             FROM chat_sessions
             ORDER BY updated_at DESC
             LIMIT :limit'
        );
    }

    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();

    Response::ok(['sessions' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $body = Request::jsonBody();
    $title = isset($body['title']) && is_string($body['title']) && trim($body['title']) !== ''
        ? trim($body['title'])
        : 'New chat';
    $workspaceId = isset($body['workspace_id']) ? (int) $body['workspace_id'] : null;

    if ($workspaceId) {
        $check = $pdo->prepare('SELECT id FROM workspaces WHERE id = :id');
        $check->execute([':id' => $workspaceId]);
        if (!$check->fetch()) {
            Response::error('NOT_FOUND', 'workspace not found', 404);
        }
    }

    $stmt = $pdo->prepare(
        'INSERT INTO chat_sessions (workspace_id, title) VALUES (:workspace_id, :title)'
    );
    $stmt->execute([
        ':workspace_id' => $workspaceId ?: null,
        ':title' => $title,
    ]);

    $id = (int) $pdo->lastInsertId();
    $row = $pdo->prepare(
        'SELECT id, workspace_id, title, created_at, updated_at FROM chat_sessions WHERE id = :id'
    );
    $row->execute([':id' => $id]);

    Response::ok(['session' => $row->fetch()], 201);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET or POST', 405);
