<?php

declare(strict_types=1);

/**
 * Auto（おすすめ）の振り分けポリシー。
 * 設定キー router.profile / router.auto_policy から読み取る。
 */
final class RouterPolicy
{
    public const PROFILES = ['balanced', 'cheapest', 'quality'];

    /**
     * @return array{
     *   profile:string,
     *   ask_avoid_cursor:bool,
     *   cursor_requires_agent:bool,
     *   cursor_strong_signals_only:bool,
     *   prefer_cheap_models:bool,
     *   gemini_for_mid_tasks:bool,
     *   workers_max_chars:int,
     *   fix_words_to_cursor:bool
     * }
     */
    public static function load(array $settings): array
    {
        $profile = AppSettings::str($settings, 'router.profile', 'balanced');
        if (!in_array($profile, self::PROFILES, true)) {
            $profile = 'balanced';
        }

        $base = self::preset($profile);

        $raw = AppSettings::str($settings, 'router.auto_policy');
        if ($raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $base = self::merge($base, $decoded);
            }
        }

        $base['profile'] = $profile;
        return $base;
    }

    /**
     * @return array{
     *   profile:string,
     *   ask_avoid_cursor:bool,
     *   cursor_requires_agent:bool,
     *   cursor_strong_signals_only:bool,
     *   prefer_cheap_models:bool,
     *   gemini_for_mid_tasks:bool,
     *   workers_max_chars:int,
     *   fix_words_to_cursor:bool
     * }
     */
    public static function preset(string $profile): array
    {
        return match ($profile) {
            'cheapest' => [
                'profile' => 'cheapest',
                'ask_avoid_cursor' => true,
                'cursor_requires_agent' => true,
                'cursor_strong_signals_only' => true,
                'prefer_cheap_models' => true,
                'gemini_for_mid_tasks' => true,
                'workers_max_chars' => 400,
                'fix_words_to_cursor' => false,
            ],
            'quality' => [
                'profile' => 'quality',
                'ask_avoid_cursor' => false,
                'cursor_requires_agent' => false,
                'cursor_strong_signals_only' => false,
                'prefer_cheap_models' => false,
                'gemini_for_mid_tasks' => false,
                'workers_max_chars' => 80,
                'fix_words_to_cursor' => true,
            ],
            default => [
                // balanced = 効く改善の標準
                'profile' => 'balanced',
                'ask_avoid_cursor' => true,
                'cursor_requires_agent' => true,
                'cursor_strong_signals_only' => true,
                'prefer_cheap_models' => true,
                'gemini_for_mid_tasks' => true,
                'workers_max_chars' => 200,
                'fix_words_to_cursor' => false,
            ],
        };
    }

    /**
     * @param array<string, mixed> $base
     * @param array<string, mixed> $over
     * @return array{
     *   profile:string,
     *   ask_avoid_cursor:bool,
     *   cursor_requires_agent:bool,
     *   cursor_strong_signals_only:bool,
     *   prefer_cheap_models:bool,
     *   gemini_for_mid_tasks:bool,
     *   workers_max_chars:int,
     *   fix_words_to_cursor:bool
     * }
     */
    private static function merge(array $base, array $over): array
    {
        foreach (
            [
                'ask_avoid_cursor',
                'cursor_requires_agent',
                'cursor_strong_signals_only',
                'prefer_cheap_models',
                'gemini_for_mid_tasks',
                'fix_words_to_cursor',
            ] as $boolKey
        ) {
            if (array_key_exists($boolKey, $over)) {
                $base[$boolKey] = filter_var($over[$boolKey], FILTER_VALIDATE_BOOLEAN);
            }
        }
        if (isset($over['workers_max_chars']) && is_numeric($over['workers_max_chars'])) {
            $base['workers_max_chars'] = max(40, min(800, (int) $over['workers_max_chars']));
        }
        return $base;
    }
}
