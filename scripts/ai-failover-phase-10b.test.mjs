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
  provider,
  status,
  timestamp = '2026-09-01T12:00:00.000Z'
}) {
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

test('10b T1: failoverId mixed — all UsageEvents in daily analysis', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_10b_mix',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-01T10:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_10b_mix',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-01T10:01:00.000Z'
    }),
    plainEvent({
      provider: 'gemini',
      status: 'ok',
      timestamp: '2026-09-01T11:00:00.000Z'
    })
  ]
  const analysis = h.analyzeUsageEventProviderDailyStatus(events)
  assert.equal(analysis.eventCount, 3)
  assert.equal(analysis.rows.length, 3)
  assert.equal(
    analysis.rows.reduce((s, r) => s + r.total, 0),
    3
  )
})

test('10b T2: providers separated', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'gemini', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'error' })
  ])
  const byKey = Object.fromEntries(
    analysis.rows.map((r) => [`${r.date}:${r.provider}`, r])
  )
  assert.deepEqual(byKey['2026-09-01:openai'], {
    date: '2026-09-01',
    provider: 'openai',
    ok: 1,
    error: 1,
    total: 2
  })
  assert.deepEqual(byKey['2026-09-01:gemini'], {
    date: '2026-09-01',
    provider: 'gemini',
    ok: 1,
    error: 0,
    total: 1
  })
})

test('10b T3: same provider different UTC days → separate buckets', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-01T23:59:59.000Z'
    }),
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-02T00:00:00.000Z'
    })
  ])
  assert.deepEqual(
    analysis.rows.map((r) => [r.date, r.total]),
    [
      ['2026-09-01', 1],
      ['2026-09-02', 1]
    ]
  )
})

test('10b T4: ok / error classification', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'openai', status: ' error ' }),
    plainEvent({ provider: 'openai', status: 'ok' })
  ]).rows
  assert.deepEqual(row, {
    date: '2026-09-01',
    provider: 'openai',
    ok: 2,
    error: 1,
    total: 3
  })
})

test('10b T5: unknown status → total only', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({ provider: 'openai', status: 'pending' }),
    plainEvent({ provider: 'openai', status: 'unknown' }),
    plainEvent({ provider: 'openai', status: '' }),
    {
      provider: 'openai',
      model: 'x',
      estimatedCost: 0,
      timestamp: '2026-09-01T12:00:00.000Z'
    }
  ]).rows
  assert.deepEqual(row, {
    date: '2026-09-01',
    provider: 'openai',
    ok: 0,
    error: 0,
    total: 4
  })
})

test('10b T6: empty provider → ?', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({ provider: '', status: 'ok' }),
    plainEvent({ provider: '   ', status: 'error' })
  ]).rows
  assert.deepEqual(row, {
    date: '2026-09-01',
    provider: '?',
    ok: 1,
    error: 1,
    total: 2
  })
})

test('10b T7: invalid timestamp excluded from daily buckets', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-01T12:00:00.000Z'
    }),
    plainEvent({ provider: 'openai', status: 'ok', timestamp: '' }),
    plainEvent({ provider: 'openai', status: 'ok', timestamp: 'not-a-date' }),
    plainEvent({ provider: 'openai', status: 'ok', timestamp: '2026-02-31' }),
    {
      provider: 'openai',
      model: 'x',
      estimatedCost: 0,
      timestamp: null,
      status: 'ok'
    },
    null,
    'x',
    42
  ])
  assert.equal(analysis.eventCount, 5)
  assert.deepEqual(analysis.rows, [
    { date: '2026-09-01', provider: 'openai', ok: 1, error: 0, total: 1 }
  ])
})

test('10b T8: not mixed into Failover dailyBuckets', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_10b_sep',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-01T10:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_10b_sep',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-01T10:01:00.000Z'
    }),
    plainEvent({
      provider: 'gemini',
      status: 'ok',
      timestamp: '2026-09-01T12:00:00.000Z'
    })
  ]
  const failover = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const daily = h.analyzeUsageEventProviderDailyStatus(events)
  assert.ok(Array.isArray(failover.dailyBuckets))
  assert.equal(
    failover.dailyBuckets.some((b) => 'provider' in b && 'ok' in b),
    false
  )
  assert.equal('rows' in failover, false)
  assert.ok(daily.rows.some((r) => r.provider === 'gemini'))
  assert.equal(
    failover.dailyBuckets.some((b) => JSON.stringify(b).includes('gemini')),
    false
  )

  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.doesNotMatch(
    local,
    /dailyBuckets:[\s\S]*usageEventProviderDaily|usage_event_provider_daily[\s\S]*dailyBuckets\.push/
  )
})

