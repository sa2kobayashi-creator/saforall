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

test('12d-d T1: normal token aggregation', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    plainEvent({ inputTokens: 1, outputTokens: 2, totalTokens: 3 })
  ])
  assert.equal(m.inputTokens, 11)
  assert.equal(m.outputTokens, 22)
  assert.equal(m.totalTokens, 33)
  assert.equal(m.population, 'raw')
})

test('12d-d T2: estimatedCost aggregation', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ estimatedCost: 0.1 }),
    plainEvent({ estimatedCost: 0.25 })
  ])
  assert.equal(m.estimatedCost, 0.35)
})

test('12d-d T3: provider breakdown', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ provider: 'openai', inputTokens: 10, totalTokens: 10, estimatedCost: 0.1 }),
    plainEvent({ provider: 'claude', inputTokens: 5, totalTokens: 5, estimatedCost: 0.05 })
  ])
  assert.equal(m.byProvider.length, 2)
  const o = m.byProvider.find((r) => r.provider === 'openai')
  const c = m.byProvider.find((r) => r.provider === 'claude')
  assert.equal(o.inputTokens, 10)
  assert.equal(o.estimatedCost, 0.1)
  assert.equal(c.inputTokens, 5)
})

test('12d-d T4: empty input', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([], 7)
  assert.equal(m.eventCount, 0)
  assert.equal(m.inputTokens, 0)
  assert.equal(m.estimatedCost, 0)
  assert.equal(m.byProvider.length, 0)
  assert.equal(m.oldestTimestamp, null)
})

test('12d-d T5: single event', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({
      inputTokens: 7,
      outputTokens: 8,
      totalTokens: 15,
      estimatedCost: 0.003
    })
  ])
  assert.equal(m.eventCount, 1)
  assert.equal(m.inputTokens, 7)
  assert.equal(m.outputTokens, 8)
  assert.equal(m.totalTokens, 15)
  assert.equal(m.estimatedCost, 0.003)
})

test('12d-d T6: multiple events', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ totalTokens: 1, estimatedCost: 0.001 }),
    plainEvent({ totalTokens: 2, estimatedCost: 0.002 }),
    plainEvent({ totalTokens: 3, estimatedCost: 0.003 })
  ])
  assert.equal(m.eventCount, 3)
  assert.equal(m.totalTokens, 6)
  assert.ok(Math.abs(m.estimatedCost - 0.006) < 1e-12)
})

test('12d-d T7: failover multiple attempts', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_d',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:00.000Z',
      totalTokens: 10,
      estimatedCost: 0.01
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_d',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:01:00.000Z',
      totalTokens: 20,
      estimatedCost: 0.02
    })
  ])
  assert.equal(m.eventCount, 2)
  assert.equal(m.totalTokens, 30)
  assert.equal(m.byProvider.length, 2)
})

test('12d-d T8: missing token field counted, not zero-filled into sum meaning', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    {
      ...plainEvent({ provider: 'claude' }),
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined
    }
  ])
  assert.equal(m.eventCount, 2)
  assert.equal(m.inputTokens, 10)
  assert.equal(m.missingInputTokenCount, 1)
  assert.equal(m.missingOutputTokenCount, 1)
  assert.equal(m.missingTotalTokenCount, 1)
})

test('12d-d T9: missing estimatedCost', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ estimatedCost: 0.5 }),
    { ...plainEvent(), estimatedCost: null },
    { ...plainEvent(), estimatedCost: undefined }
  ])
  assert.equal(m.estimatedCost, 0.5)
  assert.equal(m.missingEstimatedCostCount, 2)
})

test('12d-d T10: invalid numeric values excluded from sums', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ inputTokens: 5, totalTokens: 5, estimatedCost: 0.1 }),
    {
      ...plainEvent(),
      inputTokens: Number.NaN,
      totalTokens: Number.POSITIVE_INFINITY,
      estimatedCost: 'not-a-number'
    },
    { ...plainEvent(), inputTokens: '12', totalTokens: '3', estimatedCost: '0.2' }
  ])
  assert.equal(m.inputTokens, 17)
  assert.equal(m.totalTokens, 8)
  assert.ok(Math.abs(m.estimatedCost - 0.3) < 1e-12)
  assert.equal(m.missingInputTokenCount, 1)
  assert.equal(m.missingTotalTokenCount, 1)
  assert.equal(m.missingEstimatedCostCount, 1)
})

