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

async function loadBilling() {
  return import('../electron/main/ai/usageBillingUi.ts')
}

function plainEvent({
  requestId = `req_${Math.random().toString(36).slice(2)}`,
  provider = 'openai',
  status = 'ok',
  timestamp = '2026-09-13T12:00:00.000Z'
} = {}) {
  return {
    requestId,
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
  requestId = `req_${Math.random().toString(36).slice(2)}`,
  provider,
  status,
  attempt,
  failoverId,
  reason = null,
  path,
  timestamp
}) {
  return {
    requestId,
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
      mode: 'ask'
    }
  }
}

const NOW = Date.parse('2026-09-13T12:00:00.000Z')

test('12b T1: Raw keeps events within 7 days', async () => {
  const r = await loadRetention()
  const kept = r.pruneUsageEventsForRetention(
    [
      plainEvent({ requestId: 'a', timestamp: '2026-09-13T11:00:00.000Z' }),
      plainEvent({ requestId: 'b', timestamp: '2026-09-07T12:00:00.000Z' }),
      plainEvent({ requestId: 'c', timestamp: '2026-09-06T11:59:59.000Z' })
    ],
    NOW
  )
  assert.deepEqual(
    kept.map((e) => e.requestId).sort(),
    ['a', 'b']
  )
})

test('12b T2: Raw prunes older than 7 days (UTC)', async () => {
  const r = await loadRetention()
  // exactly 7 days before NOW is kept (>= cutoff); 7d+1ms dropped
  const cutoffExact = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString()
  const older = new Date(NOW - 7 * 24 * 60 * 60 * 1000 - 1).toISOString()
  const kept = r.pruneUsageEventsForRetention(
    [
      plainEvent({ requestId: 'edge', timestamp: cutoffExact }),
      plainEvent({ requestId: 'old', timestamp: older })
    ],
    NOW
  )
  assert.equal(kept.length, 1)
  assert.equal(kept[0].requestId, 'edge')
})

test('12b T3: Raw count cap keeps newest 10000', async () => {
  const r = await loadRetention()
  const events = Array.from({ length: 10005 }, (_, i) =>
    plainEvent({
      requestId: `id_${i}`,
      timestamp: new Date(NOW - (10005 - i) * 1000).toISOString()
    })
  )
  const kept = r.pruneUsageEventsForRetention(events, NOW, {
    days: 7,
    maxEvents: 10000
  })
  assert.equal(kept.length, 10000)
  assert.equal(kept[0].requestId, 'id_5')
  assert.equal(kept[kept.length - 1].requestId, 'id_10004')
})

test('12b T4: day filter applies before count cap', async () => {
  const r = await loadRetention()
  const old = Array.from({ length: 50 }, (_, i) =>
    plainEvent({
      requestId: `old_${i}`,
      timestamp: '2026-08-01T00:00:00.000Z'
    })
  )
  const recent = Array.from({ length: 3 }, (_, i) =>
    plainEvent({
      requestId: `new_${i}`,
      timestamp: '2026-09-13T00:00:00.000Z'
    })
  )
  const kept = r.pruneUsageEventsForRetention([...old, ...recent], NOW, {
    days: 7,
    maxEvents: 10000
  })
  assert.equal(kept.length, 3)
  assert.ok(kept.every((e) => String(e.requestId).startsWith('new_')))
})

test('12b T5: invalid timestamp kept through day filter, dropped first on count cap', async () => {
  const r = await loadRetention()
  const keptDay = r.pruneUsageEventsForRetention(
    [
      plainEvent({ requestId: 'bad', timestamp: 'not-a-date' }),
      plainEvent({ requestId: 'ok', timestamp: '2026-09-13T00:00:00.000Z' })
    ],
    NOW
  )
  assert.equal(keptDay.length, 2)

  const over = r.pruneUsageEventsForRetention(
    [
      plainEvent({ requestId: 'bad', timestamp: 'not-a-date' }),
      plainEvent({ requestId: 'a', timestamp: '2026-09-13T00:00:00.000Z' }),
      plainEvent({ requestId: 'b', timestamp: '2026-09-13T01:00:00.000Z' })
    ],
    NOW,
    { days: 7, maxEvents: 2 }
  )
  assert.equal(over.length, 2)
  assert.equal(
    over.some((e) => e.requestId === 'bad'),
    false
  )
})

