<?php

declare(strict_types=1);

/**
 * OpenAI Images API helper for Auto「画像生成」レーン.
 */
final class ImageGenerateClient
{
    /**
     * @return array{content:string, model:string}
     */
    public static function generate(string $apiKey, string $prompt, string $baseUrl = 'https://api.openai.com/v1'): array
    {
        $prompt = trim(preg_replace('/\s+/u', ' ', $prompt) ?? '');
        if ($prompt === '') {
            throw new RuntimeException('画像生成のプロンプトが空です');
        }
        if (mb_strlen($prompt) > 900) {
            $prompt = mb_substr($prompt, 0, 900);
        }

        $base = rtrim($baseUrl !== '' ? $baseUrl : 'https://api.openai.com/v1', '/');
        $model = 'gpt-image-1';
        $payload = json_encode([
            'model' => $model,
            'prompt' => $prompt,
            'size' => '1024x1024',
            'n' => 1,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init($base . '/images/generations');
        if ($ch === false) {
            throw new RuntimeException('画像生成リクエストを開始できません');
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException('画像生成に失敗しました: ' . $err);
        }
        $decoded = json_decode($raw, true);
        if ($status < 200 || $status >= 300) {
            $detail = is_array($decoded) && isset($decoded['error']['message'])
                ? (string) $decoded['error']['message']
                : mb_substr((string) $raw, 0, 400);
            throw new RuntimeException('画像生成に失敗しました: ' . $detail);
        }

        $b64 = '';
        $revised = '';
        if (is_array($decoded) && isset($decoded['data'][0]) && is_array($decoded['data'][0])) {
            $row = $decoded['data'][0];
            if (isset($row['revised_prompt']) && is_string($row['revised_prompt'])) {
                $revised = $row['revised_prompt'];
            }
            if (isset($row['b64_json']) && is_string($row['b64_json'])) {
                $b64 = $row['b64_json'];
            } elseif (isset($row['url']) && is_string($row['url'])) {
                $img = file_get_contents($row['url']);
                if ($img === false) {
                    throw new RuntimeException('生成画像 URL の取得に失敗しました');
                }
                $b64 = base64_encode($img);
            }
        }
        if ($b64 === '') {
            throw new RuntimeException('画像データが空でした');
        }

        $lines = [
            '画像を生成しました。',
            $revised !== '' ? ('調整プロンプト: ' . $revised) : ('プロンプト: ' . $prompt),
            '![generated](data:image/png;base64,' . $b64 . ')',
        ];
        return [
            'content' => implode("\n\n", $lines),
            'model' => $model,
        ];
    }
}
