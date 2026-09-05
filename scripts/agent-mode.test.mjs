import assert from 'node:assert/strict'
import test from 'node:test'

test('agent mode banner copy distinguishes tool execution', () => {
  const ask = '説明・提案。差分は確認してから適用'
  const agent = 'ツール必須 → Composer に載せる'
  assert.match(ask, /確認/)
  assert.match(agent, /Composer/)
})

test('prose-only block message requires edit_file', () => {
  const msg =
    'システム: Agent モードでは説明や markdown コード提示だけでは終了できません。必ずツールを呼び出してください（set_phase → read_file/search_code → edit_file）。edit_file なしの「修正案の説明」は無効です。'
  assert.match(msg, /edit_file/)
  assert.match(msg, /ツール/)
})

/** Mirrors electron/main/toolAgent.ts looksLikeFakeToolProse */
function looksLikeFakeToolProse(text) {
  const raw = (text || '').trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  const names = [
    'set_phase',
    'edit_file',
    'read_file',
    'run_shell',
    'search_code',
    'list_dir',
    'list_mcp_tools',
    'call_mcp_tool'
  ]
  const hitCount = names.filter((name) => lower.includes(name)).length
  if (hitCount >= 2) return true
  if (/手順\s*\d+/.test(raw) && hitCount >= 1) return true
  if (
    /```(?:bash|shell|sh|powershell)?\s*\n?\s*(set_phase|edit_file|read_file|run_shell)\b/i.test(
      raw
    )
  ) {
    return true
  }
  return false
}

test('looksLikeFakeToolProse detects roleplayed tool steps', () => {
  const sample = `**手順 1: \`set_phase\` でモードを設定する**\`\`\`bash
set_phase agent
\`\`\`
**手順 2: \`edit_file\`**`
  assert.equal(looksLikeFakeToolProse(sample), true)
  assert.equal(looksLikeFakeToolProse('add を a+b に直してください'), false)
})

test('agent tools unavailable error forbids ask fallback', () => {
  const msg =
    'Agent（ツール実行）を開始できません: ワークスペース未選択（フォルダを開く）。' +
    'OpenAI または Claude を選び、フォルダを開いて再実行してください。' +
    'Ask への自動フォールバックはしません（edit_file を文章で演じるのを防ぐため）。'
  assert.match(msg, /Ask への自動フォールバックはしません/)
  assert.match(msg, /ツール実行/)
  assert.match(msg, /Claude/)
})

test('normalizeToolCalls skips sparse / flat / missing function', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const src = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(src, /export function normalizeToolCalls/)
  assert.match(src, /const toolCalls = normalizeToolCalls\(message\.tool_calls\)/)
  assert.match(src, /!next\?\.function\?\.name/)
})

test('ChatService asks model to tolerate typos', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const src = await readFile(join(root, 'server/src/ChatService.php'), 'utf8')
  assert.match(src, /誤字・変換ミス/)
  assert.match(src, /大備考/)
})
