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
  billingMode = 'DEVELOPMENT'
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
    billingMode,
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
  billingMode = 'BYOK'
}) {
  return {
    requestId,
    provider,
    model: model || provider,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedCost: 0.01,
    timestamp,
    status,
    billingMode,
    credentialId: `byok_${provider}_x`,
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

test('12e-b T1: API usage_event_billing_mode exists in localApi', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_billing_mode:\s*usageEventBillingMode/)
  assert.match(local, /analyzeUsageEventBillingMode/)
})

test('12e-b T2: wires from allEvents', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(
    local,
    /analyzeUsageEventBillingMode\s*\(\s*allEvents\s*,\s*RAW_RETENTION_DAYS\s*\)/
  )
})

test('12e-b T3: month filter not used', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.doesNotMatch(local, /analyzeUsageEventBillingMode\s*\(\s*usageEvents/)
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventBillingMode')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /routerMonth|startsWith\s*\(\s*routerMonth/)
})

test('12e-b T4: billingMode counts BYOK / DEVELOPMENT', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    plainEvent({ billingMode: 'BYOK' }),
    plainEvent({ billingMode: 'BYOK' }),
    plainEvent({ billingMode: 'DEVELOPMENT' })
  ])
  assert.equal(analysis.eventCount, 3)
  assert.equal(analysis.population, 'raw')
  const byok = analysis.rows.find((r) => r.billingMode === 'BYOK')
  const dev = analysis.rows.find((r) => r.billingMode === 'DEVELOPMENT')
  assert.equal(byok.total, 2)
  assert.equal(dev.total, 1)
})

test('12e-b T5: failover attempts counted as separate events', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_12eb',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:00.000Z',
      billingMode: 'BYOK'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_12eb',
      path: ['openai', 'claude'],
      timestamp: '2026-09-13T12:00:01.000Z',
      billingMode: 'BYOK'
    })
  ])
  assert.equal(analysis.eventCount, 2)
  assert.equal(analysis.rows[0].total, 2)
})

test('12e-b T6: missing billingMode not coerced to DEVELOPMENT/BYOK/UNKNOWN', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    plainEvent({ billingMode: 'DEVELOPMENT' }),
    { ...plainEvent(), billingMode: null },
    { ...plainEvent(), billingMode: undefined },
    { ...plainEvent(), billingMode: '' },
    { ...plainEvent(), billingMode: 'ORGANIZATION' },
    { ...plainEvent(), billingMode: 'MANAGED' }
  ])
  assert.equal(analysis.eventCount, 6)
  assert.equal(analysis.missingBillingModeCount, 5)
  assert.equal(analysis.rows.length, 1)
  assert.equal(analysis.rows[0].billingMode, 'DEVELOPMENT')
  assert.equal(analysis.rows[0].total, 1)
  const json = JSON.stringify(analysis)
  assert.equal(json.includes('UNKNOWN'), false)
  assert.equal(json.includes('ORGANIZATION'), false)
  assert.equal(json.includes('MANAGED'), false)
})

test('12e-b T7: billingMode × provider cross counts', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    plainEvent({ provider: 'openai', billingMode: 'BYOK' }),
    plainEvent({ provider: 'openai', billingMode: 'BYOK' }),
    plainEvent({ provider: 'claude', billingMode: 'BYOK' }),
    plainEvent({ provider: 'openai', billingMode: 'DEVELOPMENT' })
  ])
  assert.equal(analysis.byBillingModeProvider.length, 3)
  const byokOpenai = analysis.byBillingModeProvider.find(
    (r) => r.billingMode === 'BYOK' && r.provider === 'openai'
  )
  const byokClaude = analysis.byBillingModeProvider.find(
    (r) => r.billingMode === 'BYOK' && r.provider === 'claude'
  )
  const devOpenai = analysis.byBillingModeProvider.find(
    (r) => r.billingMode === 'DEVELOPMENT' && r.provider === 'openai'
  )
  assert.equal(byokOpenai.total, 2)
  assert.equal(byokClaude.total, 1)
  assert.equal(devOpenai.total, 1)
})

test('12e-b T8: population raw', async () => {
  const b = await loadBilling()
  assert.equal(b.analyzeUsageEventBillingMode([plainEvent()]).population, 'raw')
})

test('12e-b T9: retention constants unchanged', async () => {
  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)
  assert.match(retention, /export const MAX_EVENTS\s*=\s*RAW_MAX_EVENTS\b/)
})

test('12e-b T10: security — no credentialId/secret/token/password in analysis', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    {
      ...plainEvent({ billingMode: 'BYOK' }),
      credentialId: 'byok_SECRET_ID',
      apiKey: 'sk-LEAK',
      password: 'hunter2',
      token: 'tok',
      secret: 's'
    }
  ])
  const json = JSON.stringify(analysis)
  assert.equal(json.includes('credentialId'), false)
  assert.equal(json.includes('byok_SECRET_ID'), false)
  assert.equal(json.includes('sk-LEAK'), false)
  assert.equal(json.includes('hunter2'), false)
  assert.equal(json.includes('password'), false)
  assert.equal(json.includes('"token"'), false)
  assert.equal(json.includes('secret'), false)
  assert.deepEqual(Object.keys(analysis.rows[0]).sort(), ['billingMode', 'total'])
})

test('12e-b T11: no Health/Risk/Alert evaluation', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventBillingMode')
  const fnEnd = billing.indexOf('function engineMatches', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /Healthy|Unhealthy|Alert|Threshold|windowComplete/)
  assert.doesNotMatch(fnBody, /errorRate|successRate|Error Rate|Success Rate/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains|groupUsageEventsByFailoverId/)

  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('All UsageEvent Billing Mode')
  const end = panel.indexOf('UsageEvent Provider Daily Analysis — Monthly Population')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /\bHealthy\b|\bUnhealthy\b|\bAlert\b|\bRisk\b/)
  assert.doesNotMatch(block, /Error Rate|Success Rate|Threshold/)
})

test('12e-b T12: sibling APIs remain wired', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /usage_event_provider_daily:\s*usageEventProviderDaily/)
  assert.match(local, /usage_event_provider_hourly:\s*usageEventProviderHourly/)
  assert.match(local, /usage_event_provider_rolling:\s*usageEventProviderRolling/)
  assert.match(local, /usage_event_completeness:\s*usageEventCompleteness/)
  assert.match(local, /usage_event_provider_model:\s*usageEventProviderModel/)
  assert.match(local, /usage_event_usage_metrics:\s*usageEventUsageMetrics/)
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)
})

test('12e-b T13: UI + registration + exports', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /All UsageEvent Billing Mode/)
  assert.match(panel, /usage_event_billing_mode/)
  assert.match(panel, /Population/)
  assert.match(panel, /billingModeForUi/)

  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-12e-b\.test\.mjs/)

  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /analyzeUsageEventBillingMode/)
  assert.match(usage, /UsageEventBillingModeAnalysis/)
  assert.match(index, /analyzeUsageEventBillingMode/)
  assert.match(index, /UsageEventBillingModeAnalysis/)
})

test('12e-b T14: missing events excluded from byBillingModeProvider', async () => {
  const b = await loadBilling()
  const analysis = b.analyzeUsageEventBillingMode([
    plainEvent({ provider: 'openai', billingMode: null }),
    plainEvent({ provider: 'openai', billingMode: 'BYOK' })
  ])
  assert.equal(analysis.missingBillingModeCount, 1)
  assert.equal(analysis.byBillingModeProvider.length, 1)
  assert.equal(analysis.byBillingModeProvider[0].total, 1)
})
