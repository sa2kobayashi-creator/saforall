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

async function loadHelpers() {
  return import('../electron/main/ai/usageBillingUi.ts')
}

function plainEvent({
  provider = 'openai',
  status = 'ok',
  timestamp = '2026-09-01T12:00:00.000Z'
} = {}) {
  return {
    provider,
    model: provider || 'unknown',
    estimatedCost: 0.001,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider || 'x'}`,
    failover: null
  }
}

function hopEvent({
  provider,
  status,
  attempt,
  failoverId,
  reason = null,
  mode = 'ask',
  path,
  timestamp
}) {
  return {
    provider,
    model: provider,
    estimatedCost: 0.001,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider}`,
    failover: {
      primaryProvider: path[0],
      fallbackProvider: provider === path[0] ? null : provider,
      reason,
      attempt,
      failoverId,
      path,
      mode
    }
  }
}

function hourlyBlock(panel) {
  const start = panel.indexOf('All UsageEvent Provider Hourly Analysis')
  const end = panel.indexOf(
    '<h4 className="usage-subhead">All UsageEvent Data Completeness</h4>'
  )
  assert.ok(start >= 0 && end > start, 'Hourly section must precede Completeness heading')
  return panel.slice(start, end)
}

test('11c T1: Core basic aggregation across providers and hours', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderHourlyStatus([
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-13T05:10:00.000Z'
    }),
    plainEvent({
      provider: 'openai',
      status: 'error',
      timestamp: '2026-09-13T05:40:00.000Z'
    }),
    plainEvent({
      provider: 'gemini',
      status: 'ok',
      timestamp: '2026-09-13T05:50:00.000Z'
    }),
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-13T06:01:00.000Z'
    })
  ])
  assert.equal(analysis.rows.length, 3)
  const openai05 = analysis.rows.find(
    (r) => r.dateHour === '2026-09-13T05' && r.provider === 'openai'
  )
  const gemini05 = analysis.rows.find(
    (r) => r.dateHour === '2026-09-13T05' && r.provider === 'gemini'
  )
  const openai06 = analysis.rows.find(
    (r) => r.dateHour === '2026-09-13T06' && r.provider === 'openai'
  )
  assert.deepEqual(openai05, {
    dateHour: '2026-09-13T05',
    provider: 'openai',
    ok: 1,
    error: 1,
    total: 2
  })
  assert.deepEqual(gemini05, {
    dateHour: '2026-09-13T05',
    provider: 'gemini',
    ok: 1,
    error: 0,
    total: 1
  })
  assert.deepEqual(openai06, {
    dateHour: '2026-09-13T06',
    provider: 'openai',
    ok: 1,
    error: 0,
    total: 1
  })
})

test('11c T2: UTC dateHour extraction (no local TZ shift)', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderHourlyStatus([
    plainEvent({ timestamp: '2026-09-13T00:30:00.000Z' }),
    plainEvent({ timestamp: '2026-09-13T23:59:59.999Z' }),
    plainEvent({ timestamp: '2026-09-13 07:15:00.000Z' })
  ])
  assert.deepEqual(
    analysis.rows.map((r) => r.dateHour),
    ['2026-09-13T00', '2026-09-13T07', '2026-09-13T23']
  )
})

test('11c T3: provider trim / empty → ?', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderHourlyStatus([
    plainEvent({ provider: ' openai ', timestamp: '2026-09-13T05:00:00.000Z' }),
    plainEvent({ provider: '', timestamp: '2026-09-13T05:00:00.000Z' }),
    plainEvent({ provider: '   ', timestamp: '2026-09-13T05:00:00.000Z' })
  ])
  const byProvider = Object.fromEntries(analysis.rows.map((r) => [r.provider, r]))
  assert.equal(byProvider.openai.total, 1)
  assert.equal(byProvider['?'].total, 2)
})

test('11c T4: status ok / error / other matches Daily rules', async () => {
  const h = await loadHelpers()
  const events = [
    plainEvent({ status: 'ok', timestamp: '2026-09-13T05:00:00.000Z' }),
    plainEvent({ status: 'error', timestamp: '2026-09-13T05:10:00.000Z' }),
    plainEvent({ status: 'timeout', timestamp: '2026-09-13T05:20:00.000Z' }),
    plainEvent({ status: ' OK ', timestamp: '2026-09-13T05:30:00.000Z' })
  ]
  const hourly = h.analyzeUsageEventProviderHourlyStatus(events)
  const daily = h.analyzeUsageEventProviderDailyStatus(events)
  assert.equal(hourly.rows.length, 1)
  assert.equal(hourly.rows[0].ok, 1)
  assert.equal(hourly.rows[0].error, 1)
  assert.equal(hourly.rows[0].total, 4)
  assert.equal(daily.rows[0].ok, hourly.rows[0].ok)
  assert.equal(daily.rows[0].error, hourly.rows[0].error)
  assert.equal(daily.rows[0].total, hourly.rows[0].total)
})

