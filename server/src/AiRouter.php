<?php

declare(strict_types=1);

require_once __DIR__ . '/RouterPolicy.php';

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
     *   fallback_reason:?string,
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
                $mode
            );

            if ($engine === null) {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    $mode === 'agent'
                        ? 'Agent モードには OpenAI（function calling 対応）が必要です。設定で OpenAI API キーを保存してください。Workers / Gemini ではツール Agent を実行できません。'
                        : 'Auto で有効な AI のうち、キー設定済みかつ月額上限内のものがありません。',
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
                'mode' => $mode,
                'policy_profile' => (string) $policy['profile'],
            ];
        }

        // 固定エンジン: Auto の有効リストとは独立（明示選択を優先）
        $engine = $requested;
        if ($mode === 'agent' && in_array($engine, ['workers', 'gemini'], true)) {
            Response::error(
                'AGENT_ENGINE_UNSUPPORTED',
                self::label($engine) . ' は Agent（ツール実行）に未対応です。OpenAI（api.openai.com）を選択してください。',
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

        return [
            'requested' => $requested,
            'engine' => $engine,
            'task_type' => $taskType,
            'fallback_from' => null,
            'fallback_reason' => null,
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
     * @param array<string, mixed> $policy
     * @return list<string>
     */
    private static function preferenceChain(string $preferred, array $policy, string $mode = 'ask'): array
    {
        // Agent は OpenAI function calling（Composer / edit_file）が必要。Workers へ落とさない。
        if ($mode === 'agent') {
            return ['openai', 'cursor'];
        }

        $cheapMid = !empty($policy['gemini_for_mid_tasks']);
        $chains = [
            'workers' => $cheapMid
                ? ['workers', 'gemini', 'openai', 'cursor']
                : ['workers', 'openai', 'gemini', 'cursor'],
            'gemini' => ['gemini', 'workers', 'openai', 'cursor'],
            'openai' => $cheapMid
                ? ['openai', 'gemini', 'workers', 'cursor']
                : ['openai', 'workers', 'gemini', 'cursor'],
            'cursor' => ['cursor', 'openai', 'gemini', 'workers'],
        ];
        return $chains[$preferred] ?? ['openai', 'gemini', 'workers', 'cursor'];
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
        string $mode
    ): ?string {
        foreach ($chain as $engine) {
            if (!in_array($engine, $enabled, true)) {
                continue;
            }
            if (!($ready[$engine] ?? false)) {
                continue;
            }
            if (!self::engineAllowedByPolicy($engine, $policy, $mode)) {
                continue;
            }
            if (!self::withinBudget($pdo, $settings, $engine)) {
                continue;
            }
            return $engine;
        }

        foreach ($enabled as $engine) {
            if (!($ready[$engine] ?? false)) {
                continue;
            }
            if (!self::engineAllowedByPolicy($engine, $policy, $mode)) {
                continue;
            }
            if (!self::withinBudget($pdo, $settings, $engine)) {
                continue;
            }
            return $engine;
        }

        return null;
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
            'light_qa' => 'workers',
            'summarize' => $geminiMid ? 'gemini' : 'workers',
            'explain' => $geminiMid ? 'gemini' : 'openai',
            'codegen' => 'openai',
            'design' => 'openai',
            // 強いシグナルのみ Cursor（標準）
            'patch_multi', 'repo_analysis', 'test_fix', 'long_dev' => 'cursor',
            'patch_small' => ($strongOnly && $mode === 'agent') ? 'cursor' : 'openai',
            default => $geminiMid ? 'gemini' : 'openai',
        };
    }

    /**
     * Auto + Agent では OpenAI function calling（ツール Agent）を優先する。
     * Cursor / Gemini / Workers は明示選択時のみ（Workers は tools 400 になりやすい）。
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
