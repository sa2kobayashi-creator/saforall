import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')

test('formatAiUserError guides rate limit / key / budget', async () => {
  const mod = await import(pathToFileURL(join(root, 'src/lib/aiErrorGuide.ts')).href)
  const { formatAiUserError } = mod
  assert.match(formatAiUserError('HTTP 429 Too Many Requests'), /レート制限/)
  assert.match(formatAiUserError('Invalid API key'), /API キー/)
  assert.match(formatAiUserError('USER_BUDGET_EXCEEDED'), /予算/)
  assert.match(
    formatAiUserError(
      'LLM HTTP 400: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits. (invalid_request_error)'
    ),
    /クレジット|Anthropic|OpenAI/
  )
  assert.match(
    formatAiUserError('session not found'),
    /セッション|新規/
  )
  assert.match(
    formatAiUserError(
      '[validation_error] The SCM integration does not have access to repository sa2kobayashi-creator/signboard to verify branch existence.'
    ),
    /Local|GitHub/
  )
  assert.match(formatAiUserError('fetch failed'), /タイムアウト|通信/)
  assert.match(formatAiUserError(''), /再送/)
})

test('formatAiUserError clarifies OpenAI Agent model path failures', async () => {
  const mod = await import(pathToFileURL(join(root, 'src/lib/aiErrorGuide.ts')).href)
  const { formatAiUserError } = mod

  const tools = formatAiUserError(
    'LLM HTTP 404: tools is not supported in this model. — このモデル/プロバイダは function calling 未対応の可能性があります。'
  )
  assert.match(tools, /OpenAI Agent をこのモデルで実行できませんでした/)
  assert.match(tools, /Chat Completions \+ tools/)
  assert.match(tools, /Ask モード/)
  assert.match(tools, /詳細:/)
  assert.match(tools, /tools is not supported/)

  const responses = formatAiUserError(
    'LLM HTTP 404: This model is not supported in the v1/chat/completions endpoint. Use the v1/responses endpoint instead.'
  )
  assert.match(responses, /OpenAI Agent をこのモデルで実行できませんでした/)
  assert.match(responses, /Chat Completions/)
  assert.match(responses, /Ask で試す/)
  assert.match(responses, /詳細:/)
  assert.match(responses, /v1\/responses/)
  assert.doesNotMatch(responses, /キー・モデルを確認してください。$/)

  const realtime = formatAiUserError(
    'LLM HTTP 404: This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?'
  )
  assert.match(realtime, /OpenAI Agent をこのモデルで実行できませんでした/)
  assert.match(realtime, /詳細:/)
  assert.match(realtime, /not a chat model/)

  // General auth errors stay on the existing key guidance path.
  assert.match(formatAiUserError('LLM HTTP 401: Incorrect API key provided'), /API キー/)
})

test('Settings save refreshes Chat LLM readiness', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
  const chat = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  const settings = readFileSync(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  assert.match(app, /settingsRevision/)
  assert.match(app, /onSaved=\{\(\) => \{[\s\S]*?setSettingsRevision\(\(n\) => n \+ 1\)/)
  assert.match(chat, /settingsRevision/)
  assert.match(chat, /\[backendConnected, settingsRevision\]/)
  assert.match(settings, /onSaved\?\./)
  assert.match(chat, /formatAiUserError/)
})

test('Composer accept-all shortcut and PendingEditsBar primary CTA', () => {
  const composer = readFileSync(join(root, 'src/components/ComposerPanel.tsx'), 'utf8')
  const bar = readFileSync(join(root, 'src/components/PendingEditsBar.tsx'), 'utf8')
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
  assert.match(composer, /event\.shiftKey\) onAcceptAll/)
  assert.match(composer, /Ctrl\+Shift\+Enter すべて適用/)
  assert.match(composer, /<strong>変更候補<\/strong>/)
  assert.match(bar, /すべて適用[\s\S]*差分を確認/)
  assert.match(app, /event\.shiftKey/)
  assert.match(app, /applyQueue\.length > 0/)
  assert.match(app, /applyQueue\.length >= 1/)
  assert.match(app, /acceptAllProposals/)
  assert.match(app, /すべて適用/)
})

test('Empty editor hints depend on workspace', () => {
  const editor = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(editor, /workspacePath \?/)
  assert.match(editor, /クイックオープン/)
  assert.match(editor, /フォルダを開くと/)
})
