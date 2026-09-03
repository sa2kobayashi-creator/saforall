<?php

declare(strict_types=1);

require_once __DIR__ . '/ModelCatalog.php';

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

        if ($userMessageId <= 0) {
            $decision = AiRouter::decide($pdo, $settings, $requested, $message);
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
            '実行環境は Windows + PowerShell です。apt-get / sudo / pip / flask は使わないでください。',
            'example.com や github.com/username などのプレースホルダ URL は使わないでください。',
            'シェルコマンドのコードブロックに $ プロンプトを付けないでください。',
            'ファイル用コードブロックにはパスを付けてください（例: ```javascript index.js）。',
        ];

        $systemParts[] = match ($engine) {
            'gemini' => 'レーン: Gemini。要約・翻訳・やや軽い質問向けです。',
            'workers' => 'レーン: Cloudflare Workers AI。簡単な質問・短い文章・ドキュメント向けに短く答えてください。',
            'cursor' => 'レーン: Cursor Agent。リポジトリ上のコードを調査・修正します。',
            default => 'レーン: OpenAI。説明・設計・コード提案を丁寧に行ってください。',
        };

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

        return [
            'session_id' => $sessionId,
            'engine' => $engine,
            'requested' => $decision['requested'],
            'task_type' => $decision['task_type'],
            'fallback_from' => $decision['fallback_from'],
            'fallback_reason' => $decision['fallback_reason'],
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
            $baseUrl = AppSettings::str(
                $settings,
                'llm.gemini.base_url',
                'https://generativelanguage.googleapis.com/v1beta/openai'
            );
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
                'base_url' => $baseUrl,
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
