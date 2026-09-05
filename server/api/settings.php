<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

$pdo = Database::connection();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$secretKeys = [
    'llm.api_key',
    'llm.openai.api_key',
    'llm.gemini.api_key',
    'llm.claude.api_key',
    'llm.cursor.api_key',
    'llm.workers.api_token',
    'llm.simple.api_token',
];

if ($method === 'GET') {
    $rows = $pdo->query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key')->fetchAll();
    $settings = [];
    $flags = [
        'llm.api_key_set' => false,
        'llm.openai.api_key_set' => false,
        'llm.gemini.api_key_set' => false,
        'llm.claude.api_key_set' => false,
        'llm.cursor.api_key_set' => false,
        'llm.workers.api_token_set' => false,
        'llm.simple.api_token_set' => false,
    ];

    foreach ($rows as $row) {
        $key = (string) $row['setting_key'];
        $value = $row['setting_value'];
        $isSet = is_string($value) && $value !== '';

        if ($key === 'llm.api_key') {
            $flags['llm.api_key_set'] = $isSet;
            $flags['llm.openai.api_key_set'] = $flags['llm.openai.api_key_set'] || $isSet;
            continue;
        }
        if ($key === 'llm.openai.api_key') {
            $flags['llm.openai.api_key_set'] = $isSet;
            continue;
        }
        if ($key === 'llm.gemini.api_key') {
            $flags['llm.gemini.api_key_set'] = $isSet;
            continue;
        }
        if ($key === 'llm.claude.api_key') {
            $flags['llm.claude.api_key_set'] = $isSet;
            continue;
        }
        if ($key === 'llm.cursor.api_key') {
            $flags['llm.cursor.api_key_set'] = $isSet;
            continue;
        }
        if ($key === 'llm.workers.api_token' || $key === 'llm.simple.api_token') {
            $flags['llm.workers.api_token_set'] = $flags['llm.workers.api_token_set'] || $isSet;
            $flags['llm.simple.api_token_set'] = $flags['llm.simple.api_token_set'] || $isSet;
            continue;
        }

        $settings[$key] = $value;
    }

    foreach ($flags as $flagKey => $flagValue) {
        $settings[$flagKey] = $flagValue;
    }

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
        if (!is_string($key) || $key === '' || str_contains($key, '_set')) {
            continue;
        }
        if (!is_scalar($value) && $value !== null) {
            continue;
        }

        $stringValue = $value === null ? null : (string) $value;
        if (in_array($key, $secretKeys, true) && ($stringValue === null || trim($stringValue) === '')) {
            continue;
        }

        $stmt->execute([
            ':key' => $key,
            ':value' => $stringValue,
        ]);
        $saved[] = $key;
    }

    Response::ok(['updated' => $saved]);
}

Response::error('METHOD_NOT_ALLOWED', 'Use GET or PUT', 405);
