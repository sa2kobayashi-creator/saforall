import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

test('claude prepaid source helpers exist', async () => {
  const src = await readFile(join(root, 'electron/main/lib/claudePrepaid.ts'), 'utf8')
  assert.match(src, /export function getClaudePrepaidStatus/)
  assert.match(src, /export async function deductClaudePrepaid/)
  assert.match(src, /export async function markClaudePrepaidDepleted/)
  assert.match(src, /llm\.claude\.prepaid_remaining_usd/)
})

test('prepaid wiring in settings / usage / router', async () => {
  const settings = await readFile(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  assert.match(settings, /llm\.claude\.prepaid_remaining_usd/)
  assert.match(settings, /Anthropic（Claude）チャージ残/)
  const usage = await readFile(join(root, 'src/components/UsagePanel.tsx'), 'utf8')
  assert.match(usage, /claude_prepaid/)
  assert.match(usage, /Anthropic チャージ残/)
  const php = await readFile(join(root, 'server/src/AppSettings.php'), 'utf8')
  assert.match(php, /function claudePrepaidStatus/)
  assert.match(php, /function deductClaudePrepaid/)
  const router = await readFile(join(root, 'server/src/AiRouter.php'), 'utf8')
  assert.match(router, /claudePrepaidStatus\(\$settings\)\['depleted'\]/)
  const api = await readFile(join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(api, /markClaudePrepaidDepleted/)
})
