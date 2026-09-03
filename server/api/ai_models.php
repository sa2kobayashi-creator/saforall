<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/AppSettings.php';
require_once dirname(__DIR__) . '/src/ModelCatalog.php';
require_once dirname(__DIR__) . '/src/ChatService.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('METHOD_NOT_ALLOWED', 'Use GET', 405);
}

$engine = isset($_GET['engine']) ? strtolower(trim((string) $_GET['engine'])) : '';
if (!in_array($engine, ['openai', 'gemini', 'workers', 'cursor'], true)) {
    Response::error('INVALID_ENGINE', 'engine=openai|gemini|workers|cursor を指定してください', 400);
}

$pdo = Database::connection();
$settings = AppSettings::load($pdo);

try {
    $models = match ($engine) {
        'gemini' => fetchGeminiModels($settings),
        'openai' => fetchOpenAiModels($settings),
        'workers' => fetchWorkersModels($settings),
        'cursor' => fetchCursorModels(),
    };
} catch (Throwable $e) {
    Response::error('MODEL_LIST_FAILED', $e->getMessage(), 502);
}

Response::ok([
    'engine' => $engine,
    'models' => $models,
    'fetched_at' => date('c'),
]);

/**
 * @param array<string, mixed> $settings
 * @return list<array{id:string,label:string,tier:string}>
 */
function fetchGeminiModels(array $settings): array
{
    $apiKey = AppSettings::secret($settings, 'llm.gemini.api_key', 'GEMINI_API_KEY');
    if ($apiKey === '') {
        throw new RuntimeException('Gemini API キーが未設定です');
    }

    $raw = httpGetJson(
        'https://generativelanguage.googleapis.com/v1beta/models',
        ['x-goog-api-key: ' . $apiKey]
    );

    $out = [];
    $list = $raw['models'] ?? [];
    if (!is_array($list)) {
        return $out;
    }

    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        $name = isset($row['name']) && is_string($row['name']) ? $row['name'] : '';
        $id = preg_replace('#^models/#', '', $name) ?? '';
        if ($id === '' || !str_starts_with($id, 'gemini')) {
            continue;
        }
        $methods = $row['supportedGenerationMethods'] ?? [];
        if (is_array($methods) && $methods !== [] && !in_array('generateContent', $methods, true)) {
            continue;
        }
        $display = isset($row['displayName']) && is_string($row['displayName'])
            ? $row['displayName']
            : $id;
        $out[] = [
            'id' => $id,
            'label' => $display,
            'tier' => guessTier($id),
        ];
    }

    usort($out, static fn (array $a, array $b): int => strcmp($a['id'], $b['id']));
    return $out;
}

/**
 * @param array<string, mixed> $settings
 * @return list<array{id:string,label:string,tier:string}>
 */
function fetchOpenAiModels(array $settings): array
{
    $apiKey = AppSettings::secret($settings, 'llm.openai.api_key', 'OPENAI_API_KEY');
    if ($apiKey === '') {
        $apiKey = AppSettings::secret($settings, 'llm.api_key', 'SAFORALL_API_KEY');
    }
    if ($apiKey === '') {
        throw new RuntimeException('OpenAI API キーが未設定です');
    }

    $baseUrl = AppSettings::str($settings, 'llm.openai.base_url', '');
    if ($baseUrl === '') {
        $baseUrl = AppSettings::str($settings, 'llm.base_url', 'https://api.openai.com/v1');
    }
    $baseUrl = ChatService::normalizeOpenAiCompatibleBaseUrl($baseUrl);
    $url = rtrim($baseUrl, '/') . '/models';
    $raw = httpGetJson($url, ['Authorization: Bearer ' . $apiKey]);

    $out = [];
    $list = $raw['data'] ?? [];
    if (!is_array($list)) {
        return $out;
    }

    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = isset($row['id']) && is_string($row['id']) ? $row['id'] : '';
        if ($id === '') {
            continue;
        }
        // チャット向けっぽいものに絞る
        if (
            !preg_match('/^(gpt-|o[0-9]|chatgpt-|ft:)/i', $id)
        ) {
            continue;
        }
        $out[] = [
            'id' => $id,
            'label' => $id,
            'tier' => guessTier($id),
        ];
    }

    usort($out, static fn (array $a, array $b): int => strcmp($a['id'], $b['id']));
    return $out;
}

/**
 * @param array<string, mixed> $settings
 * @return list<array{id:string,label:string,tier:string}>
 */
