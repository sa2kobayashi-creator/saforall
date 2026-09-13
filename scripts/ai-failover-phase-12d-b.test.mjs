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
    estimatedCost: 0.001,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider}`,
    failover: null
  }
}

function hopEvent({
  requestId = `req_${Math.random().toString(36).slice(2)}`,
  provider,
  model,
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
    model: model || provider,
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

test('12d-b T1: provider × model classification', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'gpt-4o', status: 'ok' }),
    plainEvent({ provider: 'openai', model: 'gpt-4o-mini', status: 'error' }),
    plainEvent({ provider: 'claude', model: 'sonnet', status: 'ok' })
  ])
  assert.equal(analysis.eventCount, 3)
  assert.equal(analysis.population, 'raw')
  assert.deepEqual(
    analysis.rows.map((r) => `${r.provider}|${r.model}|${r.ok}/${r.error}/${r.total}`),
    ['claude|sonnet|1/0/1', 'openai|gpt-4o|1/0/1', 'openai|gpt-4o-mini|0/1/1']
  )
})

test('12d-b T2: same provider different models', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'a', status: 'ok' }),
    plainEvent({ provider: 'openai', model: 'b', status: 'ok' }),
    plainEvent({ provider: 'openai', model: 'a', status: 'error' })
  ])
  assert.equal(analysis.rows.length, 2)
  const a = analysis.rows.find((r) => r.model === 'a')
  const bb = analysis.rows.find((r) => r.model === 'b')
  assert.equal(a.ok, 1)
  assert.equal(a.error, 1)
  assert.equal(a.total, 2)
  assert.equal(bb.total, 1)
})

test('12d-b T3: different providers same model string', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'shared', status: 'ok' }),
    plainEvent({ provider: 'claude', model: 'shared', status: 'error' })
  ])
  assert.equal(analysis.rows.length, 2)
  assert.ok(analysis.rows.every((r) => r.model === 'shared'))
  assert.ok(analysis.rows.some((r) => r.provider === 'openai' && r.ok === 1))
  assert.ok(analysis.rows.some((r) => r.provider === 'claude' && r.error === 1))
})

test('12d-b T4: eventCount / ok / error / total', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ status: 'ok' }),
    plainEvent({ status: 'ok' }),
    plainEvent({ status: 'error' })
  ])
  assert.equal(analysis.eventCount, 3)
  assert.equal(analysis.rows.reduce((s, r) => s + r.total, 0), 3)
  assert.equal(analysis.rows.reduce((s, r) => s + r.ok, 0), 2)
  assert.equal(analysis.rows.reduce((s, r) => s + r.error, 0), 1)
})

test('12d-b T5: invalid timestamp excluded from range only', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ timestamp: 'not-a-date', model: 'x' }),
    plainEvent({ timestamp: '2026-09-13T10:00:00.000Z', model: 'x' }),
    plainEvent({ timestamp: '', model: 'y' })
  ])
  assert.equal(analysis.eventCount, 3)
  assert.equal(analysis.oldestTimestamp, '2026-09-13T10:00:00.000Z')
  assert.equal(analysis.newestTimestamp, '2026-09-13T10:00:00.000Z')
  assert.equal(analysis.rows.length, 2)
})

test('12d-b T6: future timestamp not rewritten', async () => {
  const b = await loadBilling()
  const future = '2099-01-01T00:00:00.000Z'
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ timestamp: '2026-09-13T12:00:00.000Z' }),
    plainEvent({ timestamp: future })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.newestTimestamp, future)
})

test('12d-b T7: empty input', async () => {
  const b = await loadBilling()
  assert.deepEqual(b.analyzeUsageEventProviderModelStatus([]), {
    rows: [],
    eventCount: 0,
    oldestTimestamp: null,
    newestTimestamp: null,
    population: 'raw'
  })
  assert.deepEqual(b.analyzeUsageEventProviderModelStatus(null), {
    rows: [],
    eventCount: 0,
    oldestTimestamp: null,
    newestTimestamp: null,
    population: 'raw'
  })
})

test('12d-b T8: Failover multi attempt counted separately', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    hopEvent({
      provider: 'openai',
      model: 'gpt-4o',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_b',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      model: 'sonnet',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_b',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:01:00.000Z'
    })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.rows.length, 2)
})

test('12d-b T9: duplicate requestId not deduped by Core', async () => {
  const b = await loadBilling()
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderModelStatus')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /byId|dedupe|requestId/)
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ requestId: 'same', model: 'm1' }),
    plainEvent({ requestId: 'same', model: 'm1' })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.rows[0].total, 2)
})

test('12d-b T10: localApi wires from allEvents not month filter', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderModelStatus/)
  assert.match(local, /analyzeUsageEventProviderModelStatus\s*\(\s*allEvents\s*\)/)
  assert.match(local, /usage_event_provider_model:\s*usageEventProviderModel/)
  assert.doesNotMatch(local, /analyzeUsageEventProviderModelStatus\s*\(\s*usageEvents/)
})

test('12d-b T11: existing sibling APIs intact', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(
    local,
    /usage_event_provider_daily_retained:\s*usageEventProviderDailyRetained/
  )
})

test('12d-b T12: Core has no Health/Risk/Chain helpers', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderModelStatus')
  const fnEnd = billing.indexOf('export function analyzeUsageEventUsageMetrics', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /Healthy|Unhealthy|Risk|Alert|Threshold/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains|groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /windowComplete|fullyComplete/)
  assert.doesNotMatch(fnBody, /usage-daily|analyzeUsageEventProviderHourlyStatus/)
})

test('12d-b T13: UI facts only', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /All UsageEvent Provider × Model/)
  assert.match(panel, /usage_event_provider_model/)
  assert.match(panel, /Raw retained data based/)
  const start = panel.indexOf('All UsageEvent Provider × Model')
  const end = panel.indexOf('All UsageEvent Usage Metrics')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\bHealthy\b|\bUnhealthy\b|\bAlert\b|\bRisk\b/)
  assert.doesNotMatch(block, /Error Rate|Threshold|Danger|Safe/)
})

test('12d-b T14: empty / missing model uses ? like provider', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    { ...plainEvent({ provider: 'openai' }), model: '' },
    { ...plainEvent({ provider: 'openai' }), model: '   ' },
    { provider: 'openai', model: undefined, estimatedCost: 0, timestamp: '2026-09-13T12:00:00.000Z', status: 'ok' }
  ])
  assert.equal(analysis.rows.length, 1)
  assert.equal(analysis.rows[0].model, '?')
  assert.equal(analysis.rows[0].total, 3)
})

test('12d-b T15: registered in run-all-tests; exports', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12d-b\.test\.mjs/)
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /analyzeUsageEventProviderModelStatus/)
  assert.match(usage, /UsageEventProviderModelAnalysis/)
  assert.match(index, /analyzeUsageEventProviderModelStatus/)
})

test('12d-b T16: Retention constants unchanged', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
})
