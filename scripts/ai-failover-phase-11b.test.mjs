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
    model: provider,
    estimatedCost: 0.001,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider}`,
    failover: null
  }
}

function completenessBlock(panel) {
  const start = panel.indexOf('All UsageEvent Data Completeness')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

test('11b T1: basic completeness fields', async () => {
  const h = await loadHelpers()
  const result = h.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: '2026-09-01T08:00:00.000Z' }),
      plainEvent({ timestamp: '2026-09-03T18:00:00.000Z' }),
      plainEvent({ timestamp: '2026-09-02T12:00:00.000Z' })
    ],
    500
  )
  assert.equal(result.eventCount, 3)
  assert.equal(result.maxEvents, 500)
  assert.equal(result.oldestTimestamp, '2026-09-01T08:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-03T18:00:00.000Z')
  assert.equal(result.possiblyTruncated, false)
})

test('11b T2: empty input is safe', async () => {
  const h = await loadHelpers()
  assert.deepEqual(h.analyzeUsageEventCompleteness([], 500), {
    eventCount: 0,
    maxEvents: 500,
    oldestTimestamp: null,
    newestTimestamp: null,
    possiblyTruncated: false
  })
  assert.deepEqual(h.analyzeUsageEventCompleteness(null, 500), {
    eventCount: 0,
    maxEvents: 500,
    oldestTimestamp: null,
    newestTimestamp: null,
    possiblyTruncated: false
  })
  assert.deepEqual(h.analyzeUsageEventCompleteness(undefined, 500), {
    eventCount: 0,
    maxEvents: 500,
    oldestTimestamp: null,
    newestTimestamp: null,
    possiblyTruncated: false
  })
})

test('11b T3: malformed events skipped without throw', async () => {
  const h = await loadHelpers()
  const result = h.analyzeUsageEventCompleteness(
    [null, undefined, 'x', 42, plainEvent({ timestamp: '2026-09-01T12:00:00.000Z' })],
    500
  )
  assert.equal(result.eventCount, 1)
  assert.equal(result.oldestTimestamp, '2026-09-01T12:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-01T12:00:00.000Z')
})

test('11b T4: oldest / newest timestamp selection', async () => {
  const h = await loadHelpers()
  const result = h.analyzeUsageEventCompleteness(
    [
      plainEvent({ timestamp: '2026-09-05T00:00:00.000Z' }),
      plainEvent({ timestamp: 'not-a-date' }),
      plainEvent({ timestamp: '' }),
      plainEvent({ timestamp: '2026-09-01T00:00:00.000Z' }),
      { provider: 'openai', model: 'x', estimatedCost: 0, timestamp: null, status: 'ok' },
      plainEvent({ timestamp: '2026-09-10T23:59:59.000Z' })
    ],
    500
  )
  assert.equal(result.eventCount, 6)
  assert.equal(result.oldestTimestamp, '2026-09-01T00:00:00.000Z')
  assert.equal(result.newestTimestamp, '2026-09-10T23:59:59.000Z')
})

test('11b T5: maxEvents matches retention count cap 10000', async () => {
  const h = await loadHelpers()
  const usage = await read('electron/main/ai/usage.ts')
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
  assert.match(usage, /RAW_MAX_EVENTS/)
  const result = h.analyzeUsageEventCompleteness([plainEvent()], 10000)
  assert.equal(result.maxEvents, 10000)
})

test('11b T6: possiblyTruncated false below cap', async () => {
  const h = await loadHelpers()
  const events = Array.from({ length: 499 }, (_, i) =>
    plainEvent({ timestamp: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}.000Z` })
  )
  const result = h.analyzeUsageEventCompleteness(events, 500)
  assert.equal(result.eventCount, 499)
  assert.equal(result.possiblyTruncated, false)
})

test('11b T7: possiblyTruncated true at retention cap', async () => {
  const h = await loadHelpers()
  const events = Array.from({ length: 500 }, (_, i) =>
    plainEvent({
      timestamp: `2026-09-01T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(
        i % 60
      ).padStart(2, '0')}:00.000Z`
    })
  )
  const result = h.analyzeUsageEventCompleteness(events, 500)
  assert.equal(result.eventCount, 500)
  assert.equal(result.possiblyTruncated, true)
  const over = h.analyzeUsageEventCompleteness(
    [...events, plainEvent({ timestamp: '2026-09-02T00:00:00.000Z' })],
    500
  )
  assert.equal(over.eventCount, 501)
  assert.equal(over.possiblyTruncated, true)
})

