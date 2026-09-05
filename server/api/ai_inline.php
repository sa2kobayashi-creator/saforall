<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/AiRouter.php';
require_once dirname(__DIR__) . '/src/ChatService.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();
$prefix = isset($body['prefix']) && is_string($body['prefix']) ? $body['prefix'] : '';
$suffix = isset($body['suffix']) && is_string($body['suffix']) ? $body['suffix'] : '';
$language = isset($body['language']) && is_string($body['language']) ? $body['language'] : 'plaintext';
$path = isset($body['path']) && is_string($body['path']) ? $body['path'] : '';

if (trim($prefix) === '' && trim($suffix) === '') {
    Response::error('INVALID_BODY', 'prefix or suffix is required', 400);
}

// Keep prompt small for latency
$maxPrefix = 3500;
$maxSuffix = 1200;
if (mb_strlen($prefix) > $maxPrefix) {
    $prefix = mb_substr($prefix, -$maxPrefix);
}
if (mb_strlen($suffix) > $maxSuffix) {
    $suffix = mb_substr($suffix, 0, $maxSuffix);
}

$settings = AppSettings::load($pdo);
$provider = ChatService::providerConfig($settings, 'openai', 'explain', null);
$nearby = isset($body['nearby']) && is_string($body['nearby']) ? trim($body['nearby']) : '';
if (mb_strlen($nearby) > 600) {
    $nearby = mb_substr($nearby, 0, 600);
}

$system = implode("\n", [
    'You are a code completion engine like Cursor Tab.',
    'Return ONLY the text that should be inserted at the cursor.',
    'Do not repeat the prefix. Do not wrap in markdown fences.',
    'Prefer a short continuation (1-12 lines). Stop early when a statement/block completes.',
    'Match indentation and style of the surrounding code.',
    'Language: ' . $language,
    $path !== '' ? 'File: ' . $path : '',
]);

$userParts = [
    "PREFIX:\n{$prefix}",
    "SUFFIX:\n{$suffix}",
];
if ($nearby !== '') {
    $userParts[] = "NEARBY SYMBOLS:\n{$nearby}";
}
$userParts[] = 'Insert completion now:';
$user = implode("\n\n", $userParts);

try {
    $completion = LlmClient::chat(
        $provider['base_url'],
        $provider['api_key'],
        $provider['model'],
        [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $user],
        ],
        $provider['extra_headers']
    );
} catch (Throwable $error) {
    Response::error('INLINE_FAILED', $error->getMessage(), 502);
}

$text = trim($completion);
// Strip accidental fences
if (str_starts_with($text, '```')) {
    $text = preg_replace('/^```[a-zA-Z0-9_+-]*\n?/', '', $text) ?? $text;
    $text = preg_replace('/\n?```$/', '', $text) ?? $text;
}

// Hard cap
if (mb_strlen($text) > 1200) {
    $text = mb_substr($text, 0, 1200);
}

Response::ok([
    'completion' => $text,
    'model' => $provider['model'],
]);
