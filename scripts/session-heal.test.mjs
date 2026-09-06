import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('prepareLocalRoute recreates missing sessions', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(src, /createSession/)
  assert.match(src, /Stale UI id/)
  assert.doesNotMatch(src, /throw new Error\('session not found'\)/)
})

test('ChatService PHP recreates missing sessions', () => {
  const src = fs.readFileSync(path.join(root, 'server/src/ChatService.php'), 'utf8')
  assert.match(src, /Stale client session id/)
  assert.match(src, /INSERT INTO chat_sessions/)
})

test('route events expose session_id for UI sync', () => {
  const api = fs.readFileSync(path.join(root, 'electron/main/api.ts'), 'utf8')
  const chat = fs.readFileSync(path.join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(api, /session_id: decided\.session_id/)
  assert.match(chat, /event\.session_id/)
  assert.match(chat, /workspace_id: workspaceId/)
})
