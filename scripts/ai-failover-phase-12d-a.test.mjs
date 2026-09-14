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

function plainEvent({
  requestId = `req_${Math.random().toString(36).slice(2)}`,
  provider = 'openai',
  model = 'gpt-4o',
  status = 'ok',
  timestamp = '2026-09-13T12:00:00.000Z'
} = {}) {
  return {
    requestId,
    provider,
    model,
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

function filterByRouterMonth(events, routerMonth) {
  return events.filter((e) => String(e?.timestamp ?? '').startsWith(routerMonth))
}

test('12d-a T1: Status API envelope has population=month and month', async () => {
  const b = await loadBilling()
  const wrapped = b.withMonthPopulationAnalysis(
    { rows: b.analyzeUsageEventProviderStatus([plainEvent()]) },
    '2026-09'
  )
  assert.equal(wrapped.population, 'month')
  assert.equal(wrapped.month, '2026-09')
  assert.ok(Array.isArray(wrapped.rows))

  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /withMonthPopulationAnalysis\s*\(\s*\{\s*rows:\s*analyzeUsageEventProviderStatus\s*\(\s*usageEvents\s*\)\s*\}\s*,\s*routerMonth\s*\)/
  )
})

test('12d-a T2: Daily API envelope has population=month and month', async () => {
  const b = await loadBilling()
  const wrapped = b.withMonthPopulationAnalysis(
    b.analyzeUsageEventProviderDailyStatus([plainEvent()]),
    '2026-09'
  )
  assert.equal(wrapped.population, 'month')
  assert.equal(wrapped.month, '2026-09')
  assert.ok(Array.isArray(wrapped.rows))
  assert.equal(typeof wrapped.eventCount, 'number')

  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /withMonthPopulationAnalysis\s*\(\s*analyzeUsageEventProviderDailyStatus\s*\(\s*usageEvents\s*\)\s*,\s*routerMonth\s*\)/
  )
})

test('12d-a T3: Hourly API envelope has population=month and month', async () => {
  const b = await loadBilling()
  const wrapped = b.withMonthPopulationAnalysis(
    b.analyzeUsageEventProviderHourlyStatus([plainEvent()]),
    '2026-09'
  )
  assert.equal(wrapped.population, 'month')
  assert.equal(wrapped.month, '2026-09')
  assert.ok(Array.isArray(wrapped.rows))

  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /withMonthPopulationAnalysis\s*\(\s*analyzeUsageEventProviderHourlyStatus\s*\(\s*usageEvents\s*\)\s*,\s*routerMonth\s*\)/
  )
})

test('12d-a T4: Status still uses analyzeUsageEventProviderStatus(usageEvents)', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderStatus\s*\(\s*usageEvents\s*\)/)
  assert.doesNotMatch(
    local,
    /analyzeUsageEventProviderStatus\s*\(\s*allEvents\s*\)/
  )
})

test('12d-a T5: Daily still uses analyzeUsageEventProviderDailyStatus(usageEvents)', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventProviderDailyStatus\s*\(\s*usageEvents\s*\)/
  )
  assert.doesNotMatch(
    local,
    /analyzeUsageEventProviderDailyStatus\s*\(\s*allEvents\s*\)/
  )
})

test('12d-a T6: Hourly still uses analyzeUsageEventProviderHourlyStatus(usageEvents)', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventProviderHourlyStatus\s*\(\s*usageEvents\s*\)/
  )
  assert.doesNotMatch(
    local,
    /analyzeUsageEventProviderHourlyStatus\s*\(\s*allEvents\s*\)/
  )
})

test('12d-a T7: month boundary — only routerMonth events enter Status/Daily/Hourly', async () => {
  const b = await loadBilling()
  const allEvents = [
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-08-31T23:59:00.000Z'
    }),
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-01T00:01:00.000Z'
    })
  ]
  const routerMonth = '2026-09'
  const usageEvents = filterByRouterMonth(allEvents, routerMonth)
  assert.equal(usageEvents.length, 1)
  assert.ok(usageEvents[0].timestamp.startsWith('2026-09'))

  const status = b.withMonthPopulationAnalysis(
    { rows: b.analyzeUsageEventProviderStatus(usageEvents) },
    routerMonth
  )
  assert.equal(status.rows.length, 1)
  assert.equal(status.rows[0].total, 1)
  assert.equal(status.population, 'month')
  assert.equal(status.month, '2026-09')

  const daily = b.withMonthPopulationAnalysis(
    b.analyzeUsageEventProviderDailyStatus(usageEvents),
    routerMonth
  )
  assert.equal(daily.eventCount, 1)
  assert.deepEqual(daily.rows, [
    { date: '2026-09-01', provider: 'openai', ok: 1, error: 0, total: 1 }
  ])

  const hourly = b.withMonthPopulationAnalysis(
    b.analyzeUsageEventProviderHourlyStatus(usageEvents),
    routerMonth
  )
  assert.equal(hourly.rows.length, 1)
  assert.equal(hourly.rows[0].total, 1)
  assert.match(hourly.rows[0].dateHour, /^2026-09-01T00/)
})

test('12d-a T8: Rolling still uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*allEvents\s*,\s*Date\.now\s*\(\s*\)\s*\)/
  )
})

test('12d-a T9: Completeness still uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventCompleteness\s*\(\s*allEvents\s*,\s*MAX_EVENTS\s*,\s*Date\.now\s*\(\s*\)\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
})

test('12d-a T10: Provider × Model still uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderModelStatus\s*\(\s*allEvents\s*\)/)
})

test('12d-a T11: Usage Metrics still uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventUsageMetrics\s*\(\s*allEvents\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
})

