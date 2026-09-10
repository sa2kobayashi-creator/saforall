import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

test('Ask auto codebase; Agent skips auto search for TTFT', () => {
  const chat = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /mode === 'ask' && autoNeedles\.length > 0/)
  assert.match(chat, /auto codebase \(\$\{mode\}\)/)
  assert.match(chat, /開いている他タブを1本だけ自動添付/)
  assert.match(chat, /自動検索あり/)
  assert.match(chat, /関連コード自動検索/)
  assert.match(chat, /activeProblemPaths/)
  assert.match(chat, /Agent は search_code があるので省略/)
})

test('localAiRouter includes selection problems and files', () => {
  const router = readFileSync(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(router, /# Selection/)
  assert.match(router, /# Problems/)
  assert.match(router, /# File/)
  assert.match(router, /# Codebase/)
})

test('toolAgent system prompt requires read before edit', () => {
  const agent = readFileSync(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(agent, /既存ファイルは必ず先に read_file/)
  assert.match(agent, /read_required/)
})
