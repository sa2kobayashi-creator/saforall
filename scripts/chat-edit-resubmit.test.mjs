import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('chatStore exposes truncateMessages', () => {
  const src = readFileSync(join(root, 'electron/main/chatStore.ts'), 'utf8')
  assert.match(src, /export async function truncateMessages/)
  assert.match(src, /mode: 'keepThrough' \| 'deleteFrom'/)
})

test('localApi and PHP expose messages/truncate', () => {
  const local = readFileSync(join(root, 'electron/main/localApi.ts'), 'utf8')
  assert.match(local, /truncateMatch/)
  assert.match(local, /truncateMessages/)

  const index = readFileSync(join(root, 'server/public/index.php'), 'utf8')
  assert.match(index, /messages\/truncate/)

  const php = readFileSync(join(root, 'server/api/chat_messages_truncate.php'), 'utf8')
  assert.match(php, /keepThrough/)
  assert.match(php, /deleteFrom/)
})

test('ChatService resubmit reuses user_message_id with router decide', () => {
  const src = readFileSync(join(root, 'server/src/ChatService.php'), 'utf8')
  assert.match(src, /user_message_id must be a user message/)
  assert.match(src, /DELETE FROM chat_messages WHERE session_id = :session_id AND id > :id/)
  assert.match(src, /resolved_engine/)
  assert.match(src, /AiRouter::decide\(\$pdo, \$settings, \$requested, \$message, \$mode/)
})

test('localAiRouter reuses user_message_id via truncate keepThrough', () => {
  const src = readFileSync(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(src, /body\.user_message_id/)
  assert.match(src, /mode: 'keepThrough'/)
})

test('ChatPanel wires edit / regenerate / resubmit', () => {
  const src = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /confirmEditAndResubmit/)
  assert.match(src, /regenerateAssistant/)
  assert.match(src, /user_message_id/)
  assert.match(src, /messages\/truncate/)
  assert.match(src, /再送信/)
  assert.match(src, /再生成/)
  assert.match(src, /editingMessageId/)
})
