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

test('12c-comp T1: multiple valid events → eventCount / oldest / newest', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: '2026-09-10T08:00:00.000Z' }),
      plainEvent({ timestamp: '2026-09-12T18:00:00.000Z' }),
      plainEvent({ timestamp: '2026-09-11T12:00:00.000Z' })
    ],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 3)
  assert.equal(result.oldestTimestamp, '2026-09-10T08:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-12T18:00:00.000Z')
  assert.equal(result.retentionDays, 7)
  assert.equal(result.population, 'raw')
  assert.equal(result.possiblyTruncated, false)
})

test('12c-comp T2: empty events → zeros / null timestamps', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness([], 10000, NOW, 7)
  assert.equal(result.eventCount, 0)
  assert.equal(result.oldestTimestamp, null)
  assert.equal(result.newestTimestamp, null)
  assert.equal(result.invalidTimestampCount, 0)
  assert.equal(result.futureEventCount, 0)
  assert.equal(result.possiblyTruncated, false)
})

test('12c-comp T3: single event', async () => {
  const b = await loadBilling()
  const ts = '2026-09-13T12:30:00.000Z'
  const result = b.analyzeUsageEventCompleteness(
    [plainEvent({ requestId: 'one', timestamp: ts })],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 1)
  assert.equal(result.oldestTimestamp, ts)
  assert.equal(result.newestTimestamp, ts)
})

test('12c-comp T4: multiple providers counted as UsageEvents', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ provider: 'openai', timestamp: '2026-09-13T10:00:00.000Z' }),
      plainEvent({ provider: 'claude', timestamp: '2026-09-13T11:00:00.000Z' }),
      plainEvent({ provider: 'gemini', timestamp: '2026-09-13T12:00:00.000Z' })
    ],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 3)
  assert.equal(result.oldestTimestamp, '2026-09-13T10:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-13T12:00:00.000Z')
})

test('12c-comp T5: Failover multi UsageEvent counted as attempts', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_comp',
        reason: 'timeout',
        path: ['openai', 'claude'],
        timestamp: '2026-09-13T12:40:00.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'ok',
        attempt: 2,
        failoverId: 'fo_comp',
        reason: 'success',
        path: ['openai', 'claude'],
        timestamp: '2026-09-13T12:41:00.000Z'
      })
    ],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 2)
})

test('12c-comp T6: invalid timestamp counted, not corrected', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: 'not-a-date' }),
      plainEvent({ timestamp: '2026-09-13T12:00:00.000Z' })
    ],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 2)
  assert.equal(result.invalidTimestampCount, 1)
  assert.equal(result.oldestTimestamp, '2026-09-13T12:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-13T12:00:00.000Z')
})

test('12c-comp T7: empty timestamp counted as invalid', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [plainEvent({ timestamp: '' }), { ...plainEvent(), timestamp: undefined }],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 2)
  assert.equal(result.invalidTimestampCount, 2)
  assert.equal(result.oldestTimestamp, null)
  assert.equal(result.newestTimestamp, null)
})

test('12c-comp T8: future timestamp fact (not rewritten)', async () => {
  const b = await loadBilling()
  const future = '2026-09-13T14:00:00.000Z'
  const past = '2026-09-13T12:00:00.000Z'
  const result = b.analyzeUsageEventCompleteness(
    [plainEvent({ timestamp: past }), plainEvent({ timestamp: future })],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 2)
  assert.equal(result.futureEventCount, 1)
  assert.equal(result.newestTimestamp, future)
  assert.equal(result.oldestTimestamp, past)
})

test('12c-comp T9: 10000 cap → possiblyTruncated true is not complete', async () => {
  const b = await loadBilling()
  const events = Array.from({ length: 10000 }, (_, i) =>
    plainEvent({
      requestId: `id_${i}`,
      timestamp: new Date(NOW - i * 1000).toISOString()
    })
  )
  const result = b.analyzeUsageEventCompleteness(events, 10000, NOW, 7)
  assert.equal(result.eventCount, 10000)
  assert.equal(result.maxEvents, 10000)
  assert.equal(result.possiblyTruncated, true)
  assert.equal(result.population, 'raw')
})

test('12c-comp T10: 7-day retention constant / boundary facts', async () => {
  const r = await loadRetention()
  const b = await loadBilling()
  assert.equal(r.RAW_RETENTION_DAYS, 7)
  assert.equal(r.RAW_MAX_EVENTS, 10000)
  const cutoff = NOW - 7 * 24 * 60 * 60 * 1000
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: new Date(cutoff).toISOString() }),
      plainEvent({ timestamp: new Date(NOW - 1000).toISOString() })
    ],
    10000,
    NOW,
    r.RAW_RETENTION_DAYS
  )
  assert.equal(result.retentionDays, 7)
  assert.equal(result.eventCount, 2)
  // Completeness does not invent complete=true from oldest <= cutoff
  assert.equal('complete' in result, false)
  assert.equal('windowComplete' in result, false)
})

