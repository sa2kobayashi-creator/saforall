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
$month = isset($_GET['month']) ? (string) $_GET['month'] : null;
$detail = UsageService::monthDetail($pdo, $settings, $month);

Response::ok([
    'month' => $detail['month'],
    'router_month' => $detail['router_month'] ?? $detail['month'],
    'total' => $detail['total'],
    'user' => $detail['user'],
    'usage' => $detail['usage'],
    'models' => $detail['models'],
    'router' => $detail['router'],
    'claude_prepaid' => AppSettings::claudePrepaidStatus($settings),
    'note' => '金額は概算です。Claude の Anthropic 残高は手入力のチャージ残です（公式の残高APIがないため）。各プロバイダの実請求とは一致しない場合があります。',
]);
