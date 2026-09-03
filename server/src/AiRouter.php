<?php

declare(strict_types=1);

final class AiRouter
{
    public const ENGINES = ['auto', 'cursor', 'openai', 'gemini', 'workers'];

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
        $engine = $requested === 'auto' ? self::engineForTask($taskType) : $requested;
        $fallbackFrom = null;
        $fallbackReason = null;

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
        $workersReady = $workersToken !== '' && $workersAccount !== '';

        if ($engine === 'workers' && !$workersReady) {
            if ($requested === 'workers') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Workers AI が未設定です。Account ID と API Token を設定してください。',
                    400
                );
            }
            $fallbackFrom = 'workers';
            if ($geminiKey !== '') {
                $fallbackReason = 'Workers AI 未設定のため Gemini に切り替えました';
                $engine = 'gemini';
            } elseif ($openaiKey !== '') {
                $fallbackReason = 'Workers AI 未設定のため OpenAI に切り替えました';
                $engine = 'openai';
            }
        }

        if ($engine === 'gemini' && $geminiKey === '') {
            if ($requested === 'gemini') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Gemini API キーが未設定です。設定画面または GEMINI_API_KEY を保存してください。',
                    400
                );
            }
            if ($workersReady) {
                $fallbackFrom = $fallbackFrom ?? 'gemini';
                $fallbackReason = 'Gemini キー未設定のため Workers AI に切り替えました';
                $engine = 'workers';
            } elseif ($openaiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'gemini';
                $fallbackReason = 'Gemini キー未設定のため OpenAI に切り替えました';
                $engine = 'openai';
            }
        }

        if ($engine === 'openai' && $openaiKey === '') {
            if ($requested === 'openai') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'OpenAI API キーが未設定です。設定画面または OPENAI_API_KEY を保存してください。',
                    400
                );
            }
            if ($geminiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'openai';
                $fallbackReason = 'OpenAI キー未設定のため Gemini に切り替えました';
                $engine = 'gemini';
            } elseif ($workersReady) {
                $fallbackFrom = $fallbackFrom ?? 'openai';
                $fallbackReason = 'OpenAI キー未設定のため Workers AI に切り替えました';
                $engine = 'workers';
            }
        }

        if ($engine === 'cursor' && $cursorKey === '') {
            if ($requested === 'cursor') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Cursor API キーが未設定です。設定画面または CURSOR_API_KEY を保存してください。',
                    400
                );
            }
            $fallbackFrom = 'cursor';
            $fallbackReason = 'Cursor キー未設定のため OpenAI に切り替えました';
            $engine = 'openai';
        }

        if ($engine === 'cursor' && !self::withinBudget($pdo, $settings, 'cursor')) {
            if ($requested === 'cursor') {
                Response::error(
                    'BUDGET_EXCEEDED',
                    'Cursor の月額上限に達しています。設定で上限を上げるか、来月まで待ってください。',
                    429
                );
            }
            $fallbackFrom = 'cursor';
            $fallbackReason = 'Cursor 月額上限のため OpenAI に切り替えました';
            $engine = 'openai';
        }

        if ($engine === 'openai' && !self::withinBudget($pdo, $settings, 'openai')) {
            if ($requested === 'openai') {
                Response::error(
                    'BUDGET_EXCEEDED',
                    'OpenAI の月額上限に達しています。別エンジンを選ぶか上限を上げてください。',
                    429
                );
            }
            if (self::withinBudget($pdo, $settings, 'gemini') && $geminiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'openai';
                $fallbackReason = 'OpenAI 月額上限のため Gemini に切り替えました';
                $engine = 'gemini';
            } elseif (self::withinBudget($pdo, $settings, 'workers') && $workersReady) {
                $fallbackFrom = $fallbackFrom ?? 'openai';
                $fallbackReason = 'OpenAI 月額上限のため Workers AI に切り替えました';
                $engine = 'workers';
            } else {
                Response::error(
                    'BUDGET_EXCEEDED',
                    'OpenAI / Gemini / Workers AI の月額上限に達しています。',
                    429
                );
            }
        }

        if ($engine === 'gemini' && !self::withinBudget($pdo, $settings, 'gemini')) {
            if ($requested === 'gemini') {
                Response::error(
                    'BUDGET_EXCEEDED',
                    'Gemini の月額上限に達しています。設定で上限を上げてください。',
                    429
                );
            }
            if (self::withinBudget($pdo, $settings, 'workers') && $workersReady) {
                $fallbackFrom = $fallbackFrom ?? 'gemini';
                $fallbackReason = 'Gemini 月額上限のため Workers AI に切り替えました';
                $engine = 'workers';
            } elseif (self::withinBudget($pdo, $settings, 'openai') && $openaiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'gemini';
                $fallbackReason = 'Gemini 月額上限のため OpenAI に切り替えました';
                $engine = 'openai';
            } else {
                Response::error(
                    'BUDGET_EXCEEDED',
                    '利用可能な AI の月額上限に達しています。',
                    429
                );
            }
        }

        if ($engine === 'workers' && !self::withinBudget($pdo, $settings, 'workers')) {
            if ($requested === 'workers') {
                Response::error(
                    'BUDGET_EXCEEDED',
                    'Workers AI の月額上限に達しています。設定で上限を上げてください。',
                    429
                );
            }
            if (self::withinBudget($pdo, $settings, 'gemini') && $geminiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'workers';
                $fallbackReason = 'Workers AI 月額上限のため Gemini に切り替えました';
                $engine = 'gemini';
            } elseif (self::withinBudget($pdo, $settings, 'openai') && $openaiKey !== '') {
                $fallbackFrom = $fallbackFrom ?? 'workers';
                $fallbackReason = 'Workers AI 月額上限のため OpenAI に切り替えました';
                $engine = 'openai';
            } else {
                Response::error(
                    'BUDGET_EXCEEDED',
                    '利用可能な AI の月額上限に達しています。',
                    429
                );
            }
        }

        return [
            'requested' => $requested,
            'engine' => $engine,
            'task_type' => $taskType,
            'fallback_from' => $fallbackFrom,
            'fallback_reason' => $fallbackReason,
        ];
    }

    public static function classify(string $message): string
    {
        $text = mb_strtolower($message);

        if (self::matches($text, ['テストして', 'テストを通', '失敗するまで', 'test and fix', 'make tests pass'])) {
            return 'test_fix';
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
