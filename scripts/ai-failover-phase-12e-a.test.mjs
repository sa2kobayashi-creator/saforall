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
  timestamp = '2026-09-13T12:00:00.000Z',
  inputTokens = 10,
  outputTokens = 20,
  totalTokens = 30,
  estimatedCost = 0.01
} = {}) {
  return {
    requestId,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
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
  path,
  timestamp,
  inputTokens = 5,
  outputTokens = 5,
  totalTokens = 10,
  estimatedCost = 0.002
}) {
  return {
    requestId,
    provider,
    model: model || provider,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    timestamp,
    status,
    billingMode: 'DEVELOPMENT',
    credentialId: `dev:${provider}`,
    failover: {
      primaryProvider: path[0],
      fallbackProvider: provider === path[0] ? null : provider,
      reason: null,
      attempt,
      failoverId,
      path,
      mode: 'ask'
    }
  }
}

test('12e-a T1: provider × model grouping stays separate rows', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'gpt-4o' }),
    plainEvent({ provider: 'openai', model: 'gpt-4o-mini' }),
    plainEvent({ provider: 'claude', model: 'gpt-4o' })
  ])
  assert.equal(analysis.rows.length, 3)
  assert.deepEqual(
    analysis.rows.map((r) => `${r.provider}|${r.model}`),
    ['claude|gpt-4o', 'openai|gpt-4o', 'openai|gpt-4o-mini']
  )
})

test('12e-a T2: inputTokens summed per provider × model', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'm1', inputTokens: 10, totalTokens: 99 }),
    plainEvent({ provider: 'openai', model: 'm1', inputTokens: 7, totalTokens: 99 })
  ])
  assert.equal(analysis.rows[0].inputTokens, 17)
})

test('12e-a T3: outputTokens summed per provider × model', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'm1', outputTokens: 3, totalTokens: 99 }),
    plainEvent({ provider: 'openai', model: 'm1', outputTokens: 4, totalTokens: 99 })
  ])
  assert.equal(analysis.rows[0].outputTokens, 7)
})

test('12e-a T4: totalTokens uses stored values (not input+output recompute)', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({
      provider: 'openai',
      model: 'm1',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 99
    }),
    plainEvent({
      provider: 'openai',
      model: 'm1',
      inputTokens: 2,
      outputTokens: 2,
      totalTokens: 50
    })
  ])
  assert.equal(analysis.rows[0].inputTokens, 3)
  assert.equal(analysis.rows[0].outputTokens, 3)
  assert.equal(analysis.rows[0].totalTokens, 149)
  assert.notEqual(
    analysis.rows[0].totalTokens,
    analysis.rows[0].inputTokens + analysis.rows[0].outputTokens
  )
})

test('12e-a T5: estimatedCost summed from stored values', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'm1', estimatedCost: 0.1 }),
    plainEvent({ provider: 'openai', model: 'm1', estimatedCost: 0.25 })
  ])
  assert.equal(analysis.rows[0].estimatedCost, 0.35)
})

test('12e-a T6: missing inputTokens counted, not zero-filled into sum', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    plainEvent({ provider: 'openai', model: 'm1', inputTokens: 10, totalTokens: 30 }),
    {
      ...plainEvent({ provider: 'openai', model: 'm1' }),
      inputTokens: null
    }
  ])
  assert.equal(analysis.rows[0].inputTokens, 10)
  assert.equal(analysis.rows[0].missingInputTokenCount, 1)
})

test('12e-a T7: missing outputTokens counted', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    {
      ...plainEvent({ provider: 'openai', model: 'm1', outputTokens: 5 }),
      outputTokens: undefined
    },
    plainEvent({ provider: 'openai', model: 'm1', outputTokens: 5 })
  ])
  assert.equal(analysis.rows[0].outputTokens, 5)
  assert.equal(analysis.rows[0].missingOutputTokenCount, 1)
})

test('12e-a T8: missing totalTokens counted', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    {
      ...plainEvent({ provider: 'openai', model: 'm1' }),
      totalTokens: Number.NaN
    },
    plainEvent({ provider: 'openai', model: 'm1', totalTokens: 40 })
  ])
  assert.equal(analysis.rows[0].totalTokens, 40)
  assert.equal(analysis.rows[0].missingTotalTokenCount, 1)
})

