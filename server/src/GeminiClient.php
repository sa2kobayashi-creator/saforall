<?php

declare(strict_types=1);

/**
 * Gemini 公式 Generative Language API（OpenAI 互換ではなく generateContent）。
 */
final class GeminiClient
{
    private const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

    /**
     * @param list<array{role:string,content:string}> $messages
     */
    public static function chat(string $apiKey, string $model, array $messages): string
    {
        $url = self::endpoint($model, false);
        $payload = self::buildPayload($messages);
        $raw = self::postJson($url, $apiKey, $payload, false, $model);
        /** @var array<string, mixed>|null $decoded */
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Gemini API の応答が JSON ではありません');
        }
        if (isset($decoded['error']) && is_array($decoded['error'])) {
            throw new RuntimeException(self::formatApiError($decoded['error'], $model));
        }

        $text = self::extractText($decoded);
        if ($text === '') {
            throw new RuntimeException('Gemini API から本文を取得できませんでした（model=' . $model . '）');
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
        callable $onDelta
    ): string {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP curl 拡張が必要です');
        }

        $url = self::endpoint($model, true);
        $payload = json_encode(
            self::buildPayload($messages),
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
        $streamError = null;
        $errorBody = '';

        $options = [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: text/event-stream',
                'x-goog-api-key: ' . $apiKey,
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (
                &$buffer,
                &$assistant,
                &$streamError,
                &$errorBody,
                $onDelta
            ): int {
                if ($streamError !== null) {
                    return 0;
                }

                $errorBody .= $chunk;
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
                    if (isset($json['error']) && is_array($json['error'])) {
                        $streamError = self::formatApiError($json['error'], '');
                        return 0;
                    }
                    $delta = self::extractText($json);
                    if ($delta !== '') {
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
            throw new RuntimeException($streamError . '（model=' . $model . '）');
        }

        if ($ok === false || $errno !== 0) {
            throw new RuntimeException('Gemini API 通信エラー: ' . ($error !== '' ? $error : 'unknown'));
        }

        if ($httpStatus > 0 && ($httpStatus < 200 || $httpStatus >= 300)) {
            $detail = self::detailFromBody($errorBody);
            throw new RuntimeException(self::httpError($httpStatus, $model, $detail));
        }

        if (trim($assistant) === '') {
            // 一部環境では SSE ではなく JSON 配列が返る
            $fallback = self::extractTextFromRaw($errorBody);
            if ($fallback !== '') {
                $onDelta($fallback);
                return $fallback;
            }
            throw new RuntimeException('Gemini API から本文を取得できませんでした（model=' . $model . '）');
        }

        return $assistant;
    }

    private static function endpoint(string $model, bool $stream): string
    {
        $model = trim($model);
        if ($model === '') {
            $model = 'gemini-flash-latest';
        }
        $action = $stream ? 'streamGenerateContent' : 'generateContent';
        $url = self::DEFAULT_BASE . '/models/' . rawurlencode($model) . ':' . $action;
        if ($stream) {
            $url .= '?alt=sse';
        }
        return $url;
    }

    /**
     * @param list<array{role:string,content:string}> $messages
     * @return array<string, mixed>
     */
    private static function buildPayload(array $messages): array
    {
        $systemParts = [];
        $contents = [];

        foreach ($messages as $message) {
            $role = $message['role'] ?? 'user';
            $content = trim((string) ($message['content'] ?? ''));
            if ($content === '') {
                continue;
            }
            if ($role === 'system') {
                $systemParts[] = ['text' => $content];
                continue;
            }
            $geminiRole = $role === 'assistant' ? 'model' : 'user';
            // Gemini は同一 role の連続を嫌うことがあるので結合
            $last = $contents[count($contents) - 1] ?? null;
            if (is_array($last) && ($last['role'] ?? '') === $geminiRole) {
                $prev = (string) ($last['parts'][0]['text'] ?? '');
                $contents[count($contents) - 1]['parts'][0]['text'] = $prev . "\n\n" . $content;
                continue;
            }
            $contents[] = [
                'role' => $geminiRole,
                'parts' => [['text' => $content]],
            ];
        }

        if ($contents === []) {
            $contents[] = [
                'role' => 'user',
                'parts' => [['text' => 'Hello']],
            ];
        }

        $payload = [
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.2,
            ],
        ];
        if ($systemParts !== []) {
            $payload['systemInstruction'] = [
                'parts' => $systemParts,
            ];
        }
        return $payload;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private static function postJson(
        string $url,
        string $apiKey,
        array $payload,
        bool $stream,
        string $model
    ): string {
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
                'x-goog-api-key: ' . $apiKey,
            ],
            CURLOPT_POSTFIELDS => $body,
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
            throw new RuntimeException('Gemini API 通信エラー: ' . ($error !== '' ? $error : 'unknown'));
        }

        if ($status < 200 || $status >= 300) {
            $detail = self::detailFromBody(is_string($raw) ? $raw : '');
            throw new RuntimeException(self::httpError($status, $model, $detail));
        }

        return is_string($raw) ? $raw : '';
    }

