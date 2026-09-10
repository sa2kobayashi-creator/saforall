<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

/** @var int $sessionId */
$sessionId = $sessionId ?? 0;

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$check = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = :id');
$check->execute([':id' => $sessionId]);
if (!$check->fetch()) {
    Response::error('NOT_FOUND', 'session not found', 404);
}

$body = Request::jsonBody();
$messageId = isset($body['message_id']) ? (int) $body['message_id'] : 0;
if ($messageId <= 0) {
    Response::error('INVALID_BODY', 'message_id is required', 400);
}

$mode = isset($body['mode']) && is_string($body['mode']) ? $body['mode'] : 'deleteFrom';
if ($mode !== 'keepThrough' && $mode !== 'deleteFrom') {
    Response::error('INVALID_BODY', 'mode must be keepThrough or deleteFrom', 400);
}

$find = $pdo->prepare(
    'SELECT id, session_id, role, content, created_at
     FROM chat_messages
     WHERE id = :id AND session_id = :session_id'
);
$find->execute([
    ':id' => $messageId,
    ':session_id' => $sessionId,
]);
$target = $find->fetch();
if (!$target) {
    Response::error('NOT_FOUND', 'message not found', 404);
}

$kept = null;

if ($mode === 'deleteFrom') {
    $del = $pdo->prepare(
        'DELETE FROM chat_messages WHERE session_id = :session_id AND id >= :id'
    );
    $del->execute([
        ':session_id' => $sessionId,
        ':id' => $messageId,
    ]);
} else {
    if (($target['role'] ?? '') !== 'user') {
        Response::error('INVALID_BODY', 'keepThrough requires a user message', 400);
    }
    $content = isset($body['content']) && is_string($body['content'])
        ? trim($body['content'])
        : trim((string) $target['content']);
    if ($content === '') {
        Response::error('INVALID_BODY', 'content is required', 400);
    }

    $upd = $pdo->prepare(
        'UPDATE chat_messages SET content = :content WHERE id = :id AND session_id = :session_id'
    );
    $upd->execute([
        ':content' => $content,
        ':id' => $messageId,
        ':session_id' => $sessionId,
    ]);

    $del = $pdo->prepare(
        'DELETE FROM chat_messages WHERE session_id = :session_id AND id > :id'
    );
    $del->execute([
        ':session_id' => $sessionId,
        ':id' => $messageId,
    ]);

    $row = $pdo->prepare(
        'SELECT id, session_id, role, content, created_at FROM chat_messages WHERE id = :id'
    );
    $row->execute([':id' => $messageId]);
    $kept = $row->fetch() ?: null;
}

$touch = $pdo->prepare(
    'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = :id'
);
$touch->execute([':id' => $sessionId]);

if ($kept && is_array($kept)) {
    $titleStmt = $pdo->prepare('SELECT title FROM chat_sessions WHERE id = :id');
    $titleStmt->execute([':id' => $sessionId]);
    $session = $titleStmt->fetch();
    if ($session && ($session['title'] === 'New chat' || $session['title'] === '')) {
        $title = mb_substr(trim((string) $kept['content']), 0, 40);
        $updateTitle = $pdo->prepare('UPDATE chat_sessions SET title = :title WHERE id = :id');
        $updateTitle->execute([
            ':title' => $title,
            ':id' => $sessionId,
        ]);
    }
}

$list = $pdo->prepare(
    'SELECT id, session_id, role, content, created_at
     FROM chat_messages
     WHERE session_id = :session_id
     ORDER BY id ASC'
);
$list->execute([':session_id' => $sessionId]);

Response::ok([
    'messages' => $list->fetchAll(),
    'kept' => $kept,
]);
