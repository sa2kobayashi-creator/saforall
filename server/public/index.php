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
            'GET|PUT /api/settings',
            'GET|POST /api/workspaces',
            'GET|POST /api/chat/sessions',
            'GET|POST /api/chat/sessions/{id}/messages',
            'POST /api/ai/chat',
            'POST /api/ai/chat/stream',
        ],
    ]);
}

if ($path === '/api/health' || $path === '/health') {
    require dirname(__DIR__) . '/api/health.php';
}

if ($path === '/api/settings') {
    require dirname(__DIR__) . '/api/settings.php';
}

if ($path === '/api/workspaces') {
    require dirname(__DIR__) . '/api/workspaces.php';
}

if ($path === '/api/chat/sessions') {
    require dirname(__DIR__) . '/api/chat_sessions.php';
}

if (preg_match('#^/api/chat/sessions/(\d+)/messages$#', $path, $matches) === 1) {
    $sessionId = (int) $matches[1];
    require dirname(__DIR__) . '/api/chat_messages.php';
}

if ($path === '/api/ai/chat/stream') {
    require dirname(__DIR__) . '/api/ai_chat_stream.php';
}

if ($path === '/api/ai/chat') {
    require dirname(__DIR__) . '/api/ai_chat.php';
}

Response::error('NOT_FOUND', "No route for {$path}", 404);
