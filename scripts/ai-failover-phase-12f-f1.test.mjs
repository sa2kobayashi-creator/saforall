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

async function loadRetention() {
  return import('../electron/main/ai/usageRetention.ts')
}

test('12f-f1 T1: Daily Retained title clarifies Daily Aggregate', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /UsageEvent Provider Daily Aggregate — Retained/)
  assert.doesNotMatch(panel, /All UsageEvent Provider Daily Retained/)
})

test('12f-f1 T2: Daily Retained title must not say All UsageEvent', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('UsageEvent Provider Daily Aggregate — Retained')
  const end = panel.indexOf('All UsageEvent Data Completeness')
  assert.ok(start >= 0 && end > start)
  const heading = panel.slice(start, start + 80)
  assert.doesNotMatch(heading, /All UsageEvent/)
  const block = panel.slice(start, end)
  assert.match(block, /長期保持の Daily Aggregate/)
  assert.match(block, /daily_aggregate/)
  assert.match(block, /usage-daily\.json/)
})

test('12f-f1 T3: API name and metadata unchanged', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /usage_event_provider_daily_retained:\s*usageEventProviderDailyRetained/
  )
  assert.match(local, /listPersistedUsageDailyAggregate/)

  const r = await loadRetention()
  const summary = r.summarizeDailyAggregateRetained({
    version: 1,
    processedRequestIds: [],
    rows: [{ date: '2026-09-01', provider: 'openai', ok: 1, error: 0, total: 1 }]
  })
  assert.equal(summary.population, 'daily_aggregate')
  assert.equal(summary.source, 'usage-daily.json')
  assert.equal(summary.dayCount, 1)
  assert.ok(Array.isArray(summary.rows))
  assert.equal('oldestDate' in summary, true)
  assert.equal('newestDate' in summary, true)
})

test('12f-f1 T4: Retention / reconcile / schema untouched', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
  assert.match(retention, /export function reconcileDailyAggregateWithRaw/)
  assert.match(retention, /processedRequestIds/)
  assert.match(retention, /population:\s*'daily_aggregate'/)
  assert.match(retention, /source:\s*'usage-daily\.json'/)
})

test('12f-f1 T5: registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12f-f1\.test\.mjs/)
})
