<?php

declare(strict_types=1);

final class UsageService
{
    public const DEFAULT_LIMITS = [
        'openai' => 20.0,
        'gemini' => 10.0,
        'claude' => 10.0,
        'cursor' => 70.0,
        'workers' => 5.0,
    ];

    /** 概算レート（USD / 1M tokens）。実請求とは一致しない。 */
    private const RATES = [
        'openai' => ['in' => 1.75, 'out' => 14.0],
        'gemini' => ['in' => 0.75, 'out' => 3.75],
        'claude' => ['in' => 2.0, 'out' => 10.0],
        'workers' => ['in' => 0.05, 'out' => 0.15],
        'cursor' => ['in' => 1.25, 'out' => 10.00],
    ];

    /** @return 'ok'|'warn70'|'warn85'|'warn95'|'exceeded' */
    public static function budgetLevel(float $spent, float $limit): string
    {
        if ($limit <= 0) {
            return 'exceeded';
        }
        $pct = ($spent / $limit) * 100.0;
        if ($pct >= 100.0) {
            return 'exceeded';
        }
        if ($pct >= 95.0) {
            return 'warn95';
        }
        if ($pct >= 85.0) {
            return 'warn85';
        }
        if ($pct >= 70.0) {
            return 'warn70';
        }
        return 'ok';
    }

