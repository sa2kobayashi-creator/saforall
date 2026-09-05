<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/UsageService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('METHOD_NOT_ALLOWED', 'Use GET', 405);
}

$pdo = Database::connection();
$settings = AppSettings::load($pdo);
$detail = UsageService::monthDetail($pdo, $settings);

Response::ok([
    'month' => $detail['month'],
    'total' => $detail['total'],
    'user' => $detail['user'],
    'usage' => $detail['usage'],
    'models' => $detail['models'],
    'router' => $detail['router'],
    'note' => '金額は概算です。各プロバイダの実請求とは一致しない場合があります。Router ログは振り分け調整用です。',
]);