test('12d-d T11: zero values are valid and summed', async () => {
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    })
  ])
  assert.equal(m.inputTokens, 0)
  assert.equal(m.estimatedCost, 0)
  assert.equal(m.missingInputTokenCount, 0)
  assert.equal(m.missingEstimatedCostCount, 0)
})

test('12d-d T12: localApi uses allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventUsageMetrics/)
  assert.match(
    local,
    /analyzeUsageEventUsageMetrics\s*\(\s*allEvents\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
  assert.match(local, /usage_event_usage_metrics:\s*usageEventUsageMetrics/)
})

test('12d-d T13: monthFiltered not used for metrics', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.doesNotMatch(local, /analyzeUsageEventUsageMetrics\s*\(\s*usageEvents/)
})

test('12d-d T14: retention constants unchanged / metrics carries retentionDays', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([plainEvent()], 7)
  assert.equal(m.retentionDays, 7)
})

test('12d-d T15: no operation-level dedupe / no Chain helpers', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventUsageMetrics')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /byId|dedupe|requestId/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains|groupUsageEventsByFailoverId/)
  const b = await loadBilling()
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ requestId: 'same', totalTokens: 1, estimatedCost: 0.1 }),
    plainEvent({ requestId: 'same', totalTokens: 1, estimatedCost: 0.1 })
  ])
  assert.equal(m.eventCount, 2)
  assert.equal(m.totalTokens, 2)
})

test('12d-d T16: existing B API regression wiring', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_model:\s*usageEventProviderModel/)
  assert.match(local, /analyzeUsageEventProviderModelStatus\s*\(\s*allEvents\s*\)/)
})

test('12d-d T17: existing Rolling regression wiring', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(
    local,
    /analyzeUsageEventProviderRolling\s*\(\s*allEvents\s*,\s*Date\.now\s*\(\s*\)\s*\)/
  )
})

test('12d-d T18: existing Completeness regression wiring', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventCompleteness\s*\(\s*allEvents\s*,\s*MAX_EVENTS\s*,\s*Date\.now\s*\(\s*\)\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
})

test('12d-d T19: UI factual-only wording', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /All UsageEvent Usage Metrics/)
  assert.match(panel, /usage_event_usage_metrics/)
  assert.match(panel, /Raw retained data based/)
  assert.match(panel, /実発生全イベントの総量を保証しません/)
})

test('12d-d T20: forbidden health/risk/alert wording in metrics UI/Core', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Usage Metrics')
  const end = panel.indexOf(
    'UsageEvent Provider Daily Analysis — Monthly Population'
  )
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\bHealthy\b|\bUnhealthy\b|\bAlert\b|\bThreshold\b/)
  assert.doesNotMatch(block, /High Cost|Low Cost|Exceeded|Warning/)
  assert.doesNotMatch(block, /\bRisk\b/)
  assert.match(block, /評価ラベルではありません/)
  assert.match(block, /観測数値のみです/)

  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventUsageMetrics')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /Healthy|Unhealthy|Alert|Threshold|windowComplete/)
  assert.doesNotMatch(fnBody, /\bRisk\b/)
})

test('12d-d T21: registered in run-all-tests; does not invent totalTokens=input+output', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12d-d\.test\.mjs/)
  const b = await loadBilling()
  // Raw totalTokens=99 differs from input+output — respect stored total
  const m = b.analyzeUsageEventUsageMetrics([
    plainEvent({ inputTokens: 1, outputTokens: 1, totalTokens: 99 })
  ])
  assert.equal(m.inputTokens, 1)
  assert.equal(m.outputTokens, 1)
  assert.equal(m.totalTokens, 99)
})
