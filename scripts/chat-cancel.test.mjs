import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('chatAbort helpers exist', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/chatAbort.ts'), 'utf8')
  assert.match(src, /export function beginChatAbort/)
  assert.match(src, /export function cancelChatAbort/)
  assert.match(src, /export function endChatAbort/)
  assert.match(src, /export function linkedAbortSignal/)
})

test('main IPC wires chat stream cancel', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(src, /api:chatStream:cancel/)
  assert.match(src, /beginChatAbort/)
  assert.match(src, /endChatAbort/)
  assert.match(src, /cancelChatAbort/)
})

test('preload exposes cancelChatStream and resolves cancelled', () => {
  const src = fs.readFileSync(path.join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(src, /cancelChatStream/)
  assert.match(src, /type: 'cancelled'/)
  assert.match(src, /requestId: string; done: Promise<void>/)
})

test('tool agent accepts AbortSignal', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(src, /signal\?: AbortSignal/)
  assert.match(src, /throwIfChatAborted\(signal\)/)
  assert.match(src, /linkedAbortSignal/)
})

test('ChatPanel shows Stop while busy', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /stopChat/)
  assert.match(src, /cancelChatStream/)
  assert.match(src, /event\.type === 'cancelled'/)
  assert.match(src, /停止/)
})
