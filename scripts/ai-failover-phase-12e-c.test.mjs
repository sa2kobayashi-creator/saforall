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

async function loadBilling() {
  return import('../electron/main/ai/usageBillingUi.ts')
}

async function loadRetention() {
  return import('../electron/main/ai/usageRetention.ts')
}

const NOW = Date.parse('2026-09-13T12:00:00.000Z')
const H1 = 60 * 60 * 1000

function plainEvent({
  provider = 'openai',
  status = 'ok',
  timestamp = '2026-09-13T11:30:00.000Z'
} = {}) {
  return {
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    provider,
    model: 'm',
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedCost: 0.01,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider}`,
    failover: null
  }
}

test('12e-c T1: Rolling API exists and wires allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*allEvents\s*,\s*Date\.now\s*\(\s*\)\s*\)/
  )
  assert.doesNotMatch(local, /analyzeUsageEventProviderRolling\s*\(\s*usageEvents/)
})

test('12e-c T2: Rolling population is raw', async () => {
  const b = await loadBilling()
  const rolling = b.analyzeUsageEventProviderRolling([plainEvent()], NOW)
  assert.equal(rolling.population, 'raw')
})

test('12e-c T3: Rolling keeps 1h / 24h and window fields', async () => {
  const b = await loadBilling()
  const rolling = b.analyzeUsageEventProviderRolling([plainEvent()], NOW)
  assert.ok(rolling['1h'])
  assert.ok(rolling['24h'])
  for (const key of ['1h', '24h']) {
    const win = rolling[key]
    assert.equal(typeof win.windowStart, 'number')
    assert.equal(typeof win.windowEnd, 'number')
    assert.equal(typeof win.eventCount, 'number')
    assert.ok(Array.isArray(win.byProvider))
    assert.equal('oldestTimestamp' in win, true)
    assert.equal('newestTimestamp' in win, true)
  }
  assert.equal(rolling['1h'].windowEnd, NOW)
  assert.equal(rolling['1h'].windowStart, NOW - H1)
  assert.equal(rolling['24h'].windowStart, NOW - 24 * H1)
})

test('12e-c T4: Rolling excludes invalid timestamps', async () => {
  const b = await loadBilling()
  const win = b.analyzeUsageEventRolling(
    [
      plainEvent({ timestamp: '2026-09-13T11:30:00.000Z' }),
      plainEvent({ timestamp: '' }),
      plainEvent({ timestamp: 'not-a-date' })
    ],
    H1,
    NOW
  )
  assert.equal(win.eventCount, 1)
})

test('12e-c T5: Rolling excludes future timestamps', async () => {
  const b = await loadBilling()
  const win = b.analyzeUsageEventRolling(
    [
      plainEvent({ timestamp: '2026-09-13T11:30:00.000Z' }),
      plainEvent({ timestamp: '2026-09-13T12:00:01.000Z' })
    ],
    H1,
    NOW
  )
  assert.equal(win.eventCount, 1)
})

test('12e-c T6: Daily Retained API exists and reads aggregate', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /usage_event_provider_daily_retained:\s*usageEventProviderDailyRetained/
  )
  assert.match(local, /listPersistedUsageDailyAggregate/)
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /usage-daily\.json/)
  assert.match(usage, /summarizeDailyAggregateRetained/)
})

test('12e-c T7: Daily Retained population=daily_aggregate and source', async () => {
  const r = await loadRetention()
  const summary = r.summarizeDailyAggregateRetained({
    version: 1,
    processedRequestIds: [],
    rows: [
      { date: '2026-09-01', provider: 'openai', ok: 1, error: 0, total: 1 }
    ]
  })
  assert.equal(summary.population, 'daily_aggregate')
  assert.equal(summary.source, 'usage-daily.json')
  assert.notEqual(summary.population, 'raw')
  assert.equal(summary.dayCount, 1)
  assert.equal(summary.oldestDate, '2026-09-01')
  assert.equal(summary.newestDate, '2026-09-01')
  assert.equal(summary.rows.length, 1)
})

test('12e-c T8: Daily Retained empty still has population metadata', async () => {
  const r = await loadRetention()
  const summary = r.summarizeDailyAggregateRetained(r.emptyUsageDailyAggregateFile())
  assert.equal(summary.population, 'daily_aggregate')
  assert.equal(summary.source, 'usage-daily.json')
  assert.equal(summary.dayCount, 0)
  assert.deepEqual(summary.rows, [])
})

test('12e-c T9: UI shows Rolling Population Raw', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Provider Rolling')
  assert.ok(start >= 0)
  const block = panel.slice(start, start + 1200)
  assert.match(block, /Population/)
  assert.match(block, /usageEventProviderRolling\.population \?\? 'raw'/)
  assert.match(block, /Raw retained data based/)
  assert.doesNotMatch(block, /Monthly Population/)
  assert.doesNotMatch(block, /population=['"]month['"]/)
})

test('12e-c T10: UI shows Daily Retained as Daily Aggregate', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Provider Daily Retained')
  const end = panel.indexOf('All UsageEvent Data Completeness')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.match(block, /Population/)
  assert.match(block, /daily_aggregate/)
  assert.match(block, /usage-daily\.json/)
  assert.match(block, /長期保持の Daily Aggregate/)
  assert.doesNotMatch(block, /All UsageEvent 母集団/)
  assert.doesNotMatch(block, /Monthly Population/)
  assert.doesNotMatch(block, /population=['"]raw['"]/)
})

test('12e-c T11: Retention constants unchanged', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
})

test('12e-c T12: no Health/Risk/Alert/complete; no reverse aggregation', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const rollStart = billing.indexOf('export function analyzeUsageEventProviderRolling')
  const rollEnd = billing.indexOf('export type UsageEventProviderModelStatus', rollStart)
  const rollBody = billing.slice(rollStart, rollEnd)
  assert.doesNotMatch(rollBody, /Healthy|Unhealthy|Alert|Threshold|windowComplete/)
  assert.doesNotMatch(rollBody, /usage-daily|reconcileDailyAggregate/)
  assert.doesNotMatch(rollBody, /analyzeFailoverChains|groupUsageEventsByFailoverId/)

  const retention = await read('electron/main/ai/usageRetention.ts')
  const sumStart = retention.indexOf('export function summarizeDailyAggregateRetained')
  const sumBody = retention.slice(sumStart, sumStart + 800)
  assert.doesNotMatch(sumBody, /Healthy|Unhealthy|Alert|windowComplete|Rolling/)
  assert.match(sumBody, /population:\s*'daily_aggregate'/)
  assert.doesNotMatch(sumBody, /population:\s*'raw'/)

  const panel = await read('src/components/UsagePanel.tsx')
  const rollUi = panel.slice(
    panel.indexOf('All UsageEvent Provider Rolling'),
    panel.indexOf('All UsageEvent Provider Rolling') + 1800
  )
  assert.doesNotMatch(rollUi, /\bHealthy\b|\bUnhealthy\b|\bAlert\b|\bRisk\b/)
  assert.doesNotMatch(rollUi, /windowComplete|fullyComplete/)
})

test('12e-c T13: sibling APIs / reconcile unchanged wiring', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_model:\s*usageEventProviderModel/)
  assert.match(local, /usage_event_usage_metrics:\s*usageEventUsageMetrics/)
  assert.match(local, /usage_event_billing_mode:\s*usageEventBillingMode/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /reconcileDailyAggregateWithRaw/)
})

test('12e-c T14: registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12e-c\.test\.mjs/)
})
