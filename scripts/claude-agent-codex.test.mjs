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

test('toolAgent supports Anthropic Claude tool_use path', async () => {
  const src = await read('electron/main/toolAgent.ts')
  assert.match(src, /function callAnthropicMessages/)
  assert.match(src, /function callAgentLlm/)
  assert.match(src, /toAnthropicTools/)
  assert.match(src, /anthropic-version/)
  assert.match(src, /tool_use/)
  assert.doesNotMatch(
    src,
    /engine === 'workers' \|\| engine === 'gemini' \|\| engine === 'claude' \|\| engine === 'cursor'/
  )
  assert.match(src, /engine === 'claude' \|\| u\.includes\('anthropic\.com'\)/)
})

test('api allows Claude tool agent', async () => {
  const api = await read('electron/main/api.ts')
  assert.doesNotMatch(api, /Claude はツール Agent 未対応/)
  assert.match(api, /OpenAI または Claude/)
})

test('AiRouter allows Claude for Agent mode', async () => {
  const router = await read('server/src/AiRouter.php')
  assert.match(router, /\['workers', 'gemini'\]/)
  assert.doesNotMatch(router, /\['workers', 'gemini', 'claude'\]/)
  assert.match(router, /Claude は Anthropic tool_use/)
})

test('Codex model is preferred for coding tasks', async () => {
  const catalog = await read('server/src/ModelCatalog.php')
  assert.match(catalog, /gpt-5\.3-codex/)
  assert.match(catalog, /str_contains\(\(string\) \$row\['id'\], 'codex'\)/)

  const models = await read('src/lib/llmModels.ts')
  assert.match(models, /gpt-5\.3-codex/)
})

test('route log migration and recorder exist', async () => {
  const mig = await read('server/sql/migration_ai_route_log.sql')
  assert.match(mig, /ai_route_log/)
  const usage = await read('server/src/UsageService.php')
  assert.match(usage, /function recordRoute/)
  const chat = await read('server/src/ChatService.php')
  assert.match(chat, /recordRoute/)
})

test('PIPELINE roadmap covers daily-driver gaps', async () => {
  const doc = await read('docs/PIPELINE.md')
  assert.match(doc, /本格化ロードマップ/)
  assert.match(doc, /Claude でも Agent/)
  assert.match(doc, /Codex/)
  assert.match(doc, /運用ログ/)
  assert.match(doc, /マルチユーザー/)
})
