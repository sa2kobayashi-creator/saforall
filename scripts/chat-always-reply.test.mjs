import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('streamChat always emits a terminal event', () => {
  const src = readFileSync(join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(src, /STREAM_INCOMPLETE/)
  assert.match(src, /let terminal = false/)
  assert.match(src, /応答ストリームが途中終了しました/)
})

test('preload synthesizes STREAM_INCOMPLETE when Main is silent', () => {
  const src = readFileSync(join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(src, /sawTerminal/)
  assert.match(src, /STREAM_INCOMPLETE/)
  assert.match(src, /応答が完了しませんでした/)
})

test('ChatPanel guarantees an assistant note after every turn', () => {
  const src = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /ensureAssistantNote/)
  assert.match(src, /turnClosed/)
  assert.match(src, /応答本文が空でした/)
  assert.match(src, /応答が完了しませんでした/)
  assert.match(src, /} catch \(error\) \{/)
  assert.match(src, /応答を停止しました/)
})

test('directLlm rejects blank completions', () => {
  const src = readFileSync(join(root, 'electron/main/directLlm.ts'), 'utf8')
  assert.match(src, /!content\?\.trim\(\)/)
  assert.match(src, /!content\.trim\(\)/)
})
