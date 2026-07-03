<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';

// Alias /saforall や /saforall/public のどちらでも動くようにプレフィックスを除去
$path = preg_replace('#^/saforall(?:/public)?#', '', $path) ?? $path;
$path = '/' . trim($path, '/');

if ($path === '/' || $path === '/api') {
    Response::ok([
        'service' => 'saforall-api',
        'message' => 'saforall backend is running',
        'endpoints' => [
            'GET /api/health',
        ],
    ]);
}

if ($path === '/api/health' || $path === '/health') {
    require dirname(__DIR__) . '/api/health.php';
}

Response::error('NOT_FOUND', "No route for {$path}", 404);
