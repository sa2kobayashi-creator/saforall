<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $limit = isset($_GET['limit']) ? max(1, min(50, (int) $_GET['limit'])) : 20;
    $stmt = $pdo->prepare(
        'SELECT id, path, display_name, last_opened_at, created_at
         FROM workspaces
         ORDER BY last_opened_at DESC
         LIMIT :limit'
    );
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();

    Response::ok(['workspaces' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $body = Request::jsonBody();
    $path = isset($body['path']) && is_string($body['path']) ? trim($body['path']) : '';
    if ($path === '') {
        Response::error('INVALID_BODY', 'path is required', 400);
    }

    $displayName = null;
    if (isset($body['display_name']) && is_string($body['display_name'])) {
        $displayName = trim($body['display_name']);
    }
    if ($displayName === null || $displayName === '') {
        $parts = preg_split('/[\\\\\\/]/', $path) ?: [];
        $displayName = $parts === [] ? $path : (string) end($parts);
    }

    $find = $pdo->prepare('SELECT id FROM workspaces WHERE path = :path LIMIT 1');
    $find->execute([':path' => $path]);
    $existing = $find->fetch();

    if ($existing) {
        $update = $pdo->prepare(
            'UPDATE workspaces
             SET display_name = :display_name, last_opened_at = CURRENT_TIMESTAMP
             WHERE id = :id'
        );
        $update->execute([
            ':display_name' => $displayName,
            ':id' => $existing['id'],
        ]);
        $id = (int) $existing['id'];
    } else {
        $insert = $pdo->prepare(
            'INSERT INTO workspaces (path, display_name) VALUES (:path, :display_name)'
        );
        $insert->execute([
            ':path' => $path,
            ':display_name' => $displayName,
        ]);
        $id = (int) $pdo->lastInsertId();
    }

    $row = $pdo->prepare(
        'SELECT id, path, display_name, last_opened_at, created_at FROM workspaces WHERE id = :id'
    );
    $row->execute([':id' => $id]);

    Response::ok(['workspace' => $row->fetch()], $existing ? 200 : 201);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET or POST', 405);
