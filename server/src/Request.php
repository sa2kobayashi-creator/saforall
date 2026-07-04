<?php

declare(strict_types=1);

final class Request
{
    /** @return array<string, mixed> */
    public static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            Response::error('INVALID_JSON', 'Request body must be valid JSON', 400);
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }
}
