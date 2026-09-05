<?php

declare(strict_types=1);

/**
 * Anthropic Messages API（Claude）。
 */
final class ClaudeClient
{
    private const DEFAULT_BASE = 'https://api.anthropic.com';
    private const API_VERSION = '2023-06-01';

    /**
     * @param list<array{role:string,content:string}> $messages
     */
    public static function chat(string $apiKey, string $model, array $messages, string $baseUrl = ''): string
    {
        $url = self::endpoint($baseUrl, false);
        $payload = self::buildPayload($model, $messages);
        $raw = self::postJson($url, $apiKey, $payload, false);
        /** @var array<string, mixed>|null $decoded */
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Claude API の応答が JSON ではありません');
        }
        if (isset($decoded['error']) && is_array($decoded['error'])) {
            $msg = isset($decoded['error']['message']) ? (string) $decoded['error']['message'] : 'unknown';
            throw new RuntimeException('Claude API エラー: ' . $msg);
        }
        $text = self::extractText($decoded);
        if ($text === '') {
            throw new RuntimeException('Claude API から本文を取得できませんでした（model=' . $model . '）');
        }
        return $text;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     * @param callable(string):void $onDelta
     */
    public static function chatStream(
        string $apiKey,
        string $model,
        array $messages,
        callable $onDelta,
        string $baseUrl = ''
    ): string {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP curl 拡張が必要です');
        }

        $url = self::endpoint($baseUrl, true);
        $payload = json_encode(
            self::buildPayload($model, $messages, true),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        if ($payload === false) {
            throw new RuntimeException('リクエスト JSON の生成に失敗しました');
        }

        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('curl の初期化に失敗しました');
        }

        $buffer = '';
        $assistant = '';
        $httpStatus = 0;
        $errorBody = '';

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: text/event-stream',
                'x-api-key: ' . $apiKey,
                'anthropic-version: ' . self::API_VERSION,
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => 180,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $header) use (&$httpStatus): int {
                if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $m)) {
                    $httpStatus = (int) $m[1];
                }
                return strlen($header);
            },
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$buffer, &$assistant, $onDelta, &$errorBody, &$httpStatus): int {
                if ($httpStatus >= 400) {
                    $errorBody .= $chunk;
                    return strlen($chunk);
                }
                $buffer .= $chunk;
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $pos));
                    $buffer = substr($buffer, $pos + 1);
                    if ($line === '' || !str_starts_with($line, 'data:')) {
                        continue;
                    }
                    $data = trim(substr($line, 5));
                    if ($data === '' || $data === '[DONE]') {
                        continue;
                    }
                    /** @var array<string, mixed>|null $json */
                    $json = json_decode($data, true);
                    if (!is_array($json)) {
                        continue;
                    }
                    $type = isset($json['type']) ? (string) $json['type'] : '';
                    if ($type === 'content_block_delta') {
                        $delta = $json['delta'] ?? null;
                        if (is_array($delta) && isset($delta['text']) && is_string($delta['text']) && $delta['text'] !== '') {
                            $assistant .= $delta['text'];
                            $onDelta($delta['text']);
                        }
                    }
                }
                return strlen($chunk);
            },
        ]);

        $ok = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        curl_close($ch);

        if ($ok === false || $errno !== 0) {
            throw new RuntimeException('Claude ストリーム失敗: ' . ($err !== '' ? $err : 'curl error'));
        }
        if ($httpStatus >= 400) {
            throw new RuntimeException('Claude API HTTP ' . $httpStatus . ': ' . mb_substr($errorBody, 0, 400));
        }
        if ($assistant === '') {
            throw new RuntimeException('Claude ストリームから本文を取得できませんでした');
        }
        return $assistant;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     * @return array<string, mixed>
     */
    private static function buildPayload(string $model, array $messages, bool $stream = false): array
    {
        $system = '';
        $converted = [];
        foreach ($messages as $row) {
            $role = strtolower((string) ($row['role'] ?? 'user'));
            $content = (string) ($row['content'] ?? '');
            if ($role === 'system') {
                $system .= ($system === '' ? '' : "\n\n") . $content;
                continue;
            }
            if ($role !== 'assistant') {
                $role = 'user';
            }
            $converted[] = [
                'role' => $role,
                'content' => $content,
            ];
        }
        if ($converted === []) {
            $converted[] = ['role' => 'user', 'content' => 'Hello'];
        }

        $payload = [
            'model' => $model,
            'max_tokens' => 4096,
            'messages' => $converted,
        ];
        if ($system !== '') {
            $payload['system'] = $system;
        }
        if ($stream) {
            $payload['stream'] = true;
        }
        return $payload;
    }

    /**
     * @param array<string, mixed> $decoded
     */
    private static function extractText(array $decoded): string
    {
        $content = $decoded['content'] ?? null;
        if (!is_array($content)) {
            return '';
        }
        $parts = [];
        foreach ($content as $block) {
            if (!is_array($block)) {
                continue;
            }
            if (($block['type'] ?? '') === 'text' && isset($block['text']) && is_string($block['text'])) {
                $parts[] = $block['text'];
            }
        }
        return trim(implode("\n", $parts));
    }

    private static function endpoint(string $baseUrl, bool $stream): string
    {
        $base = rtrim($baseUrl !== '' ? $baseUrl : self::DEFAULT_BASE, '/');
        // stream も同じ /v1/messages（body の stream:true）
        return $base . '/v1/messages';
    }

    /**
     * @param array<string, mixed> $payload
     */
    private static function postJson(string $url, string $apiKey, array $payload, bool $stream): string
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP curl 拡張が必要です');
        }
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($body === false) {
            throw new RuntimeException('リクエスト JSON の生成に失敗しました');
        }
        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('curl の初期化に失敗しました');
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-api-key: ' . $apiKey,
                'anthropic-version: ' . self::API_VERSION,
            ],
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new RuntimeException('Claude リクエスト失敗: ' . $err);
        }
        if ($status >= 400) {
            throw new RuntimeException('Claude API HTTP ' . $status . ': ' . mb_substr((string) $raw, 0, 400));
        }
        return (string) $raw;
    }
}