test('12d-a T12: existing response fields preserved (additive metadata only)', async () => {
  const b = await loadBilling()
  const dailyCore = b.analyzeUsageEventProviderDailyStatus([plainEvent()])
  const daily = b.withMonthPopulationAnalysis(dailyCore, '2026-09')
  for (const key of Object.keys(dailyCore)) {
    assert.ok(key in daily, `daily must keep ${key}`)
  }
  assert.equal(daily.population, 'month')
  assert.equal(daily.month, '2026-09')

  const hourlyCore = b.analyzeUsageEventProviderHourlyStatus([plainEvent()])
  const hourly = b.withMonthPopulationAnalysis(hourlyCore, '2026-09')
  for (const key of Object.keys(hourlyCore)) {
    assert.ok(key in hourly, `hourly must keep ${key}`)
  }

  const statusRows = b.analyzeUsageEventProviderStatus([plainEvent()])
  const status = b.withMonthPopulationAnalysis({ rows: statusRows }, '2026-09')
  assert.ok(Array.isArray(status.rows))
  assert.deepEqual(Object.keys(status.rows[0]).sort(), [
    'error',
    'ok',
    'provider',
    'total'
  ])
})

test('12d-a T13: UI must not say All UsageEvent for Status/Daily/Hourly', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /All UsageEvent Provider Status/)
  assert.doesNotMatch(panel, /All UsageEvent Provider Daily Analysis/)
  assert.doesNotMatch(panel, /All UsageEvent Provider Hourly Analysis/)
})

test('12d-a T14: UI shows Population: Month for Status/Daily/Hourly', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /UsageEvent Provider Status — Monthly Population/)
  assert.match(panel, /UsageEvent Provider Daily Analysis — Monthly Population/)
  assert.match(panel, /UsageEvent Provider Hourly Analysis — Monthly Population/)
  const statusStart = panel.indexOf('UsageEvent Provider Status — Monthly Population')
  const dailyStart = panel.indexOf(
    'UsageEvent Provider Daily Analysis — Monthly Population'
  )
  const hourlyStart = panel.indexOf(
    'UsageEvent Provider Hourly Analysis — Monthly Population'
  )
  assert.ok(statusStart >= 0 && dailyStart > statusStart && hourlyStart > dailyStart)
  assert.match(panel.slice(statusStart, dailyStart), /Population: Month/)
  assert.match(panel.slice(dailyStart, hourlyStart), /Population: Month/)
  assert.match(
    panel.slice(hourlyStart, hourlyStart + 800),
    /Population: Month/
  )
})

test('12d-a T15: no Health/Risk/Alert/complete evaluation on Status/Daily/Hourly path', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const helperStart = billing.indexOf('export function withMonthPopulationAnalysis')
  const helperEnd = billing.indexOf(
    'export type UsageEventProviderDailyStatus',
    helperStart
  )
  const helperBody = billing.slice(helperStart, helperEnd)
  assert.doesNotMatch(helperBody, /complete|windowComplete|fullyComplete|isComplete/)
  assert.doesNotMatch(helperBody, /Health|Risk|Alert|Threshold/)

  const panel = await read('src/components/UsagePanel.tsx')
  const statusStart = panel.indexOf('UsageEvent Provider Status — Monthly Population')
  const retainedStart = panel.indexOf('UsageEvent Provider Daily Aggregate — Retained')
  const block = panel.slice(statusStart, retainedStart)
  assert.doesNotMatch(block, /windowComplete|fullyComplete|isComplete|possiblyIncomplete/)
  assert.doesNotMatch(block, /\bAlert\b|\bThreshold\b/)
  assert.doesNotMatch(block, /問題Provider|危険|不健康/)
})

test('12d-a T16: Retention constants unchanged', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
})

test('12d-a T17: Failover attempt meaning / wiring unchanged', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeFailoverChains\s*\(\s*routerFailoverChainSummaries\s*\)/)
  assert.match(local, /groupUsageEventsByFailoverId\s*\(\s*usageEvents\s*\)/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)
  assert.doesNotMatch(local, /analyzeFailoverChains\s*\(\s*allEvents/)

  const failover = await read('electron/main/ai/failover.ts')
  assert.match(failover, /attempt/)
})

test('12d-a T18: Core analyzers remain population-agnostic (no month filter inside)', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  for (const name of [
    'analyzeUsageEventProviderStatus',
    'analyzeUsageEventProviderDailyStatus',
    'analyzeUsageEventProviderHourlyStatus'
  ]) {
    const start = billing.indexOf(`export function ${name}`)
    assert.ok(start >= 0, name)
    const end = billing.indexOf('\nexport ', start + 10)
    const body = billing.slice(start, end > start ? end : start + 2500)
    assert.doesNotMatch(body, /startsWith\s*\(\s*routerMonth/)
    assert.doesNotMatch(body, /population:\s*['"]month['"]/)
    assert.doesNotMatch(body, /YYYY-MM/)
  }
})

test('12d-a T19: Completeness/Rolling keep population raw (no month metadata required)', async () => {
  const b = await loadBilling()
  const completeness = b.analyzeUsageEventCompleteness(
    [plainEvent()],
    10000,
    Date.parse('2026-09-13T12:00:00.000Z'),
    7
  )
  assert.equal(completeness.population, 'raw')
  assert.equal('month' in completeness, false)

  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
})

test('12d-a T20: registered in run-all-tests; exports present', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12d-a\.test\.mjs/)
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /withMonthPopulationAnalysis/)
  assert.match(usage, /UsageEventProviderStatusAnalysis/)
  assert.match(index, /withMonthPopulationAnalysis/)
  assert.match(index, /UsageEventProviderStatusAnalysis/)
})
