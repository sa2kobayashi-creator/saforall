<?php

declare(strict_types=1);

final class AiRouter
{
    public const ENGINES = ['auto', 'cursor', 'openai', 'gemini', 'workers'];

    /** @var list<string> */
    public const PROVIDER_ENGINES = ['workers', 'gemini', 'openai', 'cursor'];

    /**
     * @param array<string, mixed> $settings
     * @return array{
     *   requested:string,
     *   engine:string,
     *   task_type:string,
     *   fallback_from:?string,
     *   fallback_reason:?string
     * }
     */
    public static function decide(PDO $pdo, array $settings, string $requested, string $message): array
    {
        $requested = strtolower(trim($requested));
        if (!in_array($requested, self::ENGINES, true)) {
            $requested = 'auto';
        }

        $taskType = self::classify($message);
        $enabled = self::enabledEngines($settings);
        $ready = self::readyMap($settings);

        $fallbackFrom = null;
        $fallbackReason = null;

        if ($requested === 'auto') {
            if ($enabled === []) {
                Response::error(
                    'ROUTER_EMPTY',
                    'Auto パイプラインに有効な AI がありません。設定で 1 つ以上有効にしてください。',
                    400
                );
            }

            $preferred = self::engineForTask($taskType);
            $engine = self::firstAvailable(
                self::preferenceChain($preferred),
                $enabled,
                $ready,
                $pdo,
                $settings
            );

            if ($engine === null) {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Auto で有効な AI のうち、キー設定済みかつ月額上限内のものがありません。',
                    400
                );
            }

            if ($engine !== $preferred && in_array($preferred, $enabled, true)) {
                $fallbackFrom = $preferred;
                $fallbackReason = self::label($preferred) . ' が使えないため '
                    . self::label($engine) . ' に切り替えました';
            } elseif ($engine !== $preferred && !in_array($preferred, $enabled, true)) {
                $fallbackFrom = $preferred;
                $fallbackReason = self::label($preferred) . ' は Auto で無効のため '
                    . self::label($engine) . ' を使います';
            }

            return [
                'requested' => $requested,
                'engine' => $engine,
                'task_type' => $taskType,
                'fallback_from' => $fallbackFrom,
                'fallback_reason' => $fallbackReason,
            ];
        }

        // 固定エンジン: Auto の有効リストとは独立（明示選択を優先）
        $engine = $requested;
        if (!($ready[$engine] ?? false)) {
            Response::error(
                'LLM_NOT_CONFIGURED',
                self::label($engine) . ' が未設定です。設定画面でキー等を保存してください。',
                400
            );
        }
        if (!self::withinBudget($pdo, $settings, $engine)) {
            Response::error(
                'BUDGET_EXCEEDED',
                self::label($engine) . ' の月額上限に達しています。設定で上限を上げてください。',
                429
            );
        }

