<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/ChatService.php';
require_once dirname(__DIR__) . '/src/LlmClient.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('METHOD_NOT_ALLOWED', 'Use POST', 405);
}

$pdo = Database::connection();
$body = Request::jsonBody();

$instruction = isset($body['instruction']) && is_string($body['instruction'])
    ? trim($body['instruction'])
    : '';
$selection = isset($body['selection']) && is_string($body['selection']) ? $body['selection'] : '';
$prefix = isset($body['prefix']) && is_string($body['prefix']) ? $body['prefix'] : '';
$suffix = isset($body['suffix']) && is_string($body['suffix']) ? $body['suffix'] : '';
$language = isset($body['language']) && is_string($body['language']) ? $body['language'] : 'plaintext';
$path = isset($body['path']) && is_string($body['path']) ? $body['path'] : '';

if ($instruction === '') {
    Response::error('INVALID_BODY', 'instruction is required', 400);
}
if (trim($selection) === '') {
    Response::error('INVALID_BODY', 'selection is required', 400);
}

$maxSelection = 12000;
$maxPrefix = 2500;
$maxSuffix = 1500;
if (mb_strlen($selection) > $maxSelection) {
    $selection = mb_substr($selection, 0, $maxSelection);
}
if (mb_strlen($prefix) > $maxPrefix) {
    $prefix = mb_substr($prefix, -$maxPrefix);
}
if (mb_strlen($suffix) > $maxSuffix) {
    $suffix = mb_substr($suffix, 0, $maxSuffix);
}

$settings = AppSettings::load($pdo);
$provider = ChatService::providerConfig($settings, 'openai', 'edit', null);

$system = implode("\n", [
    'You are an inline code editor like Cursor Ctrl+K.',
    'Rewrite ONLY the selected code according to the user instruction.',
    'Return ONLY the replacement code for the selection.',
    'Do not wrap in markdown fences. Do not add explanations.',
    'Preserve indentation style of the selection unless asked otherwise.',
    'Language: ' . $language,
    $path !== '' ? 'File: ' . $path : '',
]);

$user = implode("\n", [
    'INSTRUCTION:',
    $instruction,
    '',
    'PREFIX (context before selection):',
    $prefix !== '' ? $prefix : '(none)',
    '',
    'SELECTION:',
    $selection,
    '',
    'SUFFIX (context after selection):',
    $suffix !== '' ? $suffix : '(none)',
    '',
    'Return the edited selection now:',
]);

try {
    $edited = LlmClient::chat(
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
    Response::error('EDIT_FAILED', $error->getMessage(), 502);
}

$text = trim($edited);
if (str_starts_with($text, '```')) {
    $text = preg_replace('/^```[a-zA-Z0-9_+-]*\n?/', '', $text) ?? $text;
    $text = preg_replace('/\n?```$/', '', $text) ?? $text;
}

if (mb_strlen($text) > 16000) {
    $text = mb_substr($text, 0, 16000);
}

Response::ok([
    'edited' => $text,
    'model' => $provider['model'],
]);
