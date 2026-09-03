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
}
