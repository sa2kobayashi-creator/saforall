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
            ['id' => 'gpt-4o-mini', 'tier' => 'cheap', 'cost' => 1],
            ['id' => 'gpt-4.1-mini', 'tier' => 'cheap', 'cost' => 2],
            ['id' => 'gpt-4o', 'tier' => 'standard', 'cost' => 3],
            ['id' => 'gpt-4.1', 'tier' => 'standard', 'cost' => 4],
            ['id' => 'o4-mini', 'tier' => 'strong', 'cost' => 5],
            ['id' => 'o3-mini', 'tier' => 'strong', 'cost' => 6],
        ],
        'gemini' => [
            ['id' => 'gemini-2.5-flash-lite', 'tier' => 'cheap', 'cost' => 1],
            ['id' => 'gemini-2.5-flash', 'tier' => 'standard', 'cost' => 2],
            ['id' => 'gemini-3.5-flash', 'tier' => 'standard', 'cost' => 3],
            ['id' => 'gemini-3.1-pro-preview', 'tier' => 'strong', 'cost' => 4],
        ],
        'workers' => [
            ['id' => '@cf/meta/llama-3.1-8b-instruct', 'tier' => 'cheap', 'cost' => 1],
            ['id' => '@cf/qwen/qwen2.5-coder-32b-instruct', 'tier' => 'standard', 'cost' => 2],
            ['id' => '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'tier' => 'strong', 'cost' => 3],
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
        'openai' => ['gpt-4o-mini', 'gpt-4o'],
        'gemini' => ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
        'workers' => [
            '@cf/meta/llama-3.1-8b-instruct',
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
        'gemini-2.0-flash-lite' => 'gemini-2.5-flash-lite',
        'gemini-2.0-flash' => 'gemini-2.5-flash',
        'gemini-1.5-flash' => 'gemini-2.5-flash',
        'gemini-1.5-pro' => 'gemini-3.1-pro-preview',
        'gemini-pro' => 'gemini-2.5-flash',
    ];

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
            static fn (string $id): string => self::RETIRED_MODELS[$id] ?? $id,
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
            $forced = self::RETIRED_MODELS[trim($forcedModel)] ?? trim($forcedModel);
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
            return $enabled[0] ?? 'gpt-4o-mini';
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
