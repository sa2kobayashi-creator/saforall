<?php

declare(strict_types=1);

final class LlmClient
{
    /**
     * @param list<array{role:string,content:string}> $messages
     * @param list<string> $extraHeaders
     */
    public static function chat(
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages,
        array $extraHeaders = []
    ): string {
        $raw = self::request($baseUrl, $apiKey, $model, $messages, $extraHeaders);
        /** @var array<string, mixed>|null $decoded */
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('LLM API の応答が JSON ではありません');
        }

        $content = $decoded['choices'][0]['message']['content'] ?? null;
        if (!is_string($content) || trim($content) === '') {
            throw new RuntimeException('LLM API から本文を取得できませんでした');
        }

        return $content;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     * @param callable(string):void $onDelta
     * @param list<string> $extraHeaders
     */
    public static function chatStream(
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages,
        callable $onDelta,
        array $extraHeaders = []
    ): string {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP curl 拡張が必要です');
        }

        $url = rtrim($baseUrl, '/') . '/chat/completions';
        $payload = json_encode([
            'model' => $model,
            'messages' => $messages,
            'temperature' => 0.2,
            'stream' => true,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

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
        $streamError = null;
        $rawBody = '';

        $headers = array_merge(
            [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
                'Accept: text/event-stream',
            ],
            $extraHeaders
        );

        $options = [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (
                &$buffer,
                &$assistant,
                &$streamError,
                &$rawBody,
                $onDelta
            ): int {
                if ($streamError !== null) {
                    return 0;
                }

                $rawBody .= $chunk;
                $buffer .= $chunk;
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $pos));
                    $buffer = substr($buffer, $pos + 1);
                    if ($line === '' || !str_starts_with($line, 'data:')) {
                        continue;
                    }
                    $data = trim(substr($line, 5));
                    if ($data === '[DONE]') {
                        continue;
                    }
                    /** @var array<string, mixed>|null $json */
                    $json = json_decode($data, true);
                    if (!is_array($json)) {
                        continue;
                    }
                    if (isset($json['error']) && is_array($json['error'])) {
                        $detail = $json['error']['message'] ?? 'stream error';
                        $streamError = is_string($detail) ? $detail : 'stream error';
                        return 0;
                    }
                    $delta = $json['choices'][0]['delta']['content'] ?? null;
                    if (is_string($delta) && $delta !== '') {
                        $assistant .= $delta;
                        $onDelta($delta);
                    }
                }
                return strlen($chunk);
            },
            CURLOPT_HEADERFUNCTION => static function ($ch, string $headerLine) use (&$httpStatus): int {
                if (preg_match('/^HTTP\/\S+\s+(\d+)/', $headerLine, $matches) === 1) {
                    $httpStatus = (int) $matches[1];
                }
                return strlen($headerLine);
            },
        ];

        curl_setopt_array($ch, $options + self::sslOptions());

        $ok = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        curl_close($ch);

        if ($streamError !== null) {
            throw new RuntimeException(
                $streamError . '（model=' . $model . ', endpoint=' . self::endpointHost($url) . '）'
            );
        }

        if ($ok === false || $errno !== 0) {
            throw new RuntimeException('LLM API 通信エラー: ' . ($error !== '' ? $error : 'unknown'));
        }

        if ($httpStatus > 0 && ($httpStatus < 200 || $httpStatus >= 300)) {
            throw new RuntimeException(self::formatHttpError($httpStatus, $model, $url, $rawBody));
        }

        if (trim($assistant) === '') {
            throw new RuntimeException('LLM API から本文を取得できませんでした');
        }

        return $assistant;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     * @param list<string> $extraHeaders
     */
    private static function request(
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages,
        array $extraHeaders = []
    ): string {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP curl 拡張が必要です');
        }

        $url = rtrim($baseUrl, '/') . '/chat/completions';
        $payload = json_encode([
            'model' => $model,
            'messages' => $messages,
            'temperature' => 0.2,
            'stream' => false,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($payload === false) {
            throw new RuntimeException('リクエスト JSON の生成に失敗しました');
        }

        $lastError = null;
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $ch = curl_init($url);
            if ($ch === false) {
                throw new RuntimeException('curl の初期化に失敗しました');
            }

            $headers = array_merge(
                [
                    'Content-Type: application/json',
                    'Authorization: Bearer ' . $apiKey,
                ],
                $extraHeaders
            );

            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 90,
                CURLOPT_CONNECTTIMEOUT => 10,
            ] + self::sslOptions());

            $raw = curl_exec($ch);
            $errno = curl_errno($ch);
            $error = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($raw === false || $errno !== 0) {
                $lastError = new RuntimeException(
                    'LLM API 通信エラー: ' . ($error !== '' ? $error : 'unknown')
                );
                usleep(400_000 * ($attempt + 1));
                continue;
            }

            if ($status === 429 && $attempt < 4) {
                $waitMs = self::retryAfterMs(is_string($raw) ? $raw : '', $attempt);
                usleep($waitMs * 1000);
                continue;
            }

            if ($status < 200 || $status >= 300) {
                throw new RuntimeException(
                    self::formatHttpError($status, $model, $url, is_string($raw) ? $raw : '')
                );
            }

            return $raw;
        }

        throw $lastError ?? new RuntimeException('LLM API リクエストに失敗しました');
    }

    private static function retryAfterMs(string $rawBody, int $attempt): int
    {
        if (preg_match('/try again in\s+(\d+(?:\.\d+)?)\s*ms/i', $rawBody, $m) === 1) {
            return max(400, (int) ceil((float) $m[1]) + 200);
        }
        if (preg_match('/try again in\s+(\d+(?:\.\d+)?)\s*s/i', $rawBody, $m) === 1) {
            return max(400, (int) ceil(((float) $m[1]) * 1000) + 200);
        }
        return min(8000, 700 * ($attempt + 1));
    }

    private static function endpointHost(string $url): string
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return $url;
        }
        $host = (string) ($parts['host'] ?? '');
        $path = (string) ($parts['path'] ?? '');
        return $host . $path;
    }

    private static function formatHttpError(
        int $status,
        string $model,
        string $url,
        string $rawBody
    ): string {
        $message = 'LLM API エラー (HTTP ' . $status . ')';
        $message .= ' model=' . $model;
        $message .= ' endpoint=' . self::endpointHost($url);

        /** @var array<string, mixed>|null $decoded */
        $decoded = json_decode($rawBody, true);
        if (is_array($decoded) && isset($decoded['error']) && is_array($decoded['error'])) {
            $detail = $decoded['error']['message'] ?? null;
            if (is_string($detail) && $detail !== '') {
                $message .= ': ' . $detail;
            }
        }

        if ($status === 404 || $status === 410) {
            $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?? ''));
            if (str_contains($host, 'groq.com')) {
                $message .= '。いま Base URL は Groq です。gpt-* は使えません。'
                    . 'OpenAI を使うなら Base URL を https://api.openai.com/v1 に戻し、OpenAI の API キーを保存してください。'
                    . 'Groq のまま使うなら「最新を取得」で llama などの ID を選んでください。';
            } elseif (str_contains($host, 'cloudflare.com')) {
                $message .= '。Workers AI のモデルが廃止されている可能性があります。'
                    . '例: @cf/meta/llama-3.1-8b-instruct-fp8 に変更するか「最新を取得」してください。';
            } elseif (str_contains($host, 'openai.com')) {
                $message .= '。モデルがこのキーで使えない可能性があります。「最新を取得」で一覧から選んでください。';
            } else {
                $message .= '。Base URL（' . $host . '）とそのホスト向けのモデル ID が一致しているか確認してください。';
            }
        }

        if ($status === 429) {
            $message .= '。API のレート制限です。数秒待って再送するか、Auto で Gemini / Claude を使うと回避しやすいです。';
        }

        return $message;
    }

    /** @return array<int, mixed> */
    private static function sslOptions(): array
    {
        $caPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'certs' . DIRECTORY_SEPARATOR . 'cacert.pem';
        if (!is_file($caPath)) {
            throw new RuntimeException(
                'CA 証明書が見つかりません: server/certs/cacert.pem を配置してください'
            );
        }

        return [
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CAINFO => $caPath,
        ];
    }
}