test('12e-a T9: missing estimatedCost counted (not coerced to 0)', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    {
      ...plainEvent({ provider: 'openai', model: 'm1' }),
      estimatedCost: null
    },
    plainEvent({ provider: 'openai', model: 'm1', estimatedCost: 0.05 })
  ])
  assert.equal(analysis.rows[0].estimatedCost, 0.05)
  assert.equal(analysis.rows[0].missingEstimatedCostCount, 1)
})

test('12e-a T10: localApi wires from allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderModelStatus\s*\(\s*allEvents\s*\)/)
  assert.match(local, /usage_event_provider_model:\s*usageEventProviderModel/)
})

test('12e-a T11: month filter not applied to Provider × Model', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.doesNotMatch(
    local,
    /analyzeUsageEventProviderModelStatus\s*\(\s*usageEvents/
  )
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderModelStatus')
  const fnEnd = billing.indexOf('export type UsageEventUsageMetricsProvider', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /routerMonth|startsWith\s*\(\s*routerMonth/)
  assert.doesNotMatch(fnBody, /YYYY-MM/)
})

test('12e-a T12: failover attempts counted as separate UsageEvents', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    hopEvent({
      provider: 'openai',
      model: 'gpt-4o',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_12e',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:00.000Z',
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
      estimatedCost: 0.001
    }),
    hopEvent({
      provider: 'claude',
      model: 'sonnet',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_12e',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:01.000Z',
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      estimatedCost: 0.002
    })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.rows.length, 2)
  assert.equal(analysis.rows.reduce((s, r) => s + r.total, 0), 2)
  assert.equal(
    analysis.rows.reduce((s, r) => s + r.inputTokens, 0),
    3
  )
})

test('12e-a T13: population remains raw', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([plainEvent()])
  assert.equal(analysis.population, 'raw')
})

test('12e-a T14: retention constants unchanged', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
})

test('12e-a T15: additive API keeps provider/model/ok/error/total', async () => {
  const b = await loadBilling()
  const row = b.analyzeUsageEventProviderModelStatus([plainEvent()]).rows[0]
  for (const key of ['provider', 'model', 'ok', 'error', 'total']) {
    assert.ok(key in row, key)
  }
  for (const key of [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'estimatedCost',
    'missingInputTokenCount',
    'missingOutputTokenCount',
    'missingTotalTokenCount',
    'missingEstimatedCostCount'
  ]) {
    assert.ok(key in row, key)
  }
})

test('12e-a T16: no evaluation labels in Core/UI block', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderModelStatus')
  const fnEnd = billing.indexOf('export type UsageEventUsageMetricsProvider', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /Healthy|Unhealthy|Alert|Threshold|windowComplete|fullyComplete/)
  assert.doesNotMatch(fnBody, /Error Rate|Success Rate/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains|groupUsageEventsByFailoverId/)

  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Provider × Model')
  const end = panel.indexOf('All UsageEvent Usage Metrics')
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\bHealthy\b|\bUnhealthy\b|\bAlert\b|\bRisk\b/)
  assert.doesNotMatch(block, /Error Rate|Success Rate|Threshold|Danger|Critical/)
  assert.match(block, /Missing Input/)
  assert.match(block, /Estimated Cost/)
  assert.match(block, /input\+output の再計算ではありません/)
})

test('12e-a T17: regression — sibling APIs still wired', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(local, /usage_event_usage_metrics:\s*usageEventUsageMetrics/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)
  assert.match(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*allEvents\s*,\s*Date\.now\s*\(\s*\)\s*\)/
  )
  assert.match(
    local,
    /analyzeUsageEventCompleteness\s*\(\s*allEvents\s*,\s*MAX_EVENTS/
  )
})

test('12e-a T18: Infinity/empty string treated as missing; registered in run-all', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventProviderModelStatus([
    {
      ...plainEvent({ provider: 'openai', model: 'm1' }),
      inputTokens: Number.POSITIVE_INFINITY,
      outputTokens: '',
      totalTokens: Number.NEGATIVE_INFINITY,
      estimatedCost: '  '
    }
  ])
  assert.equal(analysis.rows[0].inputTokens, 0)
  assert.equal(analysis.rows[0].outputTokens, 0)
  assert.equal(analysis.rows[0].totalTokens, 0)
  assert.equal(analysis.rows[0].estimatedCost, 0)
  assert.equal(analysis.rows[0].missingInputTokenCount, 1)
  assert.equal(analysis.rows[0].missingOutputTokenCount, 1)
  assert.equal(analysis.rows[0].missingTotalTokenCount, 1)
  assert.equal(analysis.rows[0].missingEstimatedCostCount, 1)

  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12e-a\.test\.mjs/)
})
