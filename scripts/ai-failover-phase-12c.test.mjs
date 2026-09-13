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

const NOW = Date.parse('2026-09-13T13:00:00.000Z')
const H1 = 60 * 60 * 1000
const H24 = 24 * 60 * 60 * 1000

test('12c T1: 1h windowStart exactly → included', async () => {
  const b = await loadBilling()
  const startTs = new Date(NOW - H1).toISOString()
  const result = b.analyzeUsageEventRolling(
    [plainEvent({ requestId: 'edge-start', timestamp: startTs })],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 1)
  assert.equal(result.windowStart, NOW - H1)
  assert.equal(result.windowEnd, NOW)
  assert.equal(result.oldestTimestamp, startTs)
})

test('12c T2: 1h windowEnd exactly → included', async () => {
  const b = await loadBilling()
  const endTs = new Date(NOW).toISOString()
  const result = b.analyzeUsageEventRolling(
    [plainEvent({ requestId: 'edge-end', timestamp: endTs })],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 1)
  assert.equal(result.newestTimestamp, endTs)
})

test('12c T3: 1h outside window → excluded', async () => {
  const b = await loadBilling()
  const outside = new Date(NOW - H1 - 1).toISOString()
  const result = b.analyzeUsageEventRolling(
    [plainEvent({ requestId: 'out', timestamp: outside })],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 0)
  assert.equal(result.ok, 0)
  assert.equal(result.error, 0)
  assert.equal(result.total, 0)
  assert.equal(result.oldestTimestamp, null)
  assert.equal(result.newestTimestamp, null)
})

test('12c T4: 24h boundary inclusive', async () => {
  const b = await loadBilling()
  const startTs = new Date(NOW - H24).toISOString()
  const inside = new Date(NOW - H24 + 1000).toISOString()
  const outside = new Date(NOW - H24 - 1).toISOString()
  const result = b.analyzeUsageEventRolling(
    [
      plainEvent({ requestId: 'edge', timestamp: startTs }),
      plainEvent({ requestId: 'in', timestamp: inside }),
      plainEvent({ requestId: 'out', timestamp: outside })
    ],
    H24,
    NOW
  )
  assert.equal(result.eventCount, 2)
  assert.deepEqual(
    [result.oldestTimestamp, result.newestTimestamp].sort(),
    [startTs, inside].sort()
  )
})

test('12c T5: 24h month-crossing includes prior month', async () => {
  const b = await loadBilling()
  const nowMs = Date.parse('2026-09-01T00:30:00.000Z')
  const priorMonth = '2026-08-31T00:30:00.000Z'
  const sameMonth = '2026-09-01T00:00:00.000Z'
  const tooOld = '2026-08-30T00:29:59.000Z'
  const rolling = b.analyzeUsageEventProviderRolling(
    [
      plainEvent({ requestId: 'aug', provider: 'openai', timestamp: priorMonth }),
      plainEvent({ requestId: 'sep', provider: 'claude', timestamp: sameMonth }),
      plainEvent({ requestId: 'old', timestamp: tooOld })
    ],
    nowMs
  )
  assert.equal(rolling['24h'].eventCount, 2)
  assert.equal(rolling['24h'].ok, 2)
  assert.equal(rolling['24h'].windowStart, nowMs - H24)
  assert.ok(rolling['24h'].byProvider.some((r) => r.provider === 'openai' && r.total === 1))
  assert.ok(rolling['24h'].byProvider.some((r) => r.provider === 'claude' && r.total === 1))
})

test('12c T6: future timestamp excluded', async () => {
  const b = await loadBilling()
  const future = new Date(NOW + 60_000).toISOString()
  const result = b.analyzeUsageEventRolling(
    [plainEvent({ requestId: 'future', timestamp: future })],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 0)
})

test('12c T7: invalid timestamp excluded (no correction)', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventRolling(
    [
      plainEvent({ requestId: 'bad', timestamp: 'not-a-date' }),
      plainEvent({ requestId: 'empty', timestamp: '' }),
      { ...plainEvent({ requestId: 'missing' }), timestamp: undefined }
    ],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 0)
  assert.equal(result.oldestTimestamp, null)
})

test('12c T8: empty window → zeros', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventProviderRolling([], NOW)
  assert.equal(result['1h'].eventCount, 0)
  assert.equal(result['1h'].ok, 0)
  assert.equal(result['1h'].error, 0)
  assert.equal(result['1h'].total, 0)
  assert.equal(result['24h'].eventCount, 0)
  assert.equal(result['24h'].oldestTimestamp, null)
  assert.equal(result['24h'].newestTimestamp, null)
})

test('12c T9: single event aggregated', async () => {
  const b = await loadBilling()
  const ts = '2026-09-13T12:30:00.000Z'
  const result = b.analyzeUsageEventRolling(
    [plainEvent({ requestId: 'one', provider: 'gemini', status: 'error', timestamp: ts })],
    H1,
    NOW
  )
  assert.equal(result.eventCount, 1)
  assert.equal(result.error, 1)
  assert.equal(result.ok, 0)
  assert.equal(result.total, 1)
  assert.equal(result.byProvider.length, 1)
  assert.equal(result.byProvider[0].provider, 'gemini')
  assert.equal(result.byProvider[0].error, 1)
})