    /** @param array<string, mixed> $decoded */
    private static function extractText(array $decoded): string
    {
        $parts = $decoded['candidates'][0]['content']['parts'] ?? null;
        if (!is_array($parts)) {
            return '';
        }
        $text = '';
        foreach ($parts as $part) {
            if (is_array($part) && isset($part['text']) && is_string($part['text'])) {
                $text .= $part['text'];
            }
        }
        return $text;
    }

    private static function extractTextFromRaw(string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return '';
        }
        /** @var mixed $decoded */
        $decoded = json_decode($trimmed, true);
        if (is_array($decoded)) {
            // 配列応答（非 SSE）
            if (array_is_list($decoded)) {
                $out = '';
                foreach ($decoded as $row) {
                    if (is_array($row)) {
                        $out .= self::extractText($row);
                    }
                }
                return $out;
            }
            return self::extractText($decoded);
        }
        return '';
    }

    /** @param array<string, mixed> $error */
    private static function formatApiError(array $error, string $model): string
    {
        $message = isset($error['message']) && is_string($error['message'])
            ? $error['message']
            : 'Gemini API error';
        $status = isset($error['status']) && is_string($error['status'])
            ? $error['status']
            : '';
        $suffix = $model !== '' ? '（model=' . $model . '）' : '';
        return trim('Gemini API エラー' . ($status !== '' ? " [{$status}]" : '') . ': ' . $message . $suffix);
    }

    private static function detailFromBody(string $raw): string
    {
        /** @var array<string, mixed>|null $decoded */
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return '';
        }
        if (isset($decoded['error']) && is_array($decoded['error'])) {
            $msg = $decoded['error']['message'] ?? null;
            return is_string($msg) ? $msg : '';
        }
        return '';
    }

    private static function httpError(int $status, string $model, string $detail): string
    {
        $message = 'Gemini API エラー (HTTP ' . $status . ')';
        if ($model !== '') {
            $message .= ' model=' . $model;
        }
        if ($detail !== '') {
            $message .= ': ' . $detail;
        }
        if ($status === 410 || $status === 403 || $status === 404) {
            $message .= '。API キーを Google AI Studio で再発行するか、Cloud Console で Gemini API に制限し、モデルを gemini-flash-latest / gemini-3.5-flash-lite / gemini-2.5-flash に変更してください。';
        }
        if ($status === 429) {
            $message .= '。無料枠の上限かレート制限です。約40秒待つか、課金プランを確認し、チャット用モデル（gemini-flash-latest / gemini-3.5-flash-lite / gemini-2.5-flash）を選んでください。画像モデル（*-image）は使えません。別エンジン（OpenAI / Workers / Cursor）への切替も有効です。';
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
