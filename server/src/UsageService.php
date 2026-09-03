<?php

declare(strict_types=1);

final class UsageService
{
    public const DEFAULT_LIMITS = [
        'cursor' => 70.0,
        'openai' => 20.0,
        'gemini' => 10.0,
        'workers' => 5.0,
    ];

    /** 概算レート（USD / 1M tokens）。実請求とは一致しない。 */
    private const RATES = [
        'openai' => ['in' => 0.15, 'out' => 0.60],
        'gemini' => ['in' => 0.10, 'out' => 0.40],
        'workers' => ['in' => 0.05, 'out' => 0.15],
        'cursor' => ['in' => 1.25, 'out' => 10.00],
    ];

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
        foreach (['cursor', 'openai', 'gemini', 'workers'] as $engine) {
            $limit = self::monthlyLimit($settings, $engine);
            $stats = self::engineMonthStats($pdo, $engine);
            $spent = $stats['spent'];
            $summary[$engine] = [
                'spent' => round($spent, 4),
                'limit' => $limit,
                'remaining' => round(max(0, $limit - $spent), 4),
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
            'usage' => $usage,
            'models' => self::modelMonthStats($pdo),
        ];
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
}