test('11c T5: invalid timestamps excluded from hourly rows', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderHourlyStatus([
    plainEvent({ timestamp: 'not-a-date' }),
    plainEvent({ timestamp: '' }),
    plainEvent({ timestamp: '2026-09-13' }),
    plainEvent({ timestamp: '2026-09-32T05:00:00.000Z' }),
    null,
    undefined,
    'x',
    plainEvent({ timestamp: '2026-09-13T05:00:00.000Z' })
  ])
  assert.equal(analysis.rows.length, 1)
  assert.equal(analysis.rows[0].dateHour, '2026-09-13T05')
  assert.equal(analysis.rows[0].total, 1)
})

test('11c T6: sorting dateHour → provider', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderHourlyStatus([
    plainEvent({ provider: 'gemini', timestamp: '2026-09-13T06:00:00.000Z' }),
    plainEvent({ provider: 'openai', timestamp: '2026-09-13T05:00:00.000Z' }),
    plainEvent({ provider: 'claude', timestamp: '2026-09-13T05:30:00.000Z' }),
    plainEvent({ provider: 'openai', timestamp: '2026-09-13T06:10:00.000Z' })
  ])
  assert.deepEqual(
    analysis.rows.map((r) => `${r.dateHour}|${r.provider}`),
    [
      '2026-09-13T05|claude',
      '2026-09-13T05|openai',
      '2026-09-13T06|gemini',
      '2026-09-13T06|openai'
    ]
  )
})

test('11c T7: All UsageEvent — failoverId does not exclude', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_11c',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-13T05:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_11c',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T05:01:00.000Z'
    }),
    plainEvent({
      provider: 'gemini',
      status: 'ok',
      timestamp: '2026-09-13T05:02:00.000Z'
    })
  ]
  const analysis = h.analyzeUsageEventProviderHourlyStatus(events)
  assert.equal(analysis.rows.reduce((s, r) => s + r.total, 0), 3)
  assert.equal(analysis.rows.length, 3)
})

test('11c T8: localApi wires usage_event_provider_hourly from Core', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderHourlyStatus/)
  assert.match(
    local,
    /analyzeUsageEventProviderHourlyStatus\s*\(\s*usageEvents\s*\)/
  )
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
})

test('11c T9: existing sibling fields / dailyBuckets unchanged wiring', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)

  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderHourlyStatus')
  const fnEnd = billing.indexOf('export type UsageEventCompleteness', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains/)
  assert.doesNotMatch(fnBody, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /dailyBuckets/)
  assert.doesNotMatch(fnBody, /analyzeUsageEventProviderDailyStatus\s*\(/)
  assert.doesNotMatch(fnBody, /analyzeUsageEventCompleteness\s*\(/)
  assert.doesNotMatch(fnBody, /Date\.now\s*\(/)
  assert.doesNotMatch(fnBody, /windowStart|windowComplete|possiblyIncomplete/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /RAW_MAX_EVENTS/)
  assert.doesNotMatch(usage, /export const MAX_EVENTS\s*=\s*500\b/)
})

test('11c T10: UI direct display of usage_event_provider_hourly', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage_event_provider_hourly\?:/)
  assert.match(panel, /data\?\.router\?\.usage_event_provider_hourly/)
  assert.match(panel, /All UsageEvent Provider Hourly Analysis/)
  const block = hourlyBlock(panel)
  assert.match(block, /row\.dateHour/)
  assert.match(block, /row\.provider/)
  assert.match(block, /row\.ok/)
  assert.match(block, /row\.error/)
  assert.match(block, /row\.total/)
  assert.match(block, /Date Hour/)
})

test('11c T11: UI Hourly section does not reaggregate', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = hourlyBlock(panel)
  assert.doesNotMatch(block, /\.reduce\s*\(/)
  assert.doesNotMatch(block, /new Map\s*\(/)
  assert.doesNotMatch(block, /analyzeUsageEventProviderHourlyStatus/)
  assert.doesNotMatch(block, /events\.length/)
  assert.doesNotMatch(block, /Math\.max\s*\(/)
  assert.doesNotMatch(block, /Math\.min\s*\(/)
  assert.doesNotMatch(block, /Date\.parse/)
  assert.doesNotMatch(block, /slice\(-MAX_EVENTS/)
  assert.doesNotMatch(panel, /analyzeUsageEventProviderHourlyStatus\s*\(/)
})

test('11c T12: Forbidden / evaluation labels absent; exports registered', async () => {
  const block = hourlyBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(block, /Health|Risk|Problem Provider|Alert|Error Rate|Chart\.js/i)
  assert.doesNotMatch(block, /Healthy|Unhealthy|Critical|Warning/)
  assert.doesNotMatch(block, /問題Provider|問題 Provider/)
  assert.doesNotMatch(block, /windowComplete|Rolling|Date\.now/)
  assert.match(block, /最大 10,000/)
  assert.match(block, /完全な時間履歴ではありません/)
  assert.match(block, /Completeness/)

  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-11c\.test\.mjs/)
  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /\.usage-event-provider-hourly\b/)
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /analyzeUsageEventProviderHourlyStatus/)
  assert.match(usage, /UsageEventProviderHourlyAnalysis/)
  assert.match(index, /analyzeUsageEventProviderHourlyStatus/)
  assert.match(index, /UsageEventProviderHourlyStatus/)
})
