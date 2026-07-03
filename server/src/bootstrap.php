<?php

declare(strict_types=1);

require_once __DIR__ . '/Response.php';
require_once __DIR__ . '/Database.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    Response::ok(['message' => 'ok']);
}
