import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const chat = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
const guide = readFileSync(join(root, 'src/lib/backendGuide.ts'), 'utf8')
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')

test('backendGuide explains XAMPP health check', () => {
  assert.match(guide, /buildBackendOfflineMessage/)
  assert.match(guide, /XAMPP/)
  assert.match(guide, /health/)
})

test('ChatPanel blocks offline send without fake assistant reply', () => {
  assert.match(chat, /編集専用モード|ローカル LLM モード/)
  assert.match(chat, /buildBackendOfflineMessage/)
  assert.match(chat, /onRecheckBackend/)
  assert.match(chat, /localLlmReady/)
  assert.doesNotMatch(chat, /（オフライン）「\$\{text\}」を受け取りました/)
  assert.match(chat, /chatReady/)
})

test('Ask mode auto-attaches light codebase search', () => {
  assert.match(chat, /autoCodebase/)
  assert.match(chat, /auto codebase \(ask\)/)
  assert.match(chat, /mode === 'ask'/)
})

test('App wires ChatPanel recheck to checkBackend', () => {
  assert.match(app, /onRecheckBackend=\{\(\) => void checkBackend\(\)\}/)
})
