import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('ApplyDiff shows dialog for one item; composer for multi', () => {
  const app = read('src/App.tsx')
  assert.match(app, /forceDiffDialog/)
  assert.match(app, /currentProposal !== null && forceDiffDialog/)
  assert.match(app, /composerOpen && applyQueue\.length >= 1/)
  assert.match(app, /onDismiss=\{\(\) => setForceDiffDialog\(false\)\}/)
})

test('Settings has tabs and export/import', () => {
  const settings = read('src/components/SettingsPanel.tsx')
  const main = read('electron/main/index.ts')
  const preload = read('electron/preload/index.ts')
  assert.match(settings, /settings-tabs/)
  assert.match(settings, /API キー/)
  assert.match(settings, /exportSettingsFile/)
  assert.match(settings, /importSettingsFile/)
  assert.match(main, /settings:exportFile/)
  assert.match(main, /settings:importFile/)
  assert.match(preload, /exportSettingsFile/)
})

test('Chat example prompts when ready', () => {
  const chat = read('src/components/ChatPanel.tsx')
  assert.match(chat, /chat-examples/)
  assert.match(chat, /Ask: 構成を説明/)
  assert.match(chat, /Agent: README 更新/)
})

test('Clickable notice and Problems AI fix', () => {
  const app = read('src/App.tsx')
  const problems = read('src/components/ProblemsPanel.tsx')
  const bottom = read('src/components/BottomPanel.tsx')
  assert.match(app, /is-actionable/)
  assert.match(app, /app-notice-action/)
  assert.match(app, /onAskAiFix=/)
  assert.match(problems, /onAskAi/)
  assert.match(problems, /problems-ask-ai/)
  assert.match(bottom, /onAskAi=\{onAskAiFix\}/)
})

test('Usage shows top engine summary', () => {
  const usage = read('src/components/UsagePanel.tsx')
  assert.match(usage, /usage-summary-line/)
  assert.match(usage, /いま一番使っているのは/)
})
