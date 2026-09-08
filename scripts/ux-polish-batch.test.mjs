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
  assert.match(formatAiUserError('fetch failed'), /タイムアウト|通信/)
  assert.match(formatAiUserError(''), /再送/)
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
  assert.match(bar, /すべて適用[\s\S]*差分を確認/)
  assert.match(app, /event\.shiftKey/)
  assert.match(app, /applyQueue\.length > 0/)
  assert.match(app, /acceptAllProposals/)
  assert.match(app, /すべて適用/)
})

test('Empty editor hints depend on workspace', () => {
  const editor = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(editor, /workspacePath \?/)
  assert.match(editor, /クイックオープン/)
  assert.match(editor, /フォルダを開くと/)
})