test('10b T9: independent of usage_event_provider_status aggregation', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderDailyStatus')
  const fnEnd = billing.indexOf('export type UsageRecentRow', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /analyzeUsageEventProviderStatus\s*\(/)
  assert.doesNotMatch(fnBody, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains/)
  assert.doesNotMatch(fnBody, /dailyBuckets/)
})

test('10b T10: UI direct display of usage_event_provider_daily', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage_event_provider_daily\?:/)
  assert.match(panel, /data\?\.router\?\.usage_event_provider_daily/)
  assert.match(panel, /usageEventProviderDailyRows\.map/)
  assert.match(panel, /row\.date/)
  assert.match(panel, /row\.provider/)
  assert.match(panel, /row\.ok/)
  assert.match(panel, /row\.error/)
  assert.match(panel, /row\.total/)
  assert.match(panel, /All UsageEvent Provider Daily Analysis/)

  const start = panel.indexOf('{usageEventProviderDailyRows != null')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\.reduce\s*\(/)
  assert.doesNotMatch(block, /new Map\s*\(/)
  assert.doesNotMatch(block, /analyzeUsageEventProviderDailyStatus/)
  assert.doesNotMatch(block, /analyzeUsageEventProviderStatus/)
  assert.doesNotMatch(block, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(block, /analyzeFailoverChains/)
  assert.doesNotMatch(block, /dailyBuckets/)
  assert.doesNotMatch(block, /row\.error\s*\/\s*row\.total/)
})

test('10b T11: no Health / Risk / Problem Provider judgment in daily UI', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Provider Daily Analysis')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /Problem Provider|Bad Provider|Unhealthy Provider/i)
  assert.doesNotMatch(block, /問題Provider|問題 Provider/)
  assert.doesNotMatch(block, /providerHealth|providerRisk|problemProvider/i)
  assert.doesNotMatch(block, />Health</)
  assert.doesNotMatch(block, />Risk</)
  assert.doesNotMatch(block, />Error Rate</)
  assert.match(block, /別の母集団/)
  assert.match(block, /最大 500/)
  assert.match(block, /完全な過去履歴を示すものではありません/)
})

test('10b T12: Secret Safety on daily path', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderDailyStatus([
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 1,
      timestamp: '2026-09-01T12:00:00.000Z',
      status: 'ok',
      billingMode: 'DEVELOPMENT',
      credentialId: 'cred-SECRET-10B',
      apiKey: 'sk-LEAKED-10B',
      password: 'hunter2',
      token: 'tok-10b',
      secret: 's',
      rawError: 'boom'
    }
  ])
  const json = JSON.stringify(analysis)
  assert.equal(json.includes('credentialId'), false)
  assert.equal(json.includes('billingMode'), false)
  assert.equal(json.includes('sk-LEAKED-10B'), false)
  assert.equal(json.includes('hunter2'), false)
  assert.equal(json.includes('tok-10b'), false)
  assert.equal(json.includes('rawError'), false)
  assert.deepEqual(Object.keys(analysis.rows[0]).sort(), [
    'date',
    'error',
    'ok',
    'provider',
    'total'
  ])

  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Provider Daily Analysis')
  const end = panel.indexOf('Router Failover Chain')
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /credentialId/)
  assert.doesNotMatch(block, /billingMode/)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /raw error/i)
})

test('10b T13: MAX_EVENTS=500 unchanged', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /const MAX_EVENTS\s*=\s*500\b/)
  assert.doesNotMatch(usage, /const MAX_EVENTS\s*=\s*(?!500\b)\d+/)
})

test('10b T14: exports, wiring, range meta, registration', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  const local = await read('electron/main/localApi.ts')
  const runAll = await read('scripts/run-all-tests.mjs')
  const css = await read('src/components/UsagePanel.css')
  assert.match(usage, /analyzeUsageEventProviderDailyStatus/)
  assert.match(usage, /UsageEventProviderDailyAnalysis/)
  assert.match(index, /analyzeUsageEventProviderDailyStatus/)
  assert.match(local, /analyzeUsageEventProviderDailyStatus\s*\(\s*usageEvents\s*\)/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(runAll, /ai-failover-phase-10b\.test\.mjs/)
  assert.match(css, /\.usage-event-provider-daily\b/)

  const h = await loadHelpers()
  const analysis = h.analyzeUsageEventProviderDailyStatus([
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-01T08:00:00.000Z'
    }),
    plainEvent({
      provider: 'openai',
      status: 'ok',
      timestamp: '2026-09-03T18:00:00.000Z'
    })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.oldestTimestamp, '2026-09-01T08:00:00.000Z')
  assert.equal(analysis.newestTimestamp, '2026-09-03T18:00:00.000Z')
})
