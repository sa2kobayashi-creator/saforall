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
    // Apache/PHP is reachable; MySQL (or DB config) is the problem.
    Response::ok([
        'service' => 'saforall-api',
        'status' => 'degraded',
        'database' => 'disconnected',
        'time' => date('c'),
        'hint' => 'XAMPP Control Panel で MySQL を Start してください',
        'detail' => $e->getMessage(),
    ]);
}
