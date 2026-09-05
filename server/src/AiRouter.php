<?php

declare(strict_types=1);

require_once __DIR__ . '/RouterPolicy.php';
require_once __DIR__ . '/UsageService.php';

final class AiRouter
{
    public const ENGINES = ['auto', 'openai', 'gemini', 'claude', 'cursor', 'workers'];

    /** Product Auto defaults: OpenAI / Gemini / Claude. Cursor & Workers remain opt-in. */
    /** @var list<string> */
    public const PROVIDER_ENGINES = ['openai', 'gemini', 'claude', 'cursor', 'workers'];

    /** @var list<string> */
    public const DEFAULT_ENABLED = ['openai', 'gemini', 'claude'];

    /**
     * @param array<string, mixed> $settings
     * @return array{
     *   requested:string,
     *   engine:string,
     *   task_type:string,
     *   fallback_from:?string,
     *   fallback_reason:?string,
     *   budget_warning:?string,
     *   estimated_usd:float,
     *   mode:string,
     *   policy_profile:string
     * }
     */
    public static function decide(
        PDO $pdo,
        array $settings,
        string $requested,
        string $message,
        string $mode = 'ask'
    ): array {
        $requested = strtolower(trim($requested));
        if (!in_array($requested, self::ENGINES, true)) {
            $requested = 'auto';
        }

        $mode = strtolower(trim($mode));
        if ($mode !== 'agent') {
            $mode = 'ask';
        }

        $policy = RouterPolicy::load($settings);
        $taskType = self::classify($message, $policy);
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

            if (!UsageService::userCanAfford($pdo, $settings, 0.0001)) {
                Response::error(
                    'USER_BUDGET_EXCEEDED',
                    'ユーザープランの月額 AI 利用上限に達しています。プランを上げるか翌月までお待ちください。',
                    429
                );
            }

            $preferred = self::engineForTask($taskType, $policy, $mode);
            // Ask で Cursor 回避など、ポリシーで希望を再調整
            $preferred = self::applyModeGuards($preferred, $taskType, $policy, $mode);
            // Agent は edit_file / Composer のツール実行を標準にする（Cursor/Gemini は別経路）
            $preferred = self::preferToolAgentEngine($preferred, $mode);

            $engine = self::firstAvailable(
                self::preferenceChain($preferred, $policy, $mode),
                $enabled,
                $ready,
                $pdo,
                $settings,
                $policy,
                $mode,
                $message,
                $taskType
            );

            if ($engine === null) {
                $userLeft = UsageService::userRemaining($pdo, $settings);
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    $mode === 'agent'
                        ? 'Agent モードには OpenAI または Claude（ツール対応）が必要です。設定で API キーを保存してください。'
                        : ($userLeft <= 0
                            ? 'ユーザープランの月額上限に達しているか、推定コストを賄える Provider がありません。'
                            : 'Auto で有効な AI のうち、キー設定済みかつ月額上限・推定コスト内のものがありません。'),
                    400
                );
            }

            $estimated = UsageService::estimateRequestUsd($engine, $message, $taskType);

            if ($engine !== $preferred && in_array($preferred, $enabled, true)) {
                $fallbackFrom = $preferred;
                $level = self::budgetLevelFor($pdo, $settings, $preferred);
                $prefEst = UsageService::estimateRequestUsd($preferred, $message, $taskType);
                if (!UsageService::canAffordRequest($pdo, $settings, $preferred, $prefEst)
                    || !UsageService::userCanAfford($pdo, $settings, $prefEst)) {
                    $fallbackReason = self::label($preferred) . ' の推定コスト（約 $'
                        . number_format($prefEst, 4) . '）が残予算を超えるため '
                        . self::label($engine) . ' に切り替えました';
                } elseif (in_array($level, ['warn85', 'warn95', 'exceeded'], true)) {
                    $fallbackReason = self::label($preferred) . ' の予算しきい値（'
                        . $level . '）のため ' . self::label($engine) . ' に切り替えました';
                } elseif (!($ready[$preferred] ?? false)) {
                    $fallbackReason = self::label($preferred) . ' が未設定のため '
                        . self::label($engine) . ' に切り替えました';
                } else {
                    $fallbackReason = self::label($preferred) . ' が使えないため '
                        . self::label($engine) . ' に切り替えました';
                }
            } elseif ($engine !== $preferred && !in_array($preferred, $enabled, true)) {
                $fallbackFrom = $preferred;
                $fallbackReason = self::label($preferred) . ' は Auto で無効のため '
                    . self::label($engine) . ' を使います';
            }

