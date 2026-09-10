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
  assert.match(src, /pendingCancelIds/)
})

test('main IPC wires chat stream cancel', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(src, /api:chatStream:cancel/)
  assert.match(src, /api:chatStream:begin/)
  assert.match(src, /beginChatAbort/)
  assert.match(src, /endChatAbort/)
  assert.match(src, /cancelChatAbort/)
})

test('preload exposes cancelChatStream and resolves cancelled', () => {
  const src = fs.readFileSync(path.join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(src, /cancelChatStream/)
  assert.match(src, /beginChatStream/)
  assert.match(src, /type: 'cancelled'/)
  assert.match(src, /requestId: string; done: Promise<void>/)
})

test('tool agent accepts AbortSignal', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(src, /signal\?: AbortSignal/)
  assert.match(src, /throwIfChatAborted\(signal\)/)
  assert.match(src, /toolRunShell\([\s\S]*signal/)
  assert.match(src, /isChatAbortError\(error\) \|\| signal\?\.aborted/)
  const openaiTools = fs.readFileSync(path.join(root, 'electron/main/ai/adapters/openaiTools.ts'), 'utf8')
  const claudeTools = fs.readFileSync(path.join(root, 'electron/main/ai/adapters/claudeTools.ts'), 'utf8')
  assert.match(openaiTools, /linkedAbortSignal/)
  assert.match(claudeTools, /linkedAbortSignal/)
})

test('toolRunShell kills process tree on abort', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/workspaceTools.ts'), 'utf8')
  assert.match(src, /signal\?: AbortSignal/)
  assert.match(src, /taskkill/)
  assert.match(src, /Chat cancelled by user/)
})

test('ChatPanel shows Stop while busy', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /stopChat/)
  assert.match(src, /cancelChatStream/)
  assert.match(src, /beginChatStream/)
  assert.match(src, /event\.type === 'cancelled'/)
  assert.match(src, /停止中/)
  assert.match(src, /停止/)
  assert.match(src, /submitGenerationRef/)
  assert.match(src, /releaseStuckChatUi/)
  assert.match(src, /lastSubmittedTextRef/)
})

test('preload settles chatStream even if onEvent throws', () => {
  const src = fs.readFileSync(path.join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(src, /let settled = false/)
  assert.match(src, /handlers\.onEvent\(payload\.event\)/)
  assert.match(src, /STREAM_INCOMPLETE/)
  assert.match(src, /sawTerminal/)
})

test('toolRunShell force-finishes after abort if close never fires', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/workspaceTools.ts'), 'utf8')
  assert.match(src, /Some Windows shells never emit close after taskkill/)
  assert.match(src, /if \(!settled\) finish\(null\)/)
})
