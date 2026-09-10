<?php

declare(strict_types=1);

final class AppSettings
{
    /**
     * @return array<string, string|null>
     */
    public static function load(PDO $pdo): array
    {
        $rows = $pdo->query('SELECT setting_key, setting_value FROM settings')->fetchAll();
        $settings = [];
        foreach ($rows as $row) {
            $settings[(string) $row['setting_key']] = $row['setting_value'];
        }
        return $settings;
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function str(array $settings, string $key, string $default = ''): string
    {
        if (!isset($settings[$key])) {
            return $default;
        }
        $value = trim((string) $settings[$key]);
        return $value === '' ? $default : $value;
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function secret(array $settings, string $settingsKey, string $envName): string
    {
        $fromSettings = self::str($settings, $settingsKey);
        if ($fromSettings !== '') {
            return $fromSettings;
        }
        $fromEnv = getenv($envName);
        return is_string($fromEnv) ? trim($fromEnv) : '';
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function float(array $settings, string $key, float $default): float
    {
        if (!isset($settings[$key]) || !is_numeric($settings[$key])) {
            return $default;
        }
        return (float) $settings[$key];
    }

    public static function set(PDO $pdo, string $key, string $value): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO settings (setting_key, setting_value)
             VALUES (:key, :value)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
        );
        $stmt->execute([
            ':key' => $key,
            ':value' => $value,
        ]);
    }

    /**
     * Anthropic は残高 API を公開していないため、手入力チャージ残を追跡する。
     *
     * @param array<string, mixed> $settings
     * @return array{tracking:bool,remaining:?float,warn_at:float,depleted:bool,low:bool}
     */
    public static function claudePrepaidStatus(array $settings): array
    {
        $raw = isset($settings['llm.claude.prepaid_remaining_usd'])
            ? trim((string) $settings['llm.claude.prepaid_remaining_usd'])
            : '';
        $warn = self::float($settings, 'llm.claude.prepaid_warn_usd', 1.0);
        if ($raw === '' || !is_numeric($raw)) {
            return [
                'tracking' => false,
                'remaining' => null,
                'warn_at' => $warn,
                'depleted' => false,
                'low' => false,
            ];
        }
        $remaining = max(0.0, (float) $raw);
        return [
            'tracking' => true,
            'remaining' => $remaining,
            'warn_at' => $warn,
            'depleted' => $remaining <= 0.0,
            'low' => $remaining > 0.0 && $remaining <= $warn,
        ];
    }

    public static function deductClaudePrepaid(PDO $pdo, array &$settings, float $estimatedUsd): void
    {
        $status = self::claudePrepaidStatus($settings);
        if (!$status['tracking'] || $status['remaining'] === null) {
            return;
        }
        $add = max(0.0, $estimatedUsd);
        if ($add <= 0.0) {
            return;
        }
        $next = max(0.0, round(((float) $status['remaining']) - $add, 4));
        self::set($pdo, 'llm.claude.prepaid_remaining_usd', (string) $next);
        $settings['llm.claude.prepaid_remaining_usd'] = (string) $next;
    }
}
