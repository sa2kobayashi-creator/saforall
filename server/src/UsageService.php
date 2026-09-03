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
     * @return array<string, array{spent:float,limit:float,remaining:float}>
     * @param array<string, mixed> $settings
     */
    public static function monthSummary(PDO $pdo, array $settings): array
    {
        $summary = [];
        foreach (['cursor', 'openai', 'gemini', 'workers'] as $engine) {
            $limit = self::monthlyLimit($settings, $engine);
            $spent = self::spentThisMonth($pdo, $engine);
            $summary[$engine] = [
                'spent' => round($spent, 4),
                'limit' => $limit,
                'remaining' => round(max(0, $limit - $spent), 4),
            ];
        }
        return $summary;
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
