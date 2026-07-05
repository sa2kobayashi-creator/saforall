<?php

declare(strict_types=1);

final class ChatService
{
    /**
     * @param array<string, mixed> $body
     * @return array{
     *   session_id:int,
     *   model:string,
     *   api_key:string,
     *   base_url:string,
     *   user_message_id:int,
     *   messages:list<array{role:string,content:string}>
     * }
     */
    public static function prepare(PDO $pdo, array $body): array
    {
        $sessionId = isset($body['session_id']) ? (int) $body['session_id'] : 0;
        $message = isset($body['message']) && is_string($body['message']) ? trim($body['message']) : '';

        if ($sessionId <= 0) {
            Response::error('INVALID_BODY', 'session_id is required', 400);
        }
        if ($message === '') {
            Response::error('INVALID_BODY', 'message is required', 400);
        }

        $check = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = :id');
        $check->execute([':id' => $sessionId]);
        if (!$check->fetch()) {
            Response::error('NOT_FOUND', 'session not found', 404);
        }

        $settingsRows = $pdo->query('SELECT setting_key, setting_value FROM settings')->fetchAll();
        $settings = [];
        foreach ($settingsRows as $row) {
            $settings[(string) $row['setting_key']] = $row['setting_value'];
        }

        $apiKey = isset($settings['llm.api_key']) ? trim((string) $settings['llm.api_key']) : '';
        $baseUrl = isset($settings['llm.base_url']) && trim((string) $settings['llm.base_url']) !== ''
            ? trim((string) $settings['llm.base_url'])
            : 'https://api.openai.com/v1';
        $model = isset($settings['llm.model']) && trim((string) $settings['llm.model']) !== ''
            ? trim((string) $settings['llm.model'])
            : 'gpt-4o-mini';

        if ($apiKey === '') {
            Response::error(
                'LLM_NOT_CONFIGURED',
                'LLM API キーが未設定です。設定画面で llm.api_key を保存してください。',
                400
            );
        }

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
            'ToDo サンプルは saforall とは別プロジェクト（D:\\Development\\todo-app）の Node.js (Express) です。起動は npm start、URL は http://localhost:3000 です。',
            'example.com や github.com/username などのプレースホルダ URL は使わないでください。',
            'シェルコマンドのコードブロックに $ プロンプトを付けないでください。',
            'ファイル用コードブロックにはパスを付けてください（例: ```javascript index.js）。',
        ];

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
            'model' => $model,
            'api_key' => $apiKey,
            'base_url' => $baseUrl,
            'user_message_id' => $userMessageId,
            'messages' => $messages,
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
