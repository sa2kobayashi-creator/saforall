<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $rows = $pdo->query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key')->fetchAll();
    $settings = [];
    $apiKeySet = false;

    foreach ($rows as $row) {
        $key = (string) $row['setting_key'];
        $value = $row['setting_value'];

        if ($key === 'llm.api_key') {
            $apiKeySet = is_string($value) && $value !== '';
            continue;
        }

        $settings[$key] = $value;
    }

    $settings['llm.api_key_set'] = $apiKeySet;
    Response::ok(['settings' => $settings]);
}

if ($method === 'PUT') {
    $body = Request::jsonBody();
    $incoming = $body['settings'] ?? null;

    if (!is_array($incoming) || $incoming === []) {
        Response::error('INVALID_BODY', 'settings object is required', 400);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:key, :value)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    );

    $saved = [];
    foreach ($incoming as $key => $value) {
        if (!is_string($key) || $key === '' || str_contains($key, 'api_key_set')) {
            continue;
        }
        if (!is_scalar($value) && $value !== null) {
            continue;
        }

        $stringValue = $value === null ? null : (string) $value;
        $stmt->execute([
            ':key' => $key,
            ':value' => $stringValue,
        ]);
        $saved[] = $key;
    }

    Response::ok(['updated' => $saved]);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET or PUT', 405);
