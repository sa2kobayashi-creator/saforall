<?php

declare(strict_types=1);

require_once __DIR__ . '/ModelCatalog.php';
require_once __DIR__ . '/RouterPolicy.php';

final class ChatService
{
    /**
     * @param array<string, mixed> $body
     * @return array{
     *   session_id:int,
     *   engine:string,
     *   requested:string,
     *   task_type:string,
     *   fallback_from:?string,
     *   fallback_reason:?string,
     *   budget_warning:?string,
     *   estimated_usd:float,
     *   model:string,
     *   api_key:string,
     *   base_url:string,
     *   extra_headers:list<string>,
     *   user_message_id:int,
     *   messages:list<array{role:string,content:string}>
     * }
     */
    public static function prepare(PDO $pdo, array $body): array
    {
        $sessionId = isset($body['session_id']) ? (int) $body['session_id'] : 0;
        $message = isset($body['message']) && is_string($body['message']) ? trim($body['message']) : '';
        $userMessageId = isset($body['user_message_id']) ? (int) $body['user_message_id'] : 0;

        if ($sessionId <= 0) {
            Response::error('INVALID_BODY', 'session_id is required', 400);
        }
        if ($message === '' && $userMessageId <= 0) {
            Response::error('INVALID_BODY', 'message is required', 400);
        }

        $check = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = :id');
        $check->execute([':id' => $sessionId]);
        if (!$check->fetch()) {
            Response::error('NOT_FOUND', 'session not found', 404);
        }

        $settings = AppSettings::load($pdo);
        $requested = isset($body['engine']) && is_string($body['engine'])
            ? $body['engine']
            : (isset($body['task_tier']) && $body['task_tier'] === 'design' ? 'openai' : 'auto');
        $mode = isset($body['mode']) && is_string($body['mode']) ? strtolower(trim($body['mode'])) : 'ask';
        if ($mode !== 'agent') {
            $mode = 'ask';
        }

        if ($userMessageId <= 0) {
            $decision = AiRouter::decide($pdo, $settings, $requested, $message, $mode);
            $insertUser = $pdo->prepare(
                'INSERT INTO chat_messages (session_id, role, content)
                 VALUES (:session_id, :role, :content)'
            );
            $insertUser->execute([
                ':session_id' => $sessionId,
                ':role' => 'user',
                ':content' => $message,
            ]);
            $userMessageId = (int) $pdo->lastInsertId();

            $titleStmt = $pdo->prepare('SELECT title FROM chat_sessions WHERE id = :id');
            $titleStmt->execute([':id' => $sessionId]);
            $session = $titleStmt->fetch();
            if ($session && ($session['title'] === 'New chat' || $session['title'] === '')) {
                $title = mb_substr($message, 0, 40);
                $updateTitle = $pdo->prepare('UPDATE chat_sessions SET title = :title WHERE id = :id');
                $updateTitle->execute([
                    ':title' => $title,
                    ':id' => $sessionId,
                ]);
            }
        } else {
            $saved = self::fetchMessage($pdo, $userMessageId);
            $message = (string) $saved['content'];
            $decision = [
                'requested' => isset($body['requested']) ? (string) $body['requested'] : $requested,
                'engine' => isset($body['resolved_engine']) ? (string) $body['resolved_engine'] : 'openai',
                'task_type' => isset($body['task_type']) ? (string) $body['task_type'] : 'explain',
                'fallback_from' => isset($body['fallback_from']) ? (string) $body['fallback_from'] : null,
                'fallback_reason' => isset($body['fallback_reason']) ? (string) $body['fallback_reason'] : null,
                'mode' => $mode,
                'policy_profile' => RouterPolicy::load($settings)['profile'],
            ];
        }

        $engine = $decision['engine'];
        $forcedModel = isset($body['model']) && is_string($body['model']) ? trim($body['model']) : null;
        if ($forcedModel === '' || $forcedModel === 'auto-within-engine') {
            $forcedModel = null;
        }
        // エンジン自動時は作業に応じてモデルも自動選択（明示 model は無視）
        if ($decision['requested'] === 'auto') {
            $forcedModel = null;
        }
        $provider = self::providerConfig(
            $settings,
            $engine,
            $decision['task_type'],
            $forcedModel
        );

        $historyStmt = $pdo->prepare(
            'SELECT role, content
             FROM chat_messages
             WHERE session_id = :session_id
             ORDER BY id DESC
             LIMIT 30'
        );
        $historyStmt->execute([':session_id' => $sessionId]);
        $historyRows = array_reverse($historyStmt->fetchAll());

        $systemParts = [
            'あなたは saforall という AI コードエディタのアシスタントです。',
            '簡潔で正確に、コードに即して日本語で答えてください。',
            '必要ならコードブロックを使ってください。',
            'ユーザー入力に誤字・変換ミス・打ち間違いがあっても、文脈から意図を汲み取って応答してください。'
                . ' 例: 「大備考」→「だいぶ」、「有効化して」の言い間違いなど。不明なときだけ短く確認する。',
            '実行環境は Windows + PowerShell です。apt-get / sudo / pip / flask は使わないでください。',
            'example.com や github.com/username などのプレースホルダ URL は使わないでください。',
            'シェルコマンドのコードブロックに $ プロンプトを付けないでください。',
            'ファイル用コードブロックにはパスを付けてください（例: ```javascript index.js）。',
        ];

        $systemParts[] = match ($engine) {
            'gemini' => 'レーン: Gemini。要約・翻訳・やや軽い質問向けです。',
            'claude' => 'レーン: Claude。設計・レビュー・難しいコード修正を丁寧に行ってください。Agent ではツールで編集・検証できます。',
            'workers' => 'レーン: Cloudflare Workers AI。簡単な質問・短い文章・ドキュメント向けに短く答えてください。',
            'cursor' => 'レーン: Cursor Agent（開発者オプトイン）。リポジトリ上のコードを調査・修正します。',
            default => 'レーン: OpenAI。説明・設計・コード提案を丁寧に行ってください。',
        };

        if ($mode === 'agent' && $engine !== 'cursor') {
            $systemParts[] =
                'Agent モードです。edit_file / run_shell などのツールは API の tool_calls でのみ実行されます。'
                . 'set_phase・edit_file・run_shell を bash や markdown「手順」として書いてはいけません（無効・禁止）。'
                . 'ツール実行ができない環境では、コード修正案の詳細を出さず、OpenAI 選択とフォルダオープンが必要である旨だけ伝えてください。';
        }
        if ($mode === 'ask') {
            $systemParts[] =
                'Ask モードです。説明と提案が中心です。破壊的な自動適用は想定せず、'
                . 'ユーザーが確認してから適用できる形で答えてください。';
        }

        $context = $body['context'] ?? null;
        if (is_array($context)) {
            $filePath = isset($context['path']) && is_string($context['path']) ? $context['path'] : null;
            $fileContent = isset($context['content']) && is_string($context['content']) ? $context['content'] : null;
            $language = isset($context['language']) && is_string($context['language']) ? $context['language'] : null;

            if ($filePath !== null && $fileContent !== null && $fileContent !== '') {
                $maxChars = 12000;
                if (mb_strlen($fileContent) > $maxChars) {
                    $fileContent = mb_substr($fileContent, 0, $maxChars) . "\n\n... (truncated)";
                }
                $systemParts[] = "現在開いているファイル: {$filePath}"
                    . ($language ? " (language: {$language})" : '');
                $systemParts[] = "```\n{$fileContent}\n```";
            }

            $selection = $context['selection'] ?? null;
            if (is_array($selection)) {
                $selPath = isset($selection['path']) && is_string($selection['path'])
                    ? $selection['path']
                    : ($filePath ?? 'unknown');
                $selText = isset($selection['text']) && is_string($selection['text'])
                    ? $selection['text']
                    : '';
                $startLine = isset($selection['start_line']) ? (int) $selection['start_line'] : 0;
                $endLine = isset($selection['end_line']) ? (int) $selection['end_line'] : $startLine;
                if ($selText !== '') {
                    $maxSel = 8000;
                    if (mb_strlen($selText) > $maxSel) {
                        $selText = mb_substr($selText, 0, $maxSel) . "\n\n... (truncated)";
                    }
                    $range = $startLine > 0
                        ? ($endLine > $startLine ? "L{$startLine}-L{$endLine}" : "L{$startLine}")
                        : '';
                    $systemParts[] = "ユーザーがエディタで選択している範囲 ({$selPath}"
                        . ($range !== '' ? " {$range}" : '')
                        . ')。質問はこの選択を優先して解釈してください。';
                    $systemParts[] = "```\n{$selText}\n```";
                }
            }

            $extraFiles = $context['files'] ?? null;
            if (is_array($extraFiles)) {
                $budget = 20000;
                $used = 0;
                $index = 0;
                foreach ($extraFiles as $extra) {
                    if (!is_array($extra) || $used >= $budget) {
                        break;
                    }
                    $extraPath = isset($extra['path']) && is_string($extra['path']) ? $extra['path'] : null;
                    $extraContent = isset($extra['content']) && is_string($extra['content']) ? $extra['content'] : null;
                    if ($extraPath === null || $extraContent === null || $extraContent === '') {
                        continue;
                    }
                    if ($filePath !== null && $extraPath === $filePath) {
                        continue;
                    }
                    $remain = $budget - $used;
                    if (mb_strlen($extraContent) > $remain) {
                        $extraContent = mb_substr($extraContent, 0, max(500, $remain)) . "\n\n... (truncated)";
                    }
                    $used += mb_strlen($extraContent);
                    $index += 1;
                    $extraLang = isset($extra['language']) && is_string($extra['language'])
                        ? $extra['language']
                        : null;
                    $systemParts[] = "追加コンテキスト #{$index}: {$extraPath}"
                        . ($extraLang ? " (language: {$extraLang})" : '');
                    $systemParts[] = "```\n{$extraContent}\n```";
                }
            }

            $rules = isset($context['rules']) && is_string($context['rules']) ? $context['rules'] : null;
            if (is_string($rules) && $rules !== '') {
                $maxRules = 12000;
                if (mb_strlen($rules) > $maxRules) {
                    $rules = mb_substr($rules, 0, $maxRules) . "\n\n... (truncated)";
                }
                $systemParts[] = "プロジェクトルール:\n{$rules}";
            }

            $problemRows = $context['problems'] ?? null;
            $mentionFlags = $context['mention_flags'] ?? null;
            $problemCap = 20;
            if (is_array($mentionFlags) && !empty($mentionFlags['problems'])) {
                $problemCap = 40;
            }
            if (is_array($problemRows) && count($problemRows) > 0) {
                $lines = [];
                foreach ($problemRows as $row) {
                    if (is_string($row) && $row !== '') {
                        $lines[] = $row;
                    }
                    if (count($lines) >= $problemCap) {
                        break;
                    }
                }
                if (count($lines) > 0) {
                    $systemParts[] = "Problems パネルの内容:\n" . implode("\n", $lines);
                }
            }

            if (is_array($mentionFlags)) {
                $hints = [];
                if (!empty($mentionFlags['selection'])) {
                    $hints[] = 'ユーザーは @selection を明示しました。選択範囲を優先してください。';
                }
                if (!empty($mentionFlags['problems'])) {
                    $hints[] = 'ユーザーは @problems を明示しました。診断の修正を優先してください。';
                }
                if (!empty($mentionFlags['rules'])) {
                    $hints[] = 'ユーザーは @rules を明示しました。プロジェクトルールに従ってください。';
                }
                if (!empty($mentionFlags['codebase'])) {
                    $hints[] = 'ユーザーは @codebase を明示しました。ワークスペース全体の文脈を意識してください。';
                }
                if (count($hints) > 0) {
                    $systemParts[] = implode("\n", $hints);
                }
            }

            $indexSummary = isset($context['index_summary']) && is_string($context['index_summary'])
                ? $context['index_summary']
                : null;
            if (is_string($indexSummary) && $indexSummary !== '') {
                $systemParts[] = "コードベース索引:\n{$indexSummary}";
            }
        }

        $messages = [
            [
                'role' => 'system',
                'content' => implode("\n\n", $systemParts),
            ],
        ];

        foreach ($historyRows as $row) {
            $role = (string) $row['role'];
            if (!in_array($role, ['user', 'assistant', 'system'], true)) {
                continue;
            }
            $messages[] = [
                'role' => $role,
                'content' => (string) $row['content'],
            ];
        }

        require_once __DIR__ . '/UsageService.php';
        UsageService::recordRoute($pdo, [
            'session_id' => $sessionId,
            'requested' => $decision['requested'] ?? $requested,
            'engine' => $engine,
            'task_type' => $decision['task_type'] ?? '',
            'mode' => $decision['mode'] ?? $mode,
            'model' => $provider['model'],
            'estimated_usd' => $decision['estimated_usd'] ?? 0,
            'fallback_from' => $decision['fallback_from'] ?? null,
            'fallback_reason' => $decision['fallback_reason'] ?? null,
            'budget_warning' => $decision['budget_warning'] ?? null,
        ]);

        return [
            'session_id' => $sessionId,
            'engine' => $engine,
            'requested' => $decision['requested'],
            'task_type' => $decision['task_type'],
            'fallback_from' => $decision['fallback_from'],
            'fallback_reason' => $decision['fallback_reason'],
            'budget_warning' => $decision['budget_warning'] ?? null,
            'estimated_usd' => isset($decision['estimated_usd']) ? (float) $decision['estimated_usd'] : 0.0,
            'mode' => $decision['mode'] ?? $mode,
            'policy_profile' => $decision['policy_profile'] ?? 'balanced',
            'model' => $provider['model'],
            'api_key' => $provider['api_key'],
            'base_url' => $provider['base_url'],
            'extra_headers' => $provider['extra_headers'],
            'user_message_id' => $userMessageId,
            'messages' => $messages,
        ];
    }

