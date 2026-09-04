<?php

declare(strict_types=1);

/**
 * エンジン内モデルの複数候補と、作業種別による自動選択。
 */
final class ModelCatalog
{
    /** @var array<string, list<array{id:string,tier:string,cost:int}>> */
    private const CATALOG = [
        'openai' => [
            ['id' => 'gpt-4.1-mini', 'tier' => 'cheap', 'cost' => 1],
            ['id' => 'gpt-5.4-mini', 'tier' => 'cheap', 'cost' => 2],
            ['id' => 'gpt-4o-mini', 'tier' => 'cheap', 'cost' => 3],
            ['id' => 'gpt-4.1', 'tier' => 'standard', 'cost' => 4],
            ['id' => 'gpt-4o', 'tier' => 'standard', 'cost' => 5],
            ['id' => 'gpt-5.4', 'tier' => 'standard', 'cost' => 6],
            ['id' => 'o4-mini', 'tier' => 'strong', 'cost' => 7],
            ['id' => 'o3-mini', 'tier' => 'strong', 'cost' => 8],
        ],
        'gemini' => [
            ['id' => 'gemini-flash-latest', 'tier' => 'cheap', 'cost' => 1],
            ['id' => 'gemini-3.5-flash-lite', 'tier' => 'cheap', 'cost' => 2],
            ['id' => 'gemini-2.5-flash', 'tier' => 'standard', 'cost' => 3],
            ['id' => 'gemini-2.5-pro', 'tier' => 'strong', 'cost' => 4],
        ],
        'workers' => [
            ['id' => '@cf/meta/llama-3.1-8b-instruct-fp8', 'tier' => 'cheap', 'cost' => 1],
            ['id' => '@cf/meta/llama-3.1-8b-instruct-fast', 'tier' => 'cheap', 'cost' => 2],
            ['id' => '@cf/qwen/qwen2.5-coder-32b-instruct', 'tier' => 'standard', 'cost' => 3],
            ['id' => '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'tier' => 'strong', 'cost' => 4],
        ],
        'cursor' => [
            ['id' => 'auto', 'tier' => 'cheap', 'cost' => 1],
            ['id' => 'auto-smart', 'tier' => 'cheap', 'cost' => 2],
            ['id' => 'composer-2.5', 'tier' => 'standard', 'cost' => 3],
            ['id' => 'grok-4.5', 'tier' => 'standard', 'cost' => 4],
            ['id' => 'grok-4.6', 'tier' => 'standard', 'cost' => 5],
            ['id' => 'claude-4.5-sonnet', 'tier' => 'standard', 'cost' => 6],
            ['id' => 'claude-4.6-sonnet', 'tier' => 'standard', 'cost' => 7],
            ['id' => 'claude-opus-5', 'tier' => 'strong', 'cost' => 8],
        ],
    ];

    /** @var array<string, list<string>> */
    private const DEFAULT_ENABLED = [
        'openai' => ['gpt-4.1-mini', 'gpt-4.1'],
        'gemini' => ['gemini-flash-latest', 'gemini-2.5-flash'],
        'workers' => [
            '@cf/meta/llama-3.1-8b-instruct-fp8',
            '@cf/qwen/qwen2.5-coder-32b-instruct',
        ],
        'cursor' => [
            'auto',
            'grok-4.6',
            'grok-4.5',
            'claude-4.6-sonnet',
            'claude-4.5-sonnet',
            'claude-opus-5',
            'composer-2.5',
        ],
    ];

    /** 廃止モデル → 現行モデル */
    private const RETIRED_MODELS = [
        'gpt-4o-mini' => 'gpt-4.1-mini',
        'gpt-4o' => 'gpt-4.1',
        'gpt-3.5-turbo' => 'gpt-4.1-mini',
        'gpt-4-turbo' => 'gpt-4.1',
        'gemini-2.0-flash-lite' => 'gemini-3.5-flash-lite',
        'gemini-2.0-flash' => 'gemini-flash-latest',
        'gemini-1.5-flash' => 'gemini-flash-latest',
        'gemini-1.5-pro' => 'gemini-2.5-pro',
        'gemini-pro' => 'gemini-flash-latest',
        'gemini-2.5-flash-lite' => 'gemini-3.5-flash-lite',
        'gemini-3-flash' => 'gemini-flash-latest',
        'gemini-3-flash-preview' => 'gemini-flash-latest',
        // 画像生成モデルはチャット不可 → テキスト用へ
        'gemini-2.5-flash-image' => 'gemini-flash-latest',
        'gemini-2.5-flash-preview-image' => 'gemini-flash-latest',
        'gemini-2.0-flash-preview-image-generation' => 'gemini-flash-latest',
        'gemini-2.0-flash-exp-image-generation' => 'gemini-flash-latest',
        '@cf/meta/llama-3.1-8b-instruct' => '@cf/meta/llama-3.1-8b-instruct-fp8',
        '@cf/meta/llama-3.1-8b-instruct-awq' => '@cf/meta/llama-3.1-8b-instruct-fp8',
        '@cf/meta/llama-3-8b-instruct' => '@cf/meta/llama-3.1-8b-instruct-fp8',
        '@cf/meta/llama-3-8b-instruct-awq' => '@cf/meta/llama-3.1-8b-instruct-fp8',
        '@cf/meta/llama-3.1-70b-instruct' => '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        '@hf/meta-llama/meta-llama-3-8b-instruct' => '@cf/meta/llama-3.1-8b-instruct-fp8',
    ];

    /**
     * チャット向けにモデル ID を正規化する（画像・埋め込み等は除外）。
     */
    public static function normalizeModelId(string $engine, string $id): string
    {
        $id = trim($id);
        if ($id === '') {
            return $engine === 'gemini' ? 'gemini-flash-latest' : $id;
        }

        if (isset(self::RETIRED_MODELS[$id])) {
            return self::RETIRED_MODELS[$id];
        }

        if ($engine === 'gemini' && self::isNonChatGeminiModel($id)) {
            return 'gemini-flash-latest';
        }

        return $id;
    }

    public static function isNonChatGeminiModel(string $id): bool
    {
        $lower = strtolower($id);
        return preg_match(
            '/image|imagen|embedding|embed-content|tts|audio|lyria|robotics|aqa|computer-use/',
            $lower
        ) === 1;
    }

    /**
     * @param array<string, mixed> $settings
     * @return list<string>
     */
    public static function enabledModels(array $settings, string $engine): array
    {
        $key = 'llm.' . $engine . '.models';
        $raw = AppSettings::str($settings, $key);
        if ($raw === '' && $engine === 'workers') {
            $raw = AppSettings::str($settings, 'llm.simple.models');
        }

        $defaults = self::DEFAULT_ENABLED[$engine] ?? [];
        $list = self::parseList($raw, $defaults);

        // 単一 model 設定があれば候補に含める
        $singleKey = 'llm.' . $engine . '.model';
        $single = AppSettings::str($settings, $singleKey);
        if ($single === '' && $engine === 'openai') {
            $single = AppSettings::str($settings, 'llm.model');
        }
        if ($single === '' && $engine === 'workers') {
            $single = AppSettings::str($settings, 'llm.simple.model');
        }
        if ($single !== '' && !in_array($single, $list, true)) {
            array_unshift($list, $single);
        }

        return array_values(array_unique(array_map(
            static fn (string $id): string => self::normalizeModelId($engine, $id),
            $list
        )));
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function pick(array $settings, string $engine, string $taskType, ?string $forcedModel = null): string
    {
        $enabled = self::enabledModels($settings, $engine);
        if ($forcedModel !== null && trim($forcedModel) !== '') {
            $forced = self::normalizeModelId($engine, trim($forcedModel));
            if (in_array($forced, $enabled, true) || $forced === 'auto') {
                return $forced;
            }
            // 固定エンジンで明示指定された場合は許可
            return $forced;
        }

        $catalog = self::CATALOG[$engine] ?? [];
        $pool = [];
        foreach ($catalog as $row) {
            if (in_array($row['id'], $enabled, true)) {
                $pool[] = $row;
            }
        }
        if ($pool === []) {
            $pool = $catalog;
        }
        if ($pool === []) {
            return $enabled[0] ?? 'gpt-4.1-mini';
        }

        usort($pool, static fn (array $a, array $b): int => $a['cost'] <=> $b['cost']);

        $tiers = self::tiersForTask($taskType);
        foreach ($tiers as $tier) {
            foreach ($pool as $row) {
                if ($row['tier'] === $tier) {
                    return $row['id'];
                }
            }
        }

        return $pool[0]['id'];
    }

    /**
     * @return list<string>
     */
    private static function tiersForTask(string $taskType): array
    {
        return match ($taskType) {
            'design', 'long_dev', 'test_fix' => ['strong', 'standard', 'cheap'],
            'explain', 'codegen', 'patch_multi', 'repo_analysis', 'patch_small' => ['standard', 'cheap', 'strong'],
            default => ['cheap', 'standard', 'strong'],
        };
    }

    /**
     * @param list<string> $fallback
     * @return list<string>
     */
    private static function parseList(string $raw, array $fallback): array
    {
        if ($raw === '') {
            return $fallback;
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $list = [];
            foreach ($decoded as $item) {
                if (is_string($item) && trim($item) !== '') {
                    $list[] = trim($item);
                }
            }
            return $list !== [] ? array_values(array_unique($list)) : $fallback;
        }

        $parts = preg_split('/[,\n]+/', $raw) ?: [];
        $list = [];
        foreach ($parts as $part) {
            $trimmed = trim((string) $part);
            if ($trimmed !== '') {
                $list[] = $trimmed;
            }
        }
        return $list !== [] ? array_values(array_unique($list)) : $fallback;
    }
}