test('12c-comp T11: empty/fallback input is not asserted as real zero occurrence', async () => {
  const b = await loadBilling()
  // Simulates readJsonFile fallback → { events: [] } reaching Completeness
  const result = b.analyzeUsageEventCompleteness([], 10000, NOW, 7)
  assert.equal(result.eventCount, 0)
  assert.equal(result.population, 'raw')
  assert.equal(result.possiblyTruncated, false)
  // No complete/sourceReadStatus guarantee field asserting "really zero occurred"
  assert.equal('complete' in result, false)
  assert.equal('sourceReadStatus' in result, false)
})

test('12c-comp T12: duplicate requestId — Completeness has no own dedupe', async () => {
  const b = await loadBilling()
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventCompleteness')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /byId|dedupe|requestId/)
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ requestId: 'same', timestamp: '2026-09-13T10:00:00.000Z' }),
      plainEvent({ requestId: 'same', timestamp: '2026-09-13T11:00:00.000Z' })
    ],
    10000,
    NOW,
    7
  )
  // Core Completeness counts list entries as given (pre-Map input).
  assert.equal(result.eventCount, 2)
})

test('12c-comp T13: nowMs injectable for future classification', async () => {
  const b = await loadBilling()
  const ts = '2026-09-13T12:30:00.000Z'
  const early = b.analyzeUsageEventCompleteness(
    [plainEvent({ timestamp: ts })],
    10000,
    Date.parse('2026-09-13T12:00:00.000Z'),
    7
  )
  const late = b.analyzeUsageEventCompleteness(
    [plainEvent({ timestamp: ts })],
    10000,
    Date.parse('2026-09-13T13:00:00.000Z'),
    7
  )
  assert.equal(early.futureEventCount, 1)
  assert.equal(late.futureEventCount, 0)
})

test('12c-comp T14: UTC ISO timestamps compared via epoch ms', async () => {
  const b = await loadBilling()
  const result = b.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: '2026-09-01T00:00:00.000Z' }),
      plainEvent({ timestamp: '2026-09-01T00:00:00.000+00:00' })
    ],
    10000,
    NOW,
    7
  )
  assert.equal(result.eventCount, 2)
  assert.ok(result.oldestTimestamp)
  assert.ok(result.newestTimestamp)
})

test('12c-comp T15: Completeness Core does not use local timezone date buckets', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventCompleteness')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /getTimezoneOffset|toLocaleString|Asia\/Tokyo|JST/)
  assert.doesNotMatch(fnBody, /extractUtcDate|extractUtcDateHour/)
})

test('12c-comp T16: oldest <= cutoff does not invent complete=true', async () => {
  const b = await loadBilling()
  const cutoff = NOW - 7 * 24 * 60 * 60 * 1000
  const result = b.analyzeUsageEventCompleteness(
    [plainEvent({ timestamp: new Date(cutoff).toISOString() })],
    10000,
    NOW,
    7
  )
  assert.ok(Date.parse(result.oldestTimestamp) <= cutoff)
  assert.equal(result.possiblyTruncated, false)
  assert.equal('complete' in result, false)
  assert.equal('isComplete' in result, false)
  assert.equal('fullyComplete' in result, false)
  assert.equal('windowComplete' in result, false)
})

test('12c-comp T17: no windowComplete / complete guarantee fields', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export type UsageEventCompleteness')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  const block = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(block, /windowComplete/)
  assert.doesNotMatch(block, /\bcomplete\s*:/)
  assert.doesNotMatch(block, /isComplete/)
  assert.doesNotMatch(block, /fullyComplete/)
  assert.doesNotMatch(block, /possiblyIncomplete/)
})

test('12c-comp T18: no Health/Risk/Alert evaluation', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventCompleteness')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /Healthy|Unhealthy|Risk|Alert|Threshold|errorRate/)
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Data Completeness')
  const end = panel.indexOf('All UsageEvent Provider Rolling')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\bHealthy\b|\bUnhealthy\b|\bSafe\b|\bDanger\b|\bAlert\b/)
  assert.doesNotMatch(block, /Complete\b(?!ness)/)
})

test('12c-comp T19: sibling Status/Daily/Hourly/Rolling wiring intact; Completeness uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(
    local,
    /analyzeUsageEventCompleteness\s*\(\s*allEvents\s*,\s*MAX_EVENTS\s*,\s*Date\.now\s*\(\s*\)\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
  assert.doesNotMatch(local, /analyzeUsageEventCompleteness\s*\(\s*usageEvents\s*,/)
})

test('12c-comp T20: registered in run-all-tests; Retention constants unchanged', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12c-completeness\.test\.mjs/)
  assert.match(runAll, /ai-failover-phase-12c\.test\.mjs/)
  const r = await loadRetention()
  assert.equal(r.RAW_RETENTION_DAYS, 7)
  assert.equal(r.RAW_MAX_EVENTS, 10000)
  assert.equal(r.MAX_EVENTS, 10000)
})
