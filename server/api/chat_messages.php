<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

/** @var int $sessionId */
$sessionId = $sessionId ?? 0;

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$check = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = :id');
$check->execute([':id' => $sessionId]);
if (!$check->fetch()) {
    Response::error('NOT_FOUND', 'session not found', 404);
}

if ($method === 'GET') {
    $stmt = $pdo->prepare(
        'SELECT id, session_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = :session_id
         ORDER BY id ASC'
    );
    $stmt->execute([':session_id' => $sessionId]);

    Response::ok(['messages' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $body = Request::jsonBody();
    $role = isset($body['role']) && is_string($body['role']) ? $body['role'] : '';
    $content = isset($body['content']) && is_string($body['content']) ? $body['content'] : '';

    if (!in_array($role, ['user', 'assistant', 'system'], true)) {
        Response::error('INVALID_BODY', 'role must be user, assistant, or system', 400);
    }
    if (trim($content) === '') {
        Response::error('INVALID_BODY', 'content is required', 400);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO chat_messages (session_id, role, content)
         VALUES (:session_id, :role, :content)'
    );
    $stmt->execute([
        ':session_id' => $sessionId,
        ':role' => $role,
        ':content' => $content,
    ]);

    $messageId = (int) $pdo->lastInsertId();

    $touch = $pdo->prepare(
        'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = :id'
    );
    $touch->execute([':id' => $sessionId]);

    // タイトルが未設定相当なら先頭ユーザー文で更新
    if ($role === 'user') {
        $titleStmt = $pdo->prepare('SELECT title FROM chat_sessions WHERE id = :id');
        $titleStmt->execute([':id' => $sessionId]);
        $session = $titleStmt->fetch();
        if ($session && ($session['title'] === 'New chat' || $session['title'] === '')) {
            $title = mb_substr(trim($content), 0, 40);
            $updateTitle = $pdo->prepare('UPDATE chat_sessions SET title = :title WHERE id = :id');
            $updateTitle->execute([
                ':title' => $title,
                ':id' => $sessionId,
            ]);
        }
    }

    $row = $pdo->prepare(
        'SELECT id, session_id, role, content, created_at FROM chat_messages WHERE id = :id'
    );
    $row->execute([':id' => $messageId]);

    Response::ok(['message' => $row->fetch()], 201);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET or POST', 405);
