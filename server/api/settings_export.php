<?php

declare(strict_types=1);

/**
 * Electron Main 専用: 設定（秘密キー含む）をローカル退避用に返す。
 * X-Saforall-Client: electron-main が必須。レンダラからは呼ばないこと。
 */

require_once dirname(__DIR__) . '/src/bootstrap.php';

$client = $_SERVER['HTTP_X_SAFORALL_CLIENT'] ?? '';
if ($client !== 'electron-main') {
    Response::error('FORBIDDEN', 'electron-main client required', 403);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('METHOD_NOT_ALLOWED', 'GET only', 405);
}

$pdo = Database::connection();
$rows = $pdo->query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key')->fetchAll();
$settings = [];
foreach ($rows as $row) {
    $key = (string) $row['setting_key'];
    $value = $row['setting_value'];
    if (is_string($value)) {
        $settings[$key] = $value;
    }
}

Response::ok(['settings' => $settings]);