    /**
     * @param array<string, mixed> $settings
     * @return array{model:string,api_key:string,base_url:string,extra_headers:list<string>}
     */
    public static function providerConfig(
        array $settings,
        string $engine,
        string $taskType = 'explain',
        ?string $forcedModel = null
    ): array {
        $model = ModelCatalog::pick($settings, $engine, $taskType, $forcedModel);

        if ($engine === 'gemini') {
            $apiKey = AppSettings::secret($settings, 'llm.gemini.api_key', 'GEMINI_API_KEY');
            if ($apiKey === '') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Gemini API キーが未設定です。設定画面または GEMINI_API_KEY を保存してください。',
                    400
                );
            }
            return [
                'model' => $model,
                'api_key' => $apiKey,
                // 公式 generateContent を使用（OpenAI 互換エンドポイントは使わない）
                'base_url' => 'gemini-native',
                'extra_headers' => [],
            ];
        }

        if ($engine === 'claude') {
            $apiKey = AppSettings::secret($settings, 'llm.claude.api_key', 'ANTHROPIC_API_KEY');
            if ($apiKey === '') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Claude API キーが未設定です。設定画面または ANTHROPIC_API_KEY を保存してください。',
                    400
                );
            }
            $baseUrl = AppSettings::str($settings, 'llm.claude.base_url', 'https://api.anthropic.com');
            return [
                'model' => $model,
                'api_key' => $apiKey,
                'base_url' => $baseUrl !== '' ? $baseUrl : 'https://api.anthropic.com',
                'extra_headers' => [],
            ];
        }

        if ($engine === 'workers') {
            $apiKey = AppSettings::secret($settings, 'llm.workers.api_token', 'CLOUDFLARE_API_TOKEN');
            if ($apiKey === '') {
                $apiKey = AppSettings::secret($settings, 'llm.simple.api_token', 'CF_API_TOKEN');
            }
            $accountId = AppSettings::str($settings, 'llm.workers.account_id');
            if ($accountId === '') {
                $accountId = AppSettings::str($settings, 'llm.simple.account_id');
            }
            $gatewayId = AppSettings::str($settings, 'llm.workers.gateway_id');
            if ($gatewayId === '') {
                $gatewayId = AppSettings::str($settings, 'llm.simple.gateway_id', 'default');
            }
            if ($apiKey === '' || $accountId === '') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Workers AI が未設定です。Account ID と API Token を保存してください。',
                    400
                );
            }
            return [
                'model' => $model,
                'api_key' => $apiKey,
                'base_url' => 'https://api.cloudflare.com/client/v4/accounts/'
                    . rawurlencode($accountId)
                    . '/ai/v1',
                'extra_headers' => ['cf-aig-gateway-id: ' . $gatewayId],
            ];
        }

        if ($engine === 'cursor') {
            $apiKey = AppSettings::secret($settings, 'llm.cursor.api_key', 'CURSOR_API_KEY');
            if ($apiKey === '') {
                Response::error(
                    'LLM_NOT_CONFIGURED',
                    'Cursor API キーが未設定です。設定画面または CURSOR_API_KEY を保存してください。',
                    400
                );
            }
            return [
                'model' => $model,
                'api_key' => $apiKey,
                'base_url' => '',
                'extra_headers' => [],
            ];
        }

        $apiKey = AppSettings::secret($settings, 'llm.openai.api_key', 'OPENAI_API_KEY');
        if ($apiKey === '') {
            $apiKey = AppSettings::secret($settings, 'llm.api_key', 'SAFORALL_API_KEY');
        }
        $baseUrl = AppSettings::str($settings, 'llm.openai.base_url', '');
        if ($baseUrl === '') {
            $baseUrl = AppSettings::str($settings, 'llm.base_url', 'https://api.openai.com/v1');
        }
        $baseUrl = self::normalizeOpenAiCompatibleBaseUrl($baseUrl);
        if ($apiKey === '') {
            Response::error(
                'LLM_NOT_CONFIGURED',
                'OpenAI API キーが未設定です。設定画面または OPENAI_API_KEY を保存してください。',
                400
            );
        }
        return [
            'model' => $model,
            'api_key' => $apiKey,
            'base_url' => $baseUrl,
            'extra_headers' => [],
        ];
    }

    /**
     * OpenAI 互換 Base URL を正規化する。
     * - 末尾の /chat/completions を除去
     * - api.openai.com で /v1 が無い場合は付与
     */
    public static function normalizeOpenAiCompatibleBaseUrl(string $baseUrl): string
    {
        $url = trim($baseUrl);
        if ($url === '') {
            return 'https://api.openai.com/v1';
        }

        $url = rtrim($url, '/');
        $url = preg_replace('#/chat/completions$#i', '', $url) ?? $url;
        $url = preg_replace('#/completions$#i', '', $url) ?? $url;
        $url = rtrim($url, '/');

        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return 'https://api.openai.com/v1';
        }

        $host = strtolower((string) $parts['host']);
        $path = (string) ($parts['path'] ?? '');
        if ($host === 'api.openai.com' && !preg_match('#/v[0-9]+(?:/|$)#', $path)) {
            return 'https://api.openai.com/v1';
        }

        return $url;
    }

    /** @return array<string, mixed> */
    public static function saveAssistant(PDO $pdo, int $sessionId, string $content): array
    {
        $insertAssistant = $pdo->prepare(
            'INSERT INTO chat_messages (session_id, role, content)
             VALUES (:session_id, :role, :content)'
        );
        $insertAssistant->execute([
            ':session_id' => $sessionId,
            ':role' => 'assistant',
            ':content' => $content,
        ]);
        $assistantMessageId = (int) $pdo->lastInsertId();

        $touch = $pdo->prepare(
            'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = :id'
        );
        $touch->execute([':id' => $sessionId]);

        return self::fetchMessage($pdo, $assistantMessageId);
    }

    /** @return array<string, mixed> */
    public static function fetchMessage(PDO $pdo, int $messageId): array
    {
        $row = $pdo->prepare(
            'SELECT id, session_id, role, content, created_at FROM chat_messages WHERE id = :id'
        );
        $row->execute([':id' => $messageId]);
        $message = $row->fetch();
        if (!$message) {
            throw new RuntimeException('message not found');
        }

        return $message;
    }
}
