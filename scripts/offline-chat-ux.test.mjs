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
  assert.match(chat, /auto codebase \(\$\{mode\}\)/)
  assert.match(chat, /mode === 'ask' && autoNeedles\.length > 0/)
})

test('Agent soft-attaches open tabs without auto codebase', () => {
  assert.match(chat, /Agent: 開いている他タブを1本だけ自動添付/)
  assert.match(chat, /softCount/)
  assert.match(chat, /mode === 'agent' && Boolean\(selectionPayload\)/)
  assert.match(chat, /mode === 'agent' && problemLines\.length > 0/)
  assert.match(chat, /Agent は search_code があるので省略/)
})

test('App wires ChatPanel recheck to checkBackend', () => {
  assert.match(app, /onRecheckBackend=\{\(\) => void checkBackend\(\)\}/)
})

test('local mode UX: badge, setup banner, Welcome checklist', () => {
  const welcome = readFileSync(join(root, 'src/components/WelcomeScreen.tsx'), 'utf8')
  assert.match(chat, /backendMode/)
  assert.match(chat, /needsApiKeySetup/)
  assert.match(chat, /API キー未設定/)
  assert.match(chat, /ローカルモード: 履歴はアプリ内に保存/)
  assert.match(chat, /onOpenSettings/)
  assert.match(app, /backendMode=\{backend\.mode\}/)
  assert.match(app, /onOpenSettings=\{\(\) => setSettingsOpen\(true\)\}/)
  assert.match(welcome, /ローカルモードで使えます/)
  assert.match(welcome, /API キーを保存/)
  assert.match(welcome, /XAMPP 不要/)
})
