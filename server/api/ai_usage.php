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
Response::ok([
    'month' => date('Y-m'),
    'usage' => UsageService::monthSummary($pdo, $settings),
]);