test('12b T6: Aggregate upsert ok/error/other + provider', async () => {
  const r = await loadRetention()
  let state = r.emptyUsageDailyAggregateFile()
  state = r.applyUsageEventToDailyAggregate(
    state,
    plainEvent({
      requestId: '1',
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-13T05:00:00.000Z'
    })
  )
  state = r.applyUsageEventToDailyAggregate(
    state,
    plainEvent({
      requestId: '2',
      provider: 'openai',
      status: 'error',
      timestamp: '2026-09-13T06:00:00.000Z'
    })
  )
  state = r.applyUsageEventToDailyAggregate(
    state,
    plainEvent({
      requestId: '3',
      provider: 'openai',
      status: 'timeout',
      timestamp: '2026-09-13T07:00:00.000Z'
    })
  )
  state = r.applyUsageEventToDailyAggregate(
    state,
    plainEvent({
      requestId: '4',
      provider: 'gemini',
      status: 'ok',
      timestamp: '2026-09-13T08:00:00.000Z'
    })
  )
  const openai = state.rows.find((row) => row.provider === 'openai')
  const gemini = state.rows.find((row) => row.provider === 'gemini')
  assert.deepEqual(openai, {
    date: '2026-09-13',
    provider: 'openai',
    ok: 1,
    error: 1,
    total: 3
  })
  assert.deepEqual(gemini, {
    date: '2026-09-13',
    provider: 'gemini',
    ok: 1,
    error: 0,
    total: 1
  })
})

test('12b T7: late event updates past UTC date', async () => {
  const r = await loadRetention()
  let state = r.emptyUsageDailyAggregateFile()
  state = r.applyUsageEventToDailyAggregate(
    state,
    plainEvent({
      requestId: 'late',
      timestamp: '2026-09-10T23:59:00.000Z'
    })
  )
  assert.equal(state.rows[0].date, '2026-09-10')
  assert.equal(state.rows[0].total, 1)
})

test('12b T8: same requestId not double-counted', async () => {
  const r = await loadRetention()
  const event = plainEvent({
    requestId: 'dup',
    timestamp: '2026-09-13T01:00:00.000Z'
  })
  let state = r.applyUsageEventToDailyAggregate(r.emptyUsageDailyAggregateFile(), event)
  state = r.applyUsageEventToDailyAggregate(state, event)
  assert.equal(state.rows[0].total, 1)
  assert.equal(state.processedRequestIds.filter((id) => id === 'dup').length, 1)
})

test('12b T9: reconcile replaces Raw-window dates; keeps older Aggregate', async () => {
  const r = await loadRetention()
  const billing = await loadBilling()
  const existing = {
    version: 1,
    processedRequestIds: [],
    rows: [
      { date: '2026-08-01', provider: 'openai', ok: 9, error: 1, total: 10 },
      { date: '2026-09-13', provider: 'openai', ok: 1, error: 0, total: 1 }
    ]
  }
  const raw = [
    plainEvent({
      requestId: 'r1',
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-13T02:00:00.000Z'
    }),
    plainEvent({
      requestId: 'r2',
      provider: 'openai',
      status: 'error',
      timestamp: '2026-09-13T03:00:00.000Z'
    })
  ]
  const next = r.reconcileDailyAggregateWithRaw(
    existing,
    raw,
    billing.analyzeUsageEventProviderDailyStatus
  )
  const aug = next.rows.find((row) => row.date === '2026-08-01')
  const sep = next.rows.find((row) => row.date === '2026-09-13')
  assert.deepEqual(aug, {
    date: '2026-08-01',
    provider: 'openai',
    ok: 9,
    error: 1,
    total: 10
  })
  assert.deepEqual(sep, {
    date: '2026-09-13',
    provider: 'openai',
    ok: 1,
    error: 1,
    total: 2
  })
  assert.deepEqual(next.processedRequestIds.sort(), ['r1', 'r2'])
})

