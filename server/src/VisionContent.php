<?php

declare(strict_types=1);

/**
 * Attach chat images to the latest user message for vision-capable providers.
 */
final class VisionContent
{
    public const MAX_IMAGES = 4;

    /**
     * @param mixed $context
     * @return list<array{name:string,mime:string,data_base64:string}>
     */
    public static function parseImages($context): array
    {
        if (!is_array($context)) {
            return [];
        }
        $rows = $context['images'] ?? null;
        if (!is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $mime = isset($row['mime']) && is_string($row['mime'])
                ? strtolower(trim($row['mime']))
                : '';
            if ($mime === 'image/jpg') {
                $mime = 'image/jpeg';
            }
            $data = isset($row['data_base64']) && is_string($row['data_base64'])
                ? trim($row['data_base64'])
                : '';
            if ($mime === '' || !str_starts_with($mime, 'image/') || $data === '') {
                continue;
            }
            $name = isset($row['name']) && is_string($row['name']) && $row['name'] !== ''
                ? $row['name']
                : 'image.png';
            $out[] = [
                'name' => $name,
                'mime' => $mime,
                'data_base64' => $data,
            ];
            if (count($out) >= self::MAX_IMAGES) {
                break;
            }
        }
        return $out;
    }

    /**
     * @param list<array{role:string,content:mixed}> $messages
     * @param list<array{name:string,mime:string,data_base64:string}> $images
     * @return list<array{role:string,content:mixed}>
     */
    public static function attachForOpenAi(array $messages, array $images): array
    {
        if ($images === []) {
            return $messages;
        }
        for ($i = count($messages) - 1; $i >= 0; $i--) {
            if (($messages[$i]['role'] ?? '') !== 'user') {
                continue;
            }
            $text = is_string($messages[$i]['content'] ?? null)
                ? (string) $messages[$i]['content']
                : '';
            if ($text === '') {
                $text = '（画像を確認してください）';
            }
            $parts = [['type' => 'text', 'text' => $text]];
            foreach ($images as $image) {
                $parts[] = [
                    'type' => 'image_url',
                    'image_url' => [
                        'url' => 'data:' . $image['mime'] . ';base64,' . $image['data_base64'],
                    ],
                ];
            }
            $messages[$i]['content'] = $parts;
            break;
        }
        return $messages;
    }

    /**
     * @param list<array{role:string,content:mixed}> $messages
     * @param list<array{name:string,mime:string,data_base64:string}> $images
     * @return list<array{role:string,content:mixed}>
     */
    public static function attachForClaude(array $messages, array $images): array
    {
        if ($images === []) {
            return $messages;
        }
        for ($i = count($messages) - 1; $i >= 0; $i--) {
            if (($messages[$i]['role'] ?? '') !== 'user') {
                continue;
            }
            $text = is_string($messages[$i]['content'] ?? null)
                ? (string) $messages[$i]['content']
                : '';
            if ($text === '') {
                $text = '（画像を確認してください）';
            }
            $parts = [];
            foreach ($images as $image) {
                $parts[] = [
                    'type' => 'image',
                    'source' => [
                        'type' => 'base64',
                        'media_type' => $image['mime'],
                        'data' => $image['data_base64'],
                    ],
                ];
            }
            $parts[] = ['type' => 'text', 'text' => $text];
            $messages[$i]['content'] = $parts;
            break;
        }
        return $messages;
    }

    /**
     * @param list<array{name:string,mime:string,data_base64:string}> $images
     * @return list<array<string, mixed>>
     */
    public static function geminiParts(string $text, array $images): array
    {
        $parts = [['text' => $text !== '' ? $text : '（画像を確認してください）']];
        foreach ($images as $image) {
            $parts[] = [
                'inline_data' => [
                    'mime_type' => $image['mime'],
                    'data' => $image['data_base64'],
                ],
            ];
        }
        return $parts;
    }
}
