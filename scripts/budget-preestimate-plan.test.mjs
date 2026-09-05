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

test('UsageService estimates request cost and user plans', async () => {
  const usage = await read('server/src/UsageService.php')
  assert.match(usage, /function estimateRequestUsd/)
  assert.match(usage, /function canAffordRequest/)
  assert.match(usage, /function userCanAfford/)
  assert.match(usage, /USER_PLAN_LIMITS/)
  assert.match(usage, /'free' => 0\.5/)
  assert.match(usage, /'light' => 2\.0/)
  assert.match(usage, /'standard' => 5\.0/)
  assert.match(usage, /userBudgetSummary/)
})

test('AiRouter uses pre-estimate and user budget gates', async () => {
  const router = await read('server/src/AiRouter.php')
  assert.match(router, /estimateRequestUsd/)
  assert.match(router, /canAffordRequest/)
  assert.match(router, /USER_BUDGET_EXCEEDED/)
  assert.match(router, /estimated_usd/)
  assert.match(router, /composeBudgetWarning/)
})

test('APIs and UI expose estimated cost + user plan', async () => {
  const route = await read('server/api/ai_route.php')
  assert.match(route, /estimated_usd/)

  const usageApi = await read('server/api/ai_usage.php')
  assert.match(usageApi, /'user'/)

  const models = await read('src/lib/llmModels.ts')
  assert.match(models, /USER_PLAN_LIMITS/)
  assert.match(models, /parseUserPlan/)

  const settings = await read('src/components/SettingsPanel.tsx')
  assert.match(settings, /billing\.user_plan/)
  assert.match(settings, /ユーザープラン/)

  const usageUi = await read('src/components/UsagePanel.tsx')
  assert.match(usageUi, /data\.user/)
  assert.match(usageUi, /USER_PLAN_LABELS/)
})

test('docs cover spend-limit dualization and defer V2 agents', async () => {
  const spend = await read('docs/PROVIDER_SPEND_LIMITS.md')
  assert.match(spend, /OpenAI/)
  assert.match(spend, /Anthropic/)
  assert.match(spend, /Gemini/)
  assert.match(spend, /Hard stop/)

  const pipeline = await read('docs/PIPELINE.md')
  assert.match(pipeline, /推定コスト事前判定/)
  assert.match(pipeline, /ユーザープラン/)
  assert.match(pipeline, /PROVIDER_SPEND_LIMITS/)
  assert.match(pipeline, /V2 以降/)
  assert.match(pipeline, /Codex/)
  assert.match(pipeline, /Claude Code/)

  const mig = await read('server/sql/migration_budget_user_plan.sql')
  assert.match(mig, /billing\.user_plan/)
})