function fetchWorkersModels(array $settings): array
{
    $apiKey = AppSettings::secret($settings, 'llm.workers.api_token', 'CLOUDFLARE_API_TOKEN');
    if ($apiKey === '') {
        $apiKey = AppSettings::secret($settings, 'llm.simple.api_token', 'CF_API_TOKEN');
    }
    $accountId = AppSettings::str($settings, 'llm.workers.account_id');
    if ($accountId === '') {
        $accountId = AppSettings::str($settings, 'llm.simple.account_id');
    }
    if ($apiKey === '' || $accountId === '') {
        throw new RuntimeException('Workers AI の Account ID / API Token が未設定です');
    }

    $url = 'https://api.cloudflare.com/client/v4/accounts/'
        . rawurlencode($accountId)
        . '/ai/models/search';
    $raw = httpGetJson($url, [
        'Authorization: Bearer ' . $apiKey,
        'Content-Type: application/json',
    ]);

    $out = [];
    $list = $raw['result'] ?? [];
    if (!is_array($list)) {
        return $out;
    }

    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = isset($row['name']) && is_string($row['name'])
            ? $row['name']
            : (isset($row['id']) && is_string($row['id']) ? $row['id'] : '');
        if ($id === '' || !str_contains($id, '/')) {
            continue;
        }
        // text generation 系を優先
        $task = isset($row['task']['name']) && is_string($row['task']['name'])
            ? $row['task']['name']
            : '';
        if ($task !== '' && !preg_match('/text|chat|instruct|generation/i', $task)) {
            continue;
        }
        $out[] = [
            'id' => $id,
            'label' => $id,
            'tier' => guessTier($id),
        ];
    }

    usort($out, static fn (array $a, array $b): int => strcmp($a['id'], $b['id']));
    return array_slice($out, 0, 80);
}

/**
 * @return list<array{id:string,label:string,tier:string}>
 */
function fetchCursorModels(): array
{
    // Cursor は公開のモデル一覧 API が無いため、アプリ側カタログを返す
    $catalog = [
        ['id' => 'auto', 'label' => 'Auto（サーバ側選択）', 'tier' => 'cheap'],
        ['id' => 'auto-smart', 'label' => 'Cursor Router auto-smart', 'tier' => 'cheap'],
        ['id' => 'composer-2.5', 'label' => 'Composer 2.5', 'tier' => 'standard'],
        ['id' => 'grok-4.5', 'label' => 'Cursor Grok 4.5', 'tier' => 'standard'],
        ['id' => 'grok-4.6', 'label' => 'Cursor Grok 4.6', 'tier' => 'standard'],
        ['id' => 'claude-4.5-sonnet', 'label' => 'Claude Sonnet 4.5', 'tier' => 'standard'],
        ['id' => 'claude-4.6-sonnet', 'label' => 'Claude Sonnet 4.6', 'tier' => 'standard'],
        ['id' => 'claude-opus-5', 'label' => 'Claude Opus 5', 'tier' => 'strong'],
    ];
    return $catalog;
}

function guessTier(string $id): string
{
    $lower = strtolower($id);
    if (preg_match('/lite|mini|flash-latest|8b|cheap|nano/', $lower) === 1) {
        return 'cheap';
    }
    if (preg_match('/pro|opus|o3|o4|70b|strong/', $lower) === 1) {
        return 'strong';
    }
    return 'standard';
}

/**
 * @param list<string> $headers
 * @return array<string, mixed>
 */
function httpGetJson(string $url, array $headers): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP curl 拡張が必要です');
    }

    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException('curl の初期化に失敗しました');
    }

    $caPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'certs' . DIRECTORY_SEPARATOR . 'cacert.pem';
    if (!is_file($caPath)) {
        throw new RuntimeException('CA 証明書が見つかりません: server/certs/cacert.pem');
    }

    curl_setopt_array($ch, [
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_CAINFO => $caPath,
    ]);

    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $errno !== 0) {
        throw new RuntimeException('モデル一覧の取得に失敗しました: ' . ($error !== '' ? $error : 'unknown'));
    }

    /** @var array<string, mixed>|null $decoded */
    $decoded = json_decode(is_string($raw) ? $raw : '', true);
    if ($status < 200 || $status >= 300) {
        $message = 'モデル一覧 API エラー (HTTP ' . $status . ')';
        if (is_array($decoded)) {
            $detail = $decoded['error']['message']
                ?? $decoded['errors'][0]['message']
                ?? null;
            if (is_string($detail) && $detail !== '') {
                $message .= ': ' . $detail;
            }
        }
        throw new RuntimeException($message);
    }

    if (!is_array($decoded)) {
        throw new RuntimeException('モデル一覧の応答が JSON ではありません');
    }

    return $decoded;
}
