import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

test('workspaceIndex supports disk cache and incremental patch', () => {
  const src = readFileSync(join(root, 'electron/main/workspaceIndex.ts'), 'utf8')
  assert.match(src, /configureIndexCache/)
  assert.match(src, /refreshWorkspaceIndex/)
  assert.match(src, /patchWorkspaceIndex/)
  assert.match(src, /mtimes/)
  assert.match(src, /workspace-index-cache|CACHE_VERSION/)
})

test('settingsStore masks secrets for renderer', () => {
  const src = readFileSync(join(root, 'electron/main/settingsStore.ts'), 'utf8')
  assert.match(src, /maskSettingsForRenderer/)
  assert.match(src, /hasUsableLocalLlm/)
  assert.match(src, /mergeLocalSettings/)
  assert.match(src, /SECRET_SETTING_KEYS/)
  assert.doesNotMatch(src, /localStorage/)
})

test('direct LLM fallback and settings export exist', () => {
  const api = readFileSync(join(root, 'electron/main/api.ts'), 'utf8')
  const direct = readFileSync(join(root, 'electron/main/directLlm.ts'), 'utf8')
  const indexPhp = readFileSync(join(root, 'server/public/index.php'), 'utf8')
  const exportPhp = readFileSync(join(root, 'server/api/settings_export.php'), 'utf8')
  assert.match(api, /prepareLocalRoute|streamChatDirect/)
  assert.match(api, /syncSettingsFromServer/)
  assert.match(direct, /generateAssistantText|streamChatDirect/)
  assert.match(indexPhp, /settings\/export/)
  assert.match(exportPhp, /electron-main/)
})

test('UI wires local settings + local LLM mode', () => {
  const chat = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  const settings = readFileSync(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  const preload = readFileSync(join(root, 'electron/preload/index.ts'), 'utf8')
  const main = readFileSync(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(chat, /localLlmReady/)
  assert.match(chat, /ローカル LLM モード/)
  assert.match(settings, /putLocalSettings/)
  assert.match(settings, /getLocalSettings/)
  assert.match(preload, /hasLocalLlm/)
  assert.match(preload, /syncLocalSettings/)
  assert.match(main, /configureIndexCache/)
  assert.match(main, /patchWorkspaceIndex/)
  assert.match(main, /settings:putLocal/)
})