test('12b T10: Aggregate population ignores Chain helpers; includes failover UsageEvents', async () => {
  const r = await loadRetention()
  const billing = await loadBilling()
  const events = [
    hopEvent({
      requestId: 'h1',
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_12b',
      path: ['openai'],
      timestamp: '2026-09-13T04:00:00.000Z'
    }),
    hopEvent({
      requestId: 'h2',
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_12b',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T04:01:00.000Z'
    }),
    plainEvent({
      requestId: 'p1',
      provider: 'gemini',
      timestamp: '2026-09-13T04:02:00.000Z'
    })
  ]
  const next = r.reconcileDailyAggregateWithRaw(
    r.emptyUsageDailyAggregateFile(),
    events,
    billing.analyzeUsageEventProviderDailyStatus
  )
  assert.equal(
    next.rows.reduce((s, row) => s + row.total, 0),
    3
  )
  const chain = billing.analyzeFailoverChains(billing.groupUsageEventsByFailoverId(events))
  assert.equal(chain.totalChains, 1)
  assert.notEqual(
    next.rows.reduce((s, row) => s + row.total, 0),
    chain.totalChains
  )

  const retentionSrc = await read('electron/main/ai/usageRetention.ts')
  assert.doesNotMatch(retentionSrc, /analyzeFailoverChains|groupUsageEventsByFailoverId/)
  assert.doesNotMatch(retentionSrc, /finalSuccess|finalFailed|dailyBuckets/)
})

test('12b T11: constants and MAX_EVENTS alias', async () => {
  const r = await loadRetention()
  assert.equal(r.RAW_RETENTION_DAYS, 7)
  assert.equal(r.RAW_MAX_EVENTS, 10000)
  assert.equal(r.MAX_EVENTS, 10000)
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /RAW_RETENTION_DAYS/)
  assert.match(usage, /RAW_MAX_EVENTS/)
  assert.match(usage, /usage-daily\.json/)
  assert.doesNotMatch(usage, /export const MAX_EVENTS\s*=\s*500\b/)
})

test('12b T12: API sibling wiring + existing fields preserved', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /listPersistedUsageDailyAggregate/)
  assert.match(
    local,
    /usage_event_provider_daily_retained:\s*usageEventProviderDailyRetained/
  )
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)
  assert.doesNotMatch(local, /Date\.now\(\)[\s\S]{0,40}windowStart/)
})

test('12b T13: UI direct display retained daily; no reaggregation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage_event_provider_daily_retained\?:/)
  assert.match(panel, /UsageEvent Provider Daily Aggregate — Retained/)
  const start = panel.indexOf('UsageEvent Provider Daily Aggregate — Retained')
  const end = panel.indexOf(
    '<h4 className="usage-subhead">All UsageEvent Data Completeness</h4>'
  )
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.match(block, /row\.date/)
  assert.match(block, /row\.provider/)
  assert.match(block, /row\.ok/)
  assert.match(block, /usageEventProviderDailyRetained\.dayCount/)
  assert.doesNotMatch(block, /\.reduce\s*\(/)
  assert.doesNotMatch(block, /new Map\s*\(/)
  assert.doesNotMatch(block, /analyzeUsageEventProviderDailyStatus/)
  assert.doesNotMatch(block, /Health|Risk|Alert|Error Rate|Chart/i)
  assert.doesNotMatch(block, /Rolling|windowComplete/)
})

test('12b T14: Forbidden Area + registration', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12b\.test\.mjs/)
  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /\.usage-event-provider-daily-retained\b/)
  const failover = await read('electron/main/ai/failover.ts')
  const router = await read('electron/main/ai/router.ts')
  assert.equal(failover.includes('usage-daily'), false)
  assert.equal(router.includes('usage-daily'), false)
  assert.equal(failover.includes('RAW_MAX_EVENTS'), false)
  const index = await read('electron/main/ai/index.ts')
  assert.match(index, /RAW_MAX_EVENTS/)
  assert.match(index, /listPersistedUsageDailyAggregate/)
})
