import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

test('Claude client + migration keys exist', async () => {
  const client = await read('server/src/ClaudeClient.php')
  assert.match(client, /class ClaudeClient/)
  assert.match(client, /anthropic-version/)
  assert.match(client, /function chatStream/)

  const mig = await read('server/sql/migration_claude_router.sql')
  assert.match(mig, /llm\.claude\.api_key/)
  assert.match(mig, /cost\.claude\.monthly_usd/)
  assert.match(mig, /setting_key/)
  assert.match(mig, /\["openai","gemini","claude"\]/)
})

test('AiRouter defaults to OpenAI/Gemini/Claude with budget levels', async () => {
  const router = await read('server/src/AiRouter.php')
  assert.match(router, /DEFAULT_ENABLED = \['openai', 'gemini', 'claude'\]/)
  assert.match(router, /'claude'/)
  assert.match(router, /budget_warning/)
  assert.match(router, /warn85/)
  assert.match(router, /warn95/)
  assert.match(router, /'design' => 'claude'/)
  assert.match(router, /'patch_multi'.*'claude'/)

  const usage = await read('server/src/UsageService.php')
  assert.match(usage, /'claude' => 10\.0/)
  assert.match(usage, /function budgetLevel/)
  assert.match(usage, /warn70/)
})

test('Chat / settings / APIs wire Claude', async () => {
  const chat = await read('server/src/ChatService.php')
  assert.match(chat, /llm\.claude\.api_key/)
  assert.match(chat, /budget_warning/)

  const stream = await read('server/api/ai_chat_stream.php')
  assert.match(stream, /ClaudeClient::chatStream/)

  const plain = await read('server/api/ai_chat.php')
  assert.match(plain, /ClaudeClient::chat/)

  const testApi = await read('server/api/ai_test.php')
  assert.match(testApi, /claude/)

  const models = await read('server/api/ai_models.php')
  assert.match(models, /fetchClaudeModels/)

  const settings = await read('server/api/settings.php')
  assert.match(settings, /llm\.claude\.api_key/)
  assert.match(settings, /llm\.claude\.api_key_set/)

  const route = await read('server/api/ai_route.php')
  assert.match(route, /budget_warning/)
})

test('Frontend exposes Claude + product DEFAULT_ROUTER_ENGINES', async () => {
  const models = await read('src/lib/llmModels.ts')
  assert.match(models, /'claude'/)
  assert.match(models, /CLAUDE_MODEL_CATALOG/)
  assert.match(models, /claude: 10/)
  assert.match(models, /DEFAULT_ROUTER_ENGINES[\s\S]*'openai'[\s\S]*'gemini'[\s\S]*'claude'/)

  const chat = await read('src/components/ChatPanel.tsx')
  assert.match(chat, /value="claude"/)

  const settingsUi = await read('src/components/SettingsPanel.tsx')
  assert.match(settingsUi, /Claude モデル/)
  assert.match(settingsUi, /cost\.claude\.monthly_usd/)

  const usageUi = await read('src/components/UsagePanel.tsx')
  assert.match(usageUi, /pct >= 85/)
  assert.match(usageUi, /pct >= 70/)

  const types = await read('src/types.ts')
  assert.match(types, /'claude'/)
})

test('PIPELINE documents product Router without Cursor as API backend', async () => {
  const doc = await read('docs/PIPELINE.md')
  assert.match(doc, /OpenAI/)
  assert.match(doc, /Gemini/)
  assert.match(doc, /Claude/)
  assert.match(doc, /製品 Router の API 先にしない/)
  assert.match(doc, /70–85%/)
  assert.match(doc, /85–95%/)
})
