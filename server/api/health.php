<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

try {
    $pdo = Database::connection();
    $pdo->query('SELECT 1');

    Response::ok([
        'service' => 'saforall-api',
        'status' => 'ok',
        'database' => 'connected',
        'time' => date('c'),
    ]);
} catch (Throwable $e) {
    Response::error('DB_CONNECTION_FAILED', $e->getMessage(), 503);
}