            $budgetWarning = self::composeBudgetWarning($pdo, $settings, $engine, $estimated);

            return [
                'requested' => $requested,
                'engine' => $engine,
                'task_type' => $taskType,
                'fallback_from' => $fallbackFrom,
                'fallback_reason' => $fallbackReason,
                'budget_warning' => $budgetWarning,
                'estimated_usd' => $estimated,
                'mode' => $mode,
                'policy_profile' => (string) $policy['profile'],
            ];
        }

        // 固定エンジン: Auto の有効リストとは独立（明示選択を優先）
        $engine = $requested;
        if ($mode === 'agent' && in_array($engine, ['workers', 'gemini'], true)) {
            Response::error(
                'AGENT_ENGINE_UNSUPPORTED',
                self::label($engine) . ' は Agent（ツール実行）に未対応です。OpenAI または Claude を選択してください。',
                400
            );
        }
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

        $estimated = UsageService::estimateRequestUsd($engine, $message, $taskType);
        if (!UsageService::userCanAfford($pdo, $settings, $estimated)) {
            Response::error(
                'USER_BUDGET_EXCEEDED',
                'ユーザープランの残予算（$'
                    . number_format(UsageService::userRemaining($pdo, $settings), 4)
                    . '）では推定コスト（約 $' . number_format($estimated, 4) . '）を実行できません。',
                429
            );
        }
        if (!UsageService::canAffordRequest($pdo, $settings, $engine, $estimated)) {
            Response::error(
                'BUDGET_EXCEEDED',
                self::label($engine) . ' の残予算（$'
                    . number_format(UsageService::remainingBudget($pdo, $settings, $engine), 4)
                    . '）では推定コスト（約 $' . number_format($estimated, 4) . '）を実行できません。',
                429
            );
        }

        $budgetWarning = self::composeBudgetWarning($pdo, $settings, $engine, $estimated);

        return [
            'requested' => $requested,
            'engine' => $engine,
            'task_type' => $taskType,
            'fallback_from' => null,
            'fallback_reason' => null,
            'budget_warning' => $budgetWarning,
            'estimated_usd' => $estimated,
            'mode' => $mode,
            'policy_profile' => (string) $policy['profile'],
        ];
    }

    /**
     * @param array<string, mixed> $settings
     * @return list<string>
     */
    public static function enabledEngines(array $settings): array
    {
        $raw = AppSettings::str($settings, 'router.enabled_engines');
        $defaults = self::DEFAULT_ENABLED;

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
        $claudeKey = AppSettings::secret($settings, 'llm.claude.api_key', 'ANTHROPIC_API_KEY');
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
            'claude' => $claudeKey !== '',
            'cursor' => $cursorKey !== '',
            'workers' => $workersToken !== '' && $workersAccount !== '',
        ];
    }

    /**
     * @param array<string, mixed> $policy
     * @return list<string>
     */
    private static function preferenceChain(string $preferred, array $policy, string $mode = 'ask'): array
    {
        // Agent は OpenAI function calling（Composer / edit_file）が必要。
        if ($mode === 'agent') {
            return ['openai'];
        }

        $cheapMid = !empty($policy['gemini_for_mid_tasks']);
        $chains = [
            'gemini' => ['gemini', 'openai', 'claude', 'workers', 'cursor'],
            'openai' => $cheapMid
                ? ['openai', 'gemini', 'claude', 'workers', 'cursor']
                : ['openai', 'claude', 'gemini', 'workers', 'cursor'],
            'claude' => ['claude', 'openai', 'gemini', 'workers', 'cursor'],
            'workers' => $cheapMid
                ? ['workers', 'gemini', 'openai', 'claude', 'cursor']
                : ['workers', 'openai', 'gemini', 'claude', 'cursor'],
            'cursor' => ['cursor', 'claude', 'openai', 'gemini', 'workers'],
        ];
        return $chains[$preferred] ?? ['openai', 'gemini', 'claude', 'workers', 'cursor'];
    }

    /**
     * @param list<string> $chain
     * @param list<string> $enabled
     * @param array<string, bool> $ready
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $policy
     */
    private static function firstAvailable(
        array $chain,
        array $enabled,
        array $ready,
        PDO $pdo,
        array $settings,
        array $policy,
        string $mode,
        string $message,
        string $taskType
    ): ?string {
        // Pass 1: normal / warn70 only（85%+ はスキップ）
        foreach ($chain as $engine) {
            if (!self::candidateOk(
                $engine,
                $enabled,
                $ready,
                $policy,
                $mode,
                $pdo,
                $settings,
                false,
                $message,
                $taskType
            )) {
                continue;
            }
            return $engine;
        }

        // Pass 2: allow warn85（まだ 95% 未満）
        foreach ($chain as $engine) {
            if (!self::candidateOk(
                $engine,
                $enabled,
                $ready,
                $policy,
                $mode,
                $pdo,
                $settings,
                true,
                $message,
                $taskType
            )) {
                continue;
            }
            return $engine;
        }

        foreach ($enabled as $engine) {
            if (!self::candidateOk(
                $engine,
                $enabled,
                $ready,
                $policy,
                $mode,
                $pdo,
                $settings,
                true,
                $message,
                $taskType
            )) {
                continue;
            }
            return $engine;
        }

        return null;
    }

    /**
     * @param list<string> $enabled
     * @param array<string, bool> $ready
     * @param array<string, mixed> $policy
     * @param array<string, mixed> $settings
     */
    private static function candidateOk(
        string $engine,
        array $enabled,
        array $ready,
        array $policy,
        string $mode,
        PDO $pdo,
        array $settings,
        bool $allowWarn85,
        string $message,
        string $taskType
    ): bool {
        if (!in_array($engine, $enabled, true)) {
            return false;
        }
        if (!($ready[$engine] ?? false)) {
            return false;
        }
        if (!self::engineAllowedByPolicy($engine, $policy, $mode)) {
            return false;
        }
        $level = self::budgetLevelFor($pdo, $settings, $engine);
        if ($level === 'exceeded' || $level === 'warn95') {
            return false;
        }
        if ($level === 'warn85' && !$allowWarn85) {
            return false;
        }
        $estimated = UsageService::estimateRequestUsd($engine, $message, $taskType);
        if (!UsageService::canAffordRequest($pdo, $settings, $engine, $estimated)) {
            return false;
        }
        if (!UsageService::userCanAfford($pdo, $settings, $estimated)) {
            return false;
        }
        return true;
    }

    /**
     * @param array<string, mixed> $settings
     */
    private static function composeBudgetWarning(
        PDO $pdo,
        array $settings,
        string $engine,
        float $estimated
    ): ?string {
        $parts = [];
        $chosenLevel = self::budgetLevelFor($pdo, $settings, $engine);
        if ($chosenLevel === 'warn70' || $chosenLevel === 'warn85') {
            $parts[] = self::label($engine) . ' の月額使用率が警告ラインです（' . $chosenLevel . '）';
        }
        $user = UsageService::userBudgetSummary($pdo, $settings);
        if ($user['level'] === 'warn70' || $user['level'] === 'warn85') {
            $parts[] = 'ユーザープラン（' . $user['plan'] . '）の使用率が警告ラインです';
        }
        $remaining = UsageService::remainingBudget($pdo, $settings, $engine);
        if ($estimated > 0 && $remaining > 0 && $estimated >= $remaining * 0.5) {
            $parts[] = '今回の推定コスト約 $' . number_format($estimated, 4)
                . '（' . self::label($engine) . ' 残 $' . number_format($remaining, 4) . '）';
        }
        return $parts !== [] ? implode(' / ', $parts) : null;
    }

    /**
     * @param array<string, mixed> $policy
     */
    private static function engineAllowedByPolicy(string $engine, array $policy, string $mode): bool
    {
        if ($engine !== 'cursor') {
            return true;
        }
        if (!empty($policy['ask_avoid_cursor']) && $mode !== 'agent') {
            return false;
        }
        if (!empty($policy['cursor_requires_agent']) && $mode !== 'agent') {
            return false;
        }
        return true;
    }

    private static function label(string $engine): string
    {
        return match ($engine) {
            'cursor' => 'Cursor',
            'openai' => 'OpenAI',
            'gemini' => 'Gemini',
            'claude' => 'Claude',
            'workers' => 'Workers AI',
            default => $engine,
        };
    }

    /**
     * @param array<string, mixed> $policy
     */
    public static function classify(string $message, array $policy = []): string
    {
        $text = mb_strtolower($message);
        $fixToCursor = !empty($policy['fix_words_to_cursor']);
        $workersMax = isset($policy['workers_max_chars']) ? (int) $policy['workers_max_chars'] : 200;

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

        // 標準では「直して」だけでは Cursor にしない（軽い修正扱いに落とす）
        if ($fixToCursor && self::matches($text, ['直して', '修正して', 'バグ', '実装して', 'fix', 'implement', 'バグを直'])) {
            return 'patch_small';
        }
        if (!$fixToCursor && self::matches($text, ['直して', '修正して', 'バグを直', 'fix this', 'fix bug'])) {
            // 単発修正っぽい語は OpenAI/Gemini レーン（codegen 寄り）へ
            return 'codegen';
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
        if (str_contains($message, '```') || self::matches($text, ['コードを書いて', '生成して', '実装して', 'write code', 'implement'])) {
            return 'codegen';
        }

        // Workers 短文判定（改行ありでも文字数以内なら light_qa）
        $plain = trim($message);
        if (mb_strlen($plain) < $workersMax) {
            return 'light_qa';
        }

        return 'explain';
    }

    /**
     * @param array<string, mixed> $policy
     */
    public static function engineForTask(string $taskType, array $policy = [], string $mode = 'ask'): string
    {
        $geminiMid = !empty($policy['gemini_for_mid_tasks']);
        $strongOnly = !empty($policy['cursor_strong_signals_only']);

        return match ($taskType) {
            'light_qa' => $geminiMid ? 'gemini' : 'gemini',
            'summarize' => 'gemini',
            'explain' => $geminiMid ? 'gemini' : 'openai',
            'codegen' => 'openai',
            'design' => 'claude',
            // 重い作業は製品 API では Claude（Cursor は明示選択 / オプトイン）
            'patch_multi', 'repo_analysis', 'test_fix', 'long_dev' => 'claude',
            'patch_small' => ($strongOnly && $mode === 'agent') ? 'openai' : 'openai',
            default => $geminiMid ? 'gemini' : 'openai',
        };
    }

    /**
     * Auto + Agent ではツール実行可能なエンジンを優先する。
     * Gemini / Workers / Cursor は明示選択時のみ（ツール非対応）。
     * Claude は Anthropic tool_use 対応のため維持する。
     */
    private static function preferToolAgentEngine(string $preferred, string $mode): string
    {
        if ($mode !== 'agent') {
            return $preferred;
        }

        if ($preferred === 'gemini' || $preferred === 'cursor' || $preferred === 'workers') {
            return 'openai';
        }

        return $preferred;
    }

    /**
     * @param array<string, mixed> $policy
     */
    private static function applyModeGuards(
        string $preferred,
        string $taskType,
        array $policy,
        string $mode
    ): string {
        if ($preferred !== 'cursor') {
            return $preferred;
        }

        if (!empty($policy['ask_avoid_cursor']) && $mode !== 'agent') {
            return !empty($policy['gemini_for_mid_tasks']) ? 'gemini' : 'openai';
        }

        if (!empty($policy['cursor_requires_agent']) && $mode !== 'agent') {
            return !empty($policy['gemini_for_mid_tasks']) ? 'gemini' : 'openai';
        }

        if (!empty($policy['cursor_strong_signals_only'])) {
            $strong = ['patch_multi', 'repo_analysis', 'test_fix', 'long_dev'];
            if (!in_array($taskType, $strong, true)) {
                return 'openai';
            }
        }

        return $preferred;
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function withinBudget(PDO $pdo, array $settings, string $engine): bool
    {
        return self::budgetLevelFor($pdo, $settings, $engine) !== 'exceeded';
    }

    /** @return 'ok'|'warn70'|'warn85'|'warn95'|'exceeded' */
    private static function budgetLevelFor(PDO $pdo, array $settings, string $engine): string
    {
        $limit = UsageService::monthlyLimit($settings, $engine);
        $spent = UsageService::spentThisMonth($pdo, $engine);
        return UsageService::budgetLevel($spent, $limit);
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