test('12c T10: Failover multi UsageEvent counted as attempts', async () => {
  const b = await loadBilling()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_12c',
      reason: 'timeout',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:40:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_12c',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:41:00.000Z'
    })
  ]
  const result = b.analyzeUsageEventRolling(events, H1, NOW)
  assert.equal(result.eventCount, 2)
  assert.equal(result.error, 1)
  assert.equal(result.ok, 1)
  assert.equal(result.total, 2)
  assert.equal(result.byProvider.length, 2)
})

test('12c T11: provider breakdown uses existing provider values', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventRolling(
    [
      plainEvent({ provider: 'openai', status: 'ok', timestamp: '2026-09-13T12:10:00.000Z' }),
      plainEvent({ provider: 'openai', status: 'error', timestamp: '2026-09-13T12:20:00.000Z' }),
      plainEvent({ provider: 'claude', status: 'ok', timestamp: '2026-09-13T12:30:00.000Z' })
    ],
    H1,
    NOW
  )
  assert.deepEqual(
    result.byProvider.map((r) => `${r.provider}:${r.ok}/${r.error}/${r.total}`),
    ['claude:1/0/1', 'openai:1/1/2']
  )
})

test('12c T12: 10000-cap Raw — Rolling only counts present events', async () => {
  const r = await loadRetention()
  const b = await loadBilling()
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
  const rolling = b.analyzeUsageEventProviderRolling(kept, NOW)
  // Rolling observes Raw retained data only — not the original 10005 occurrences.
  assert.ok(rolling['24h'].eventCount <= 10000)
  assert.equal(rolling['24h'].eventCount, kept.length)
  assert.notEqual(rolling['24h'].eventCount, 10005)
})

test('12c T13: analyzeUsageEventProviderRolling returns 1h and 24h', async () => {
  const b = await loadBilling()
  assert.equal(b.ROLLING_WINDOW_1H_MS, H1)
  assert.equal(b.ROLLING_WINDOW_24H_MS, H24)
  const mid1h = new Date(NOW - 30 * 60 * 1000).toISOString()
  const mid24h = new Date(NOW - 12 * H1).toISOString()
  const rolling = b.analyzeUsageEventProviderRolling(
    [
      plainEvent({ requestId: 'near', timestamp: mid1h }),
      plainEvent({ requestId: 'far', timestamp: mid24h })
    ],
    NOW
  )
  assert.equal(rolling['1h'].eventCount, 1)
  assert.equal(rolling['24h'].eventCount, 2)
})

test('12c T14: localApi wires rolling from allEvents (not month filter)', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderRolling/)
  assert.match(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*allEvents\s*,\s*Date\.now\s*\(\s*\)\s*\)/
  )
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.doesNotMatch(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*usageEvents/
  )
})

test('12c T15: Rolling Core does not invent completeness / Chain helpers', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventRolling')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /windowComplete/)
  assert.doesNotMatch(fnBody, /fullyComplete/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains/)
  assert.doesNotMatch(fnBody, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /dailyBuckets/)
  assert.doesNotMatch(fnBody, /usage-daily/)
  assert.doesNotMatch(fnBody, /analyzeUsageEventProviderHourlyStatus/)
  // nowMs is a parameter — no unconditional Date.now() inside rolling body
  assert.doesNotMatch(fnBody, /Date\.now\s*\(\s*\)/)
})

test('12c T16: Retention constants unchanged', async () => {
  const r = await loadRetention()
  assert.equal(r.RAW_RETENTION_DAYS, 7)
  assert.equal(r.RAW_MAX_EVENTS, 10000)
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /RAW_MAX_EVENTS/)
  assert.doesNotMatch(usage, /export const MAX_EVENTS\s*=\s*500\b/)
})

test('12c T17: UI displays Rolling facts only', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /All UsageEvent Provider Rolling/)
  assert.match(panel, /Rolling 1h/)
  assert.match(panel, /Rolling 24h/)
  assert.match(panel, /usage_event_provider_rolling/)
  assert.match(panel, /Raw retained data based/)
  assert.doesNotMatch(panel, /windowComplete/)
  const rollingIdx = panel.indexOf('All UsageEvent Provider Rolling')
  const rollingBlock = panel.slice(rollingIdx, rollingIdx + 2500)
  assert.doesNotMatch(rollingBlock, /\bHealthy\b|\bUnhealthy\b|\bSafe\b|\bDanger\b|\bAlert\b/)
  assert.doesNotMatch(rollingBlock, /完全です|正常|異常|安全|危険/)
})

test('12c T18: existing sibling APIs still wired', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(
    local,
    /usage_event_provider_daily_retained:\s*usageEventProviderDailyRetained/
  )
})

test('12c T19: 12-C registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12c\.test\.mjs/)
})

test('12c T20: exports from usage / index', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /analyzeUsageEventRolling/)
  assert.match(usage, /analyzeUsageEventProviderRolling/)
  assert.match(usage, /UsageEventProviderRolling/)
  const index = await read('electron/main/ai/index.ts')
  assert.match(index, /analyzeUsageEventProviderRolling/)
  assert.match(index, /ROLLING_WINDOW_1H_MS/)
})