        return [
            'requested' => $requested,
            'engine' => $engine,
            'task_type' => $taskType,
            'fallback_from' => null,
            'fallback_reason' => null,
        ];
    }

    /**
     * @param array<string, mixed> $settings
     * @return list<string>
     */
    public static function enabledEngines(array $settings): array
    {
        $raw = AppSettings::str($settings, 'router.enabled_engines');
        $defaults = self::PROVIDER_ENGINES;

        if ($raw === '') {
            return $defaults;
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            $parts = preg_split('/[,\n]+/', $raw) ?: [];
            $decoded = $parts;
        }

        $list = [];
        foreach ($decoded as $item) {
            if (!is_string($item)) {
                continue;
            }
            $id = strtolower(trim($item));
            if (in_array($id, self::PROVIDER_ENGINES, true) && !in_array($id, $list, true)) {
                $list[] = $id;
            }
        }

        return $list !== [] ? $list : $defaults;
    }

    /**
     * @param array<string, mixed> $settings
     * @return array<string, bool>
     */
    private static function readyMap(array $settings): array
    {
        $openaiKey = AppSettings::secret($settings, 'llm.openai.api_key', 'OPENAI_API_KEY');
        if ($openaiKey === '') {
            $openaiKey = AppSettings::secret($settings, 'llm.api_key', 'SAFORALL_API_KEY');
        }
        $geminiKey = AppSettings::secret($settings, 'llm.gemini.api_key', 'GEMINI_API_KEY');
        $cursorKey = AppSettings::secret($settings, 'llm.cursor.api_key', 'CURSOR_API_KEY');
        $workersToken = AppSettings::secret($settings, 'llm.workers.api_token', 'CLOUDFLARE_API_TOKEN');
        if ($workersToken === '') {
            $workersToken = AppSettings::secret($settings, 'llm.simple.api_token', 'CF_API_TOKEN');
        }
        $workersAccount = AppSettings::str($settings, 'llm.workers.account_id');
        if ($workersAccount === '') {
            $workersAccount = AppSettings::str($settings, 'llm.simple.account_id');
        }

        return [
            'openai' => $openaiKey !== '',
            'gemini' => $geminiKey !== '',
            'cursor' => $cursorKey !== '',
            'workers' => $workersToken !== '' && $workersAccount !== '',
        ];
    }

    /**
     * 希望エンジンから、代替候補の優先順位を作る。
     *
     * @return list<string>
     */
    private static function preferenceChain(string $preferred): array
    {
        $chains = [
            'workers' => ['workers', 'gemini', 'openai', 'cursor'],
            'gemini' => ['gemini', 'workers', 'openai', 'cursor'],
            'openai' => ['openai', 'gemini', 'workers', 'cursor'],
            'cursor' => ['cursor', 'openai', 'gemini', 'workers'],
        ];
        return $chains[$preferred] ?? ['openai', 'gemini', 'workers', 'cursor'];
    }

    /**
     * @param list<string> $chain
     * @param list<string> $enabled
     * @param array<string, bool> $ready
     * @param array<string, mixed> $settings
     */
    private static function firstAvailable(
        array $chain,
        array $enabled,
        array $ready,
        PDO $pdo,
        array $settings
    ): ?string {
        foreach ($chain as $engine) {
            if (!in_array($engine, $enabled, true)) {
                continue;
            }
            if (!($ready[$engine] ?? false)) {
                continue;
            }
            if (!self::withinBudget($pdo, $settings, $engine)) {
                continue;
            }
            return $engine;
        }

        // チェーンに無い有効エンジンも最後に試す
        foreach ($enabled as $engine) {
            if (!($ready[$engine] ?? false)) {
                continue;
            }
            if (!self::withinBudget($pdo, $settings, $engine)) {
                continue;
            }
            return $engine;
        }

        return null;
    }

    private static function label(string $engine): string
    {
        return match ($engine) {
            'cursor' => 'Cursor',
            'openai' => 'OpenAI',
            'gemini' => 'Gemini',
            'workers' => 'Workers AI',
            default => $engine,
        };
    }

    public static function classify(string $message): string
    {
        $text = mb_strtolower($message);

        if (self::matches($text, ['テストして', 'テストを通', '失敗するまで', 'test and fix', 'make tests pass'])) {
            return 'test_fix';
        }
        if (self::matches($text, ['時間かけて', 'じっくり', 'long running', 'thorough'])) {
            return 'long_dev';
        }
        if (self::matches($text, ['複数ファイル', '一式', 'ログイン全体', 'リファクタ', 'refactor', 'across files'])) {
            return 'patch_multi';
        }
        if (self::matches($text, ['リポジトリ', 'コードベース全体', 'プロジェクト全体', 'analyze repo'])) {
            return 'repo_analysis';
        }
        if (self::matches($text, ['直して', '修正して', 'バグ', '実装して', 'fix', 'implement', 'バグを直'])) {
            return 'patch_small';
        }
        if (self::matches($text, ['設計', 'アーキテクチャ', '方針', 'architecture', 'design'])) {
            return 'design';
        }
        if (self::matches($text, ['説明して', '何をしている', 'なぜ', 'explain', 'what does'])) {
            return 'explain';
        }
        if (self::matches($text, ['要約', '翻訳', '短く', 'ドキュメント', 'コメントを書いて', 'summarize', 'translate', 'docs'])) {
            return 'summarize';
        }
        if (str_contains($message, '```') || self::matches($text, ['コードを書いて', '生成して', 'write code'])) {
            return 'codegen';
        }
        if (mb_strlen($message) < 80 && !str_contains($message, "\n")) {
            return 'light_qa';
        }

        return 'explain';
    }

    public static function engineForTask(string $taskType): string
    {
        return match ($taskType) {
            'light_qa', 'summarize' => 'workers',
            'explain', 'codegen', 'design' => 'openai',
            'patch_small', 'patch_multi', 'repo_analysis', 'test_fix', 'long_dev' => 'cursor',
            default => 'openai',
        };
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function withinBudget(PDO $pdo, array $settings, string $engine): bool
    {
        $limit = UsageService::monthlyLimit($settings, $engine);
        if ($limit <= 0) {
            return false;
        }
        return UsageService::spentThisMonth($pdo, $engine) < $limit;
    }

    /**
     * @param list<string> $needles
     */
    private static function matches(string $haystack, array $needles): bool
    {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($haystack, mb_strtolower($needle))) {
                return true;
            }
        }
        return false;
    }
}
