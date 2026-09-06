import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('streamChat skips PHP route when offline and short timeout when online', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(src, /if \(!phpOnline\)/)
  assert.match(src, /timeoutMs: 3_000/)
  assert.match(src, /応答を準備中|Agent を準備中/)
})

test('toolAgent emits phase before disk work and defers MCP catalog', () => {
  const src = fs.readFileSync(path.join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(src, /計画を開始/)
  assert.match(src, /Promise\.all\(\[/)
  assert.match(src, /loadProjectRules\(workspacePath\)/)
  assert.match(src, /suggestVerifyCommands\(workspacePath\)/)
  assert.match(src, /Defer MCP spawn/)
  assert.match(src, /list_mcp_tools で一覧/)
  const startup = src.slice(src.indexOf('export async function runToolAgent'))
  const firstList = startup.indexOf('mcpManager.listWorkspaceTools')
  const firstPhase = startup.indexOf("note: '計画を開始'")
  assert.ok(firstPhase >= 0 && (firstList < 0 || firstPhase < firstList))
})

test('ChatPanel Agent context is lean for TTFT', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /mode === 'ask' && autoNeedles\.length > 0/)
  assert.match(src, /wantRules &&/)
  assert.match(src, /softCount >= 1/)
  assert.match(src, /Promise\.all\(/)
})