test('11b T8: UI direct display of usage_event_completeness', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage_event_completeness\?:/)
  assert.match(panel, /data\?\.router\?\.usage_event_completeness/)
  assert.match(panel, /All UsageEvent Data Completeness/)
  const block = completenessBlock(panel)
  assert.match(block, /usageEventCompleteness\.eventCount/)
  assert.match(block, /usageEventCompleteness\.maxEvents/)
  assert.match(block, /usageEventCompleteness\.oldestTimestamp/)
  assert.match(block, /usageEventCompleteness\.newestTimestamp/)
  assert.match(block, /usageEventCompleteness\.possiblyTruncated/)
})

test('11b T9: UI does not recompute completeness', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = completenessBlock(panel)
  assert.doesNotMatch(block, /\.reduce\s*\(/)
  assert.doesNotMatch(block, /new Map\s*\(/)
  assert.doesNotMatch(block, /analyzeUsageEventCompleteness/)
  assert.doesNotMatch(block, /events\.length/)
  assert.doesNotMatch(block, /Math\.min\s*\(/)
  assert.doesNotMatch(block, /Math\.max\s*\(/)
  assert.doesNotMatch(block, /possiblyTruncated\s*=/)
  assert.doesNotMatch(block, /eventCount\s*>=/)
  assert.doesNotMatch(block, /MAX_EVENTS\s*===?\s*500/)
  assert.doesNotMatch(panel, /analyzeUsageEventCompleteness\s*\(/)
})

test('11b T10: localApi wires usage_event_completeness', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventCompleteness/)
  assert.match(local, /MAX_EVENTS/)
  assert.match(local, /analyzeUsageEventCompleteness\s*\(\s*usageEvents\s*,\s*MAX_EVENTS\s*\)/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
})

test('11b T11: population separation from status / daily / failover', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventCompleteness')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /analyzeUsageEventProviderStatus\s*\(/)
  assert.doesNotMatch(fnBody, /analyzeUsageEventProviderDailyStatus\s*\(/)
  assert.doesNotMatch(fnBody, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains/)
  assert.doesNotMatch(fnBody, /dailyBuckets/)
  assert.doesNotMatch(fnBody, /byProvider/)
  assert.doesNotMatch(fnBody, /finalSuccess|finalFailed/)

  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:/)
  assert.match(local, /usage_event_provider_daily:/)
  assert.match(local, /usage_event_completeness:/)
  assert.match(local, /router_failover_analysis:/)
})

test('11b T12: Secret Safety', async () => {
  const h = await loadHelpers()
  const result = h.analyzeUsageEventCompleteness(
    [
      {
        provider: 'openai',
        model: 'gpt',
        estimatedCost: 1,
        timestamp: '2026-09-01T12:00:00.000Z',
        status: 'ok',
        billingMode: 'DEVELOPMENT',
        credentialId: 'cred-SECRET-11B',
        apiKey: 'sk-LEAKED-11B',
        password: 'hunter2',
        token: 'tok-11b',
        secret: 's'
      }
    ],
    500
  )
  const json = JSON.stringify(result)
  assert.deepEqual(Object.keys(result).sort(), [
    'eventCount',
    'maxEvents',
    'newestTimestamp',
    'oldestTimestamp',
    'possiblyTruncated'
  ])
  assert.equal(json.includes('credentialId'), false)
  assert.equal(json.includes('billingMode'), false)
  assert.equal(json.includes('sk-LEAKED-11B'), false)
  assert.equal(json.includes('hunter2'), false)
  assert.equal(json.includes('tok-11b'), false)

  const block = completenessBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(block, /credentialId/)
  assert.doesNotMatch(block, /billingMode/)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /Problem Provider|Healthy|Unhealthy|High Risk/i)
  assert.doesNotMatch(block, /問題Provider|問題 Provider/)
  assert.match(block, /最大 10,000/)
  assert.match(block, /7\s*日/)
  assert.match(block, /完全な過去履歴を意味しません/)
  assert.match(block, /自動判定ラベルではありません/)

  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-11b\.test\.mjs/)
  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /\.usage-event-completeness\b/)
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /analyzeUsageEventCompleteness/)
  assert.match(usage, /UsageEventCompleteness/)
  assert.match(index, /analyzeUsageEventCompleteness/)
  assert.match(index, /MAX_EVENTS/)
})
