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

test('UsageService exposes routeMonthInsight and hints', async () => {
  const usage = await read('server/src/UsageService.php')
  assert.match(usage, /function routeMonthInsight/)
  assert.match(usage, /function buildRouteHints/)
  assert.match(usage, /'router' => self::routeMonthInsight/)
  assert.match(usage, /フォールバック率が/)
  assert.match(usage, /gemini_for_mid_tasks/)
})

test('ai_usage API returns router insight', async () => {
  const api = await read('server/api/ai_usage.php')
  assert.match(api, /'router' => \$detail\['router'\]/)
})

test('UsagePanel renders Router section and hints', async () => {
  const ui = await read('src/components/UsagePanel.tsx')
  assert.match(ui, /Router 振り分け/)
  assert.match(ui, /data\.router/)
  assert.match(ui, /usage-hints/)
  assert.match(ui, /by_task/)
  assert.match(ui, /直近の判定/)
})

test('PIPELINE documents router log tuning UI', async () => {
  const doc = await read('docs/PIPELINE.md')
  assert.match(doc, /ai_route_log/)
  assert.match(doc, /振り分けヒント/)
  assert.match(doc, /Usage 画面に集計/)
})
