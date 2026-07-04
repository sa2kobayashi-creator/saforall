<?php

declare(strict_types=1);

final class LlmClient
{
    /**
     * @param list<array{role:string,content:string}> $messages
     */
    public static function chat(string $baseUrl, string $apiKey, string $model, array $messages): string
    {
        $raw = self::request($baseUrl, $apiKey, $model, $messages);
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
     */
    public static function chatStream(
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages,
        callable $onDelta
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

        $options = [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
                'Accept: text/event-stream',
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (
                &$buffer,
                &$assistant,
                &$streamError,
                $onDelta
            ): int {
                if ($streamError !== null) {
                    return 0;
                }

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
            throw new RuntimeException($streamError);
        }

        if ($ok === false || $errno !== 0) {
            throw new RuntimeException('LLM API 通信エラー: ' . ($error !== '' ? $error : 'unknown'));
        }

        if ($httpStatus > 0 && ($httpStatus < 200 || $httpStatus >= 300)) {
            throw new RuntimeException('LLM API エラー (HTTP ' . $httpStatus . ')');
        }

        if (trim($assistant) === '') {
            throw new RuntimeException('LLM API から本文を取得できませんでした');
        }

        return $assistant;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     */
    private static function request(
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages
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

        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('curl の初期化に失敗しました');
        }

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
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
            throw new RuntimeException('LLM API 通信エラー: ' . ($error !== '' ? $error : 'unknown'));
        }

        if ($status < 200 || $status >= 300) {
            /** @var array<string, mixed>|null $decoded */
            $decoded = json_decode($raw, true);
            $message = 'LLM API エラー (HTTP ' . $status . ')';
            if (is_array($decoded) && isset($decoded['error']) && is_array($decoded['error'])) {
                $detail = $decoded['error']['message'] ?? null;
                if (is_string($detail) && $detail !== '') {
                    $message .= ': ' . $detail;
                }
            }
            throw new RuntimeException($message);
        }

        return $raw;
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
