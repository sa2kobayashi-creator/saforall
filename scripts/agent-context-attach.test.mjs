import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

test('Agent auto codebase and soft attach are wired', () => {
  const chat = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /mode === 'ask' \|\| mode === 'agent'/)
  assert.match(chat, /auto codebase \(\$\{mode\}\)/)
  assert.match(chat, /開いている他タブを少量自動添付/)
  assert.match(chat, /関連コードは自動検索/)
})

test('localAiRouter includes selection problems and files', () => {
  const router = readFileSync(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(router, /# Selection/)
  assert.match(router, /# Problems/)
  assert.match(router, /# File/)
  assert.match(router, /# Codebase/)
})
