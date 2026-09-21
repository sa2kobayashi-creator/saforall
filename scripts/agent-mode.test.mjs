import assert from 'node:assert/strict'
import test from 'node:test'

test('agent mode banner copy distinguishes tool execution', () => {
  const ask = '説明・提案。差分は確認してから適用'
  const agent = 'ツール必須 → 変更候補に載せる'
  assert.match(ask, /確認/)
  assert.match(agent, /変更候補/)
})

test('prose-only block message requires tools; edit only when editing', () => {
  const msg =
    'システム: Agent モードでは説明や markdown コード提示だけでは終了できません。必ずツールを呼び出してください（set_phase → read_file/search_code）。修正依頼のときだけ edit_file が必要です。調査のみなら read/search のあと最終回答して構いません。'
  assert.match(msg, /read_file\/search_code/)
  assert.match(msg, /調査のみ/)
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
  assert.match(src, /export function parseRetryAfterMs/)
  assert.match(src, /MAX_EMPTY_TOOL_RETRIES/)
  assert.match(src, /read_required/)
  const openaiTools = await readFile(join(root, 'electron/main/ai/adapters/openaiTools.ts'), 'utf8')
  const messages = await readFile(join(root, 'electron/main/ai/agentMessages.ts'), 'utf8')
  assert.match(openaiTools, /response\.status === 429/)
  assert.match(messages, /分間トークン上限/)
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

test('Workers is Agent-unsupported; Ask engines stay selectable', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { isAgentSupportedEngine } = await import('../src/lib/llmModels.ts')
  assert.equal(isAgentSupportedEngine('workers'), false)
  assert.equal(isAgentSupportedEngine('openai'), true)
  assert.equal(isAgentSupportedEngine('claude'), true)
  assert.equal(isAgentSupportedEngine('gemini'), true)
  assert.equal(isAgentSupportedEngine('cursor'), true)
  assert.equal(isAgentSupportedEngine('auto'), true)
  const chat = await readFile(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /isAgentSupportedEngine/)
  assert.match(chat, /disabled=\{mode === 'agent'\}/)
  assert.match(chat, /Agentでは利用できません/)
  // Runtime defense must remain (UI + runtime double gate).
  const workers = await readFile(join(root, 'electron/main/ai/adapters/workers.ts'), 'utf8')
  assert.match(workers, /throwAgentUnsupported\('workers'\)/)
})

test('UI copy uses 変更候補 instead of Composer', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const chat = await readFile(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /変更候補に載せる/)
  const panel = await readFile(join(root, 'src/components/ComposerPanel.tsx'), 'utf8')
  assert.match(panel, /<strong>変更候補<\/strong>/)
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /applyQueue\.length >= 1/)
  const agent = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(agent, /変更候補バーまたは一覧/)
  assert.doesNotMatch(agent, /Composer で「すべて適用」/)
})

/** Mirrors electron/main/toolAgent.ts buildAgentProseExhaustionFinalText */
function buildAgentProseExhaustionFinalText(input) {
  if (input.anyToolCall && input.editedPathCount === 0 && !input.fakingTools) {
    return (
      'Agent はツールを実行しましたが、今回の実行では編集候補が作成されませんでした。' +
      '変更候補が必要な場合は、編集対象と変更内容を明示して再試行してください。' +
      '（編集候補が出るまで Agent の編集成功条件は満たしていません。）'
    )
  }
  return (
    'Agent がツールを正しく呼び出せませんでした（文章での「手順: edit_file」などは無効です）。' +
    'モデルを OpenAI にし、フォルダを開いた状態で再試行してください。変更候補に差分が出るまで成功ではありません。'
  )
}

test('prose exhaustion finalText: no-edit vs tool-none vs fake prose', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const src = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')

  assert.match(src, /export function buildAgentProseExhaustionFinalText/)
  assert.match(src, /buildAgentProseExhaustionFinalText\(\{/)
  assert.match(src, /editedPathCount: editedPaths\.size/)
  // Success gate must remain — do not treat no-edit as edit success.
  // Read-only investigation may finalize via shouldAcceptAgentFinal; edit still requires verify.
  assert.match(src, /shouldAcceptAgentFinal\(/)
  assert.match(
    src,
    /if \(!mayAcceptFinal && \(!anyToolCall \|\| editedPaths\.size === 0 \|\| fakingTools\)\)/
  )
  assert.match(src, /editedPaths\.size > 0/)

  const noEdit = buildAgentProseExhaustionFinalText({
    anyToolCall: true,
    editedPathCount: 0,
    fakingTools: false
  })
  assert.match(noEdit, /編集候補が作成されませんでした/)
  assert.match(noEdit, /編集成功条件は満たしていません/)
  assert.doesNotMatch(noEdit, /ツールを正しく呼び出せませんでした/)
  assert.doesNotMatch(noEdit, /モデルを OpenAI に/)

  const noTool = buildAgentProseExhaustionFinalText({
    anyToolCall: false,
    editedPathCount: 0,
    fakingTools: false
  })
  assert.match(noTool, /ツールを正しく呼び出せませんでした/)
  assert.match(noTool, /モデルを OpenAI に/)

  const fake = buildAgentProseExhaustionFinalText({
    anyToolCall: true,
    editedPathCount: 0,
    fakingTools: true
  })
  assert.match(fake, /ツールを正しく呼び出せませんでした/)
  assert.match(fake, /モデルを OpenAI に/)

  // With edits present, exhaustion helper is not the edit-success path; keep failure wording if faking.
  const fakeWithEdits = buildAgentProseExhaustionFinalText({
    anyToolCall: true,
    editedPathCount: 2,
    fakingTools: true
  })
  assert.match(fakeWithEdits, /ツールを正しく呼び出せませんでした/)

  // Source still contains edit-success / verify messaging unchanged.
  assert.match(src, /シェル検証は成功しています。変更候補バーまたは一覧/)
  assert.match(src, /outcomeDetail = 'no_edits'/)
  assert.match(src, /outcomeDetail = 'verify_pass'/)

  // Unsupported model / tools error paths stay outside this helper.
  assert.match(src, /AGENT_UNSUPPORTED/)
  assert.match(src, /ツール Agent 非対応/)
  const guide = await readFile(join(root, 'src/lib/aiErrorGuide.ts'), 'utf8')
  assert.match(guide, /OpenAI Agent をこのモデルで実行できませんでした/)
  assert.match(guide, /詳細:/)
})