    public static function budgetPercent(float $spent, float $limit): float
    {
        if ($limit <= 0) {
            return 100.0;
        }
        return round(min(100.0, ($spent / $limit) * 100.0), 2);
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function monthlyLimit(array $settings, string $engine): float
    {
        $default = self::DEFAULT_LIMITS[$engine] ?? 0.0;
        return AppSettings::float($settings, 'cost.' . $engine . '.monthly_usd', $default);
    }

    public static function spentThisMonth(PDO $pdo, string $engine): float
    {
    try {
        $stmt = $pdo->prepare(
            'SELECT COALESCE(SUM(estimated_usd), 0) AS spent
             FROM ai_usage
             WHERE engine = :engine
               AND created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')'
        );
        $stmt->execute([':engine' => $engine]);
        $row = $stmt->fetch();
        return $row ? (float) $row['spent'] : 0.0;
    } catch (Throwable) {
        return 0.0;
    }
    }

    /**
     * @return array<string, array{spent:float,limit:float,remaining:float,requests:int,input_tokens:int,output_tokens:int}>
     * @param array<string, mixed> $settings
     */
    public static function monthSummary(PDO $pdo, array $settings): array
    {
        $summary = [];
        foreach (['openai', 'gemini', 'claude', 'cursor', 'workers'] as $engine) {
            $limit = self::monthlyLimit($settings, $engine);
            $stats = self::engineMonthStats($pdo, $engine);
            $spent = $stats['spent'];
            $summary[$engine] = [
                'spent' => round($spent, 4),
                'limit' => $limit,
                'remaining' => round(max(0, $limit - $spent), 4),
                'pct' => self::budgetPercent($spent, $limit),
                'level' => self::budgetLevel($spent, $limit),
                'requests' => $stats['requests'],
                'input_tokens' => $stats['input_tokens'],
                'output_tokens' => $stats['output_tokens'],
            ];
        }
        return $summary;
    }

    /**
     * @return array{
     *   month:string,
     *   total:array{spent:float,limit:float,remaining:float,requests:int},
     *   user:array{plan:string,spent:float,limit:float,remaining:float,pct:float,level:string},
     *   usage:array<string, array{spent:float,limit:float,remaining:float,requests:int,input_tokens:int,output_tokens:int}>,
     *   models:list<array{engine:string,model:string,spent:float,requests:int,input_tokens:int,output_tokens:int}>
     * }
     * @param array<string, mixed> $settings
     */
    public static function monthDetail(PDO $pdo, array $settings): array
    {
        $usage = self::monthSummary($pdo, $settings);
        $totalSpent = 0.0;
        $totalLimit = 0.0;
        $totalRequests = 0;
        foreach ($usage as $row) {
            $totalSpent += (float) $row['spent'];
            $totalLimit += (float) $row['limit'];
            $totalRequests += (int) $row['requests'];
        }

        return [
            'month' => date('Y-m'),
            'total' => [
                'spent' => round($totalSpent, 4),
                'limit' => round($totalLimit, 4),
                'remaining' => round(max(0, $totalLimit - $totalSpent), 4),
                'requests' => $totalRequests,
            ],
            'user' => self::userBudgetSummary($pdo, $settings),
            'usage' => $usage,
            'models' => self::modelMonthStats($pdo),
            'router' => self::routeMonthInsight($pdo, $settings),
        ];
    }

    /**
     * Router 振り分けの今月集計と調整ヒント。
     *
     * @return array{
     *   total:int,
     *   fallbacks:int,
     *   fallback_rate:float,
     *   by_engine:list<array{engine:string,count:int,estimated_usd:float}>,
     *   by_task:list<array{task_type:string,engine:string,count:int}>,
     *   recent:list<array{id:int,engine:string,task_type:string,mode:string,model:?string,estimated_usd:float,fallback_from:?string,fallback_reason:?string,created_at:string}>,
     *   hints:list<array{level:string,text:string}>
     * }
     * @param array<string, mixed> $settings
     */
    public static function routeMonthInsight(PDO $pdo, array $settings): array
    {
        $empty = [
            'total' => 0,
            'fallbacks' => 0,
            'fallback_rate' => 0.0,
            'by_engine' => [],
            'by_task' => [],
            'recent' => [],
            'hints' => [[
                'level' => 'info',
                'text' => 'まだ Router ログがありません。チャットで「自動」を使うと記録されます。',
            ]],
        ];

        try {
            $totalStmt = $pdo->query(
                'SELECT COUNT(*) AS c,
                        SUM(CASE WHEN fallback_from IS NOT NULL AND fallback_from <> \'\' THEN 1 ELSE 0 END) AS fb
                 FROM ai_route_log
                 WHERE created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')'
            );
            $totalRow = $totalStmt->fetch() ?: ['c' => 0, 'fb' => 0];
            $total = (int) $totalRow['c'];
            $fallbacks = (int) $totalRow['fb'];
            if ($total === 0) {
                return $empty;
            }

            $byEngine = [];
            $engineStmt = $pdo->query(
                'SELECT engine,
                        COUNT(*) AS count,
                        COALESCE(SUM(estimated_usd), 0) AS estimated_usd
                 FROM ai_route_log
                 WHERE created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')
                 GROUP BY engine
                 ORDER BY count DESC'
            );
            foreach ($engineStmt->fetchAll() as $row) {
                $byEngine[] = [
                    'engine' => (string) $row['engine'],
                    'count' => (int) $row['count'],
                    'estimated_usd' => round((float) $row['estimated_usd'], 4),
                ];
            }

            $byTask = [];
            $taskStmt = $pdo->query(
                'SELECT task_type, engine, COUNT(*) AS count
                 FROM ai_route_log
                 WHERE created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')
                 GROUP BY task_type, engine
                 ORDER BY count DESC
                 LIMIT 40'
            );
            foreach ($taskStmt->fetchAll() as $row) {
                $byTask[] = [
                    'task_type' => (string) $row['task_type'],
                    'engine' => (string) $row['engine'],
                    'count' => (int) $row['count'],
                ];
            }

            $recent = [];
            $recentStmt = $pdo->query(
                'SELECT id, engine, task_type, mode, model, estimated_usd,
                        fallback_from, fallback_reason, created_at
                 FROM ai_route_log
                 ORDER BY id DESC
                 LIMIT 30'
            );
            foreach ($recentStmt->fetchAll() as $row) {
                $recent[] = [
                    'id' => (int) $row['id'],
                    'engine' => (string) $row['engine'],
                    'task_type' => (string) $row['task_type'],
                    'mode' => (string) $row['mode'],
                    'model' => $row['model'] !== null ? (string) $row['model'] : null,
                    'estimated_usd' => round((float) $row['estimated_usd'], 4),
                    'fallback_from' => $row['fallback_from'] !== null ? (string) $row['fallback_from'] : null,
                    'fallback_reason' => $row['fallback_reason'] !== null
                        ? (string) $row['fallback_reason']
                        : null,
                    'created_at' => (string) $row['created_at'],
                ];
            }

            $fallbackRate = round(($fallbacks / max(1, $total)) * 100.0, 1);
            $hints = self::buildRouteHints($byEngine, $byTask, $total, $fallbackRate, $settings);

            return [
                'total' => $total,
                'fallbacks' => $fallbacks,
                'fallback_rate' => $fallbackRate,
                'by_engine' => $byEngine,
                'by_task' => $byTask,
                'recent' => $recent,
                'hints' => $hints,
            ];
        } catch (Throwable) {
            return [
                'total' => 0,
                'fallbacks' => 0,
                'fallback_rate' => 0.0,
                'by_engine' => [],
                'by_task' => [],
                'recent' => [],
                'hints' => [[
                    'level' => 'warn',
                    'text' => 'ai_route_log テーブルが未作成の可能性があります。migration_ai_route_log.sql を実行してください。',
                ]],
            ];
        }
    }

    /**
     * @param list<array{engine:string,count:int,estimated_usd:float}> $byEngine
     * @param list<array{task_type:string,engine:string,count:int}> $byTask
     * @param array<string, mixed> $settings
     * @return list<array{level:string,text:string}>
     */
    private static function buildRouteHints(
        array $byEngine,
        array $byTask,
        int $total,
        float $fallbackRate,
        array $settings
    ): array {
        $hints = [];
        if ($total < 8) {
            $hints[] = [
                'level' => 'info',
                'text' => "記録は {$total} 件です。もう少し「自動」で使うと振り分け傾向がはっきりします。",
            ];
        }

        if ($fallbackRate >= 25.0) {
            $hints[] = [
                'level' => 'warn',
                'text' => "フォールバック率が {$fallbackRate}% と高めです。API キー未設定や月額上限を確認してください。",
            ];
        }

        $counts = [];
        foreach ($byEngine as $row) {
            $counts[$row['engine']] = $row['count'];
        }
        $openai = $counts['openai'] ?? 0;
        $gemini = $counts['gemini'] ?? 0;
        $claude = $counts['claude'] ?? 0;

        if ($total >= 8 && $openai > 0 && ($openai / $total) >= 0.75) {
            $hints[] = [
                'level' => 'tip',
                'text' => 'OpenAI への集中が高いです。安価な質問が多いなら設定で Gemini を Auto に含め、gemini_for_mid_tasks を有効にしてください。',
            ];
        }

        if ($total >= 8 && $gemini === 0 && $openai + $claude > 0) {
            $hints[] = [
                'level' => 'tip',
                'text' => '今月 Gemini が選ばれていません。キー未設定か Auto 無効の可能性があります。',
            ];
        }

        $lightOnExpensive = 0;
        $designOnCheap = 0;
        foreach ($byTask as $row) {
            if (
                in_array($row['task_type'], ['light_qa', 'summarize'], true)
                && in_array($row['engine'], ['openai', 'claude', 'cursor'], true)
            ) {
                $lightOnExpensive += $row['count'];
            }
            if (
                in_array($row['task_type'], ['design', 'patch_multi', 'repo_analysis', 'test_fix'], true)
                && in_array($row['engine'], ['gemini', 'workers'], true)
            ) {
                $designOnCheap += $row['count'];
            }
        }
        if ($lightOnExpensive >= 5) {
            $hints[] = [
                'level' => 'tip',
                'text' => "簡単な質問・要約が有料寄りのエンジンに {$lightOnExpensive} 回流れています。Gemini 優先を強めるとコストを抑えやすいです。",
            ];
        }
        if ($designOnCheap >= 3) {
            $hints[] = [
                'level' => 'warn',
                'text' => "設計・大規模修正が安価エンジンに {$designOnCheap} 回流れています。Claude / OpenAI の残予算や Auto 有効リストを確認してください。",
            ];
        }

        if ($claude === 0 && $total >= 10) {
            $hints[] = [
                'level' => 'info',
                'text' => 'Claude が未使用です。難しい修正で品質を上げたい場合は Auto に Claude を含め、キーを設定してください。',
            ];
        }

        $profile = AppSettings::str($settings, 'router.profile', 'balanced');
        if ($hints === []) {
            $hints[] = [
                'level' => 'info',
                'text' => "プロファイル「{$profile}」の振り分けは概ね安定しています。気になる偏りがあれば設定の Auto ポリシーを調整してください。",
            ];
        }

        return array_slice($hints, 0, 5);
    }

    /**
     * @return array{spent:float,requests:int,input_tokens:int,output_tokens:int}
     */
    private static function engineMonthStats(PDO $pdo, string $engine): array
    {
        try {
            $stmt = $pdo->prepare(
                'SELECT
                    COALESCE(SUM(estimated_usd), 0) AS spent,
                    COUNT(*) AS requests,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens
                 FROM ai_usage
                 WHERE engine = :engine
                   AND created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')'
            );
            $stmt->execute([':engine' => $engine]);
            $row = $stmt->fetch();
            return [
                'spent' => $row ? (float) $row['spent'] : 0.0,
                'requests' => $row ? (int) $row['requests'] : 0,
                'input_tokens' => $row ? (int) $row['input_tokens'] : 0,
                'output_tokens' => $row ? (int) $row['output_tokens'] : 0,
            ];
        } catch (Throwable) {
            return [
                'spent' => 0.0,
                'requests' => 0,
                'input_tokens' => 0,
                'output_tokens' => 0,
            ];
        }
    }

    /**
     * @return list<array{engine:string,model:string,spent:float,requests:int,input_tokens:int,output_tokens:int}>
     */
    private static function modelMonthStats(PDO $pdo): array
    {
        try {
            $stmt = $pdo->query(
                'SELECT
                    engine,
                    COALESCE(NULLIF(TRIM(model), \'\'), \'(未記録)\') AS model,
                    COALESCE(SUM(estimated_usd), 0) AS spent,
                    COUNT(*) AS requests,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens
                 FROM ai_usage
                 WHERE created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')
                 GROUP BY engine, COALESCE(NULLIF(TRIM(model), \'\'), \'(未記録)\')
                 ORDER BY spent DESC, requests DESC'
            );
            $rows = $stmt->fetchAll();
            $out = [];
            foreach ($rows as $row) {
                $out[] = [
                    'engine' => (string) $row['engine'],
                    'model' => (string) $row['model'],
                    'spent' => round((float) $row['spent'], 4),
                    'requests' => (int) $row['requests'],
                    'input_tokens' => (int) $row['input_tokens'],
                    'output_tokens' => (int) $row['output_tokens'],
                ];
            }
            return $out;
        } catch (Throwable) {
            return [];
        }
    }

    public static function estimateUsd(string $engine, int $inputTokens, int $outputTokens): float
    {
        $rates = self::RATES[$engine] ?? self::RATES['openai'];
        $usd = ($inputTokens / 1_000_000) * $rates['in']
            + ($outputTokens / 1_000_000) * $rates['out'];
        if ($engine === 'cursor' && $usd < 0.02 && ($inputTokens + $outputTokens) > 0) {
            $usd = 0.02;
        }
        return round($usd, 6);
    }

    /**
     * 実行前の概算コスト（履歴・system プロンプト分のバッファ込み）。
     */
    public static function estimateRequestUsd(string $engine, string $message, string $taskType): float
    {
        $input = self::tokensFromText($message) + 800;
        $output = match ($taskType) {
            'light_qa', 'summarize' => 400,
            'explain' => 800,
            'codegen', 'patch_small' => 1500,
            'design', 'patch_multi', 'repo_analysis', 'test_fix', 'long_dev' => 3000,
            default => 1000,
        };
        return self::estimateUsd($engine, $input, $output);
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function remainingBudget(PDO $pdo, array $settings, string $engine): float
    {
        $limit = self::monthlyLimit($settings, $engine);
        $spent = self::spentThisMonth($pdo, $engine);
        return round(max(0.0, $limit - $spent), 6);
    }

    /**
     * Provider 残予算が今回の推定コストを賄えるか。
     *
     * @param array<string, mixed> $settings
     */
    public static function canAffordRequest(
        PDO $pdo,
        array $settings,
        string $engine,
        float $estimatedUsd
    ): bool {
        if ($estimatedUsd <= 0) {
            return true;
        }
        return self::remainingBudget($pdo, $settings, $engine) + 1e-9 >= $estimatedUsd;
    }

    /** @var array<string, float> */
    public const USER_PLAN_LIMITS = [
        'free' => 0.5,
        'light' => 2.0,
        'standard' => 5.0,
        'unlimited' => 9999.0,
    ];

    /**
     * @param array<string, mixed> $settings
     */
    public static function userPlan(array $settings): string
    {
        $raw = strtolower(trim(AppSettings::str($settings, 'billing.user_plan', 'unlimited')));
        return array_key_exists($raw, self::USER_PLAN_LIMITS) ? $raw : 'unlimited';
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function userMonthlyLimit(array $settings): float
    {
        $plan = self::userPlan($settings);
        $default = self::USER_PLAN_LIMITS[$plan];
        $override = AppSettings::float($settings, 'billing.user.monthly_usd', -1.0);
        if ($override >= 0) {
            return $override;
        }
        return $default;
    }

    public static function userSpentThisMonth(PDO $pdo): float
    {
        try {
            $stmt = $pdo->query(
                'SELECT COALESCE(SUM(estimated_usd), 0) AS spent
                 FROM ai_usage
                 WHERE created_at >= DATE_FORMAT(NOW(), \'%Y-%m-01\')'
            );
            $row = $stmt->fetch();
            return $row ? (float) $row['spent'] : 0.0;
        } catch (Throwable) {
            return 0.0;
        }
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function userRemaining(PDO $pdo, array $settings): float
    {
        return round(max(0.0, self::userMonthlyLimit($settings) - self::userSpentThisMonth($pdo)), 6);
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function userCanAfford(PDO $pdo, array $settings, float $estimatedUsd): bool
    {
        if ($estimatedUsd <= 0) {
            return true;
        }
        return self::userRemaining($pdo, $settings) + 1e-9 >= $estimatedUsd;
    }

    /**
     * @return array{plan:string,spent:float,limit:float,remaining:float,pct:float,level:string}
     * @param array<string, mixed> $settings
     */
    public static function userBudgetSummary(PDO $pdo, array $settings): array
    {
        $limit = self::userMonthlyLimit($settings);
        $spent = self::userSpentThisMonth($pdo);
        return [
            'plan' => self::userPlan($settings),
            'spent' => round($spent, 4),
            'limit' => round($limit, 4),
            'remaining' => round(max(0.0, $limit - $spent), 4),
            'pct' => self::budgetPercent($spent, $limit),
            'level' => self::budgetLevel($spent, $limit),
        ];
    }

    public static function tokensFromText(string $text): int
    {
        $chars = mb_strlen($text);
        return max(1, (int) ceil($chars / 4));
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function record(PDO $pdo, array $row): void
    {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO ai_usage
                 (session_id, engine, task_type, model, input_tokens, output_tokens,
                  estimated_usd, fallback_from, cursor_run_id)
                 VALUES
                 (:session_id, :engine, :task_type, :model, :input_tokens, :output_tokens,
                  :estimated_usd, :fallback_from, :cursor_run_id)'
            );
            $stmt->execute([
                ':session_id' => $row['session_id'] ?? null,
                ':engine' => $row['engine'],
                ':task_type' => $row['task_type'] ?? '',
                ':model' => $row['model'] ?? null,
                ':input_tokens' => $row['input_tokens'] ?? 0,
                ':output_tokens' => $row['output_tokens'] ?? 0,
                ':estimated_usd' => $row['estimated_usd'] ?? 0,
                ':fallback_from' => $row['fallback_from'] ?? null,
                ':cursor_run_id' => $row['cursor_run_id'] ?? null,
            ]);
        } catch (Throwable) {
            // マイグレーション前でもチャットは継続する
        }
    }

    /**
     * Router 判定の運用ログ（振り分け改善用）。
     *
     * @param array<string, mixed> $row
     */
    public static function recordRoute(PDO $pdo, array $row): void
    {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO ai_route_log
                 (session_id, requested, engine, task_type, mode, model, estimated_usd,
                  fallback_from, fallback_reason, budget_warning)
                 VALUES
                 (:session_id, :requested, :engine, :task_type, :mode, :model, :estimated_usd,
                  :fallback_from, :fallback_reason, :budget_warning)'
            );
            $stmt->execute([
                ':session_id' => $row['session_id'] ?? null,
                ':requested' => $row['requested'] ?? '',
                ':engine' => $row['engine'] ?? '',
                ':task_type' => $row['task_type'] ?? '',
                ':mode' => $row['mode'] ?? 'ask',
                ':model' => $row['model'] ?? null,
                ':estimated_usd' => $row['estimated_usd'] ?? 0,
                ':fallback_from' => $row['fallback_from'] ?? null,
                ':fallback_reason' => $row['fallback_reason'] ?? null,
                ':budget_warning' => $row['budget_warning'] ?? null,
            ]);
        } catch (Throwable) {
            // テーブル未作成でもチャットは継続
        }
    }
}
