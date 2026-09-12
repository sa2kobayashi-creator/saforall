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

function plainEvent({ provider, status, timestamp = '2026-09-12T12:00:00.000Z' }) {
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

function byProvider(rows) {
  return Object.fromEntries(rows.map((r) => [r.provider, { ...r }]))
}

test('9b T1: failoverId mixed — all UsageEvents counted', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_9b_mix',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:00:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_9b_mix',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:00:02.000Z'
    }),
    plainEvent({ provider: 'gemini', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'ok' })
  ]
  const rows = h.analyzeUsageEventProviderStatus(events)
  const map = byProvider(rows)
  assert.equal(map.openai.ok, 1)
  assert.equal(map.openai.error, 1)
  assert.equal(map.openai.total, 2)
  assert.equal(map.claude.ok, 1)
  assert.equal(map.claude.total, 1)
  assert.equal(map.gemini.ok, 1)
  assert.equal(map.gemini.total, 1)
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 4)
})

test('9b T2: normal success only — ok/total per provider', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'claude', status: 'ok' })
  ])
  const map = byProvider(rows)
  assert.deepEqual(map.openai, { provider: 'openai', ok: 2, error: 0, total: 2 })
  assert.deepEqual(map.claude, { provider: 'claude', ok: 1, error: 0, total: 1 })
})

test('9b T3: normal failure only — error/total', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'openai', status: 'error' }),
    plainEvent({ provider: 'gemini', status: 'error' }),
    plainEvent({ provider: 'gemini', status: 'error' })
  ])
  const map = byProvider(rows)
  assert.deepEqual(map.openai, { provider: 'openai', ok: 0, error: 1, total: 1 })
  assert.deepEqual(map.gemini, { provider: 'gemini', ok: 0, error: 2, total: 2 })
})

test('9b T4: same provider ok/error mix', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'error' }),
    plainEvent({ provider: 'openai', status: 'ok' })
  ])
  assert.deepEqual(row, { provider: 'openai', ok: 2, error: 1, total: 3 })
})

test('9b T5: provider trim', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: ' openai ', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'ok' })
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { provider: 'openai', ok: 2, error: 0, total: 2 })
})

test('9b T6: empty / missing provider → ?', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: '', status: 'ok' }),
    plainEvent({ provider: '   ', status: 'error' }),
    { model: 'x', estimatedCost: 0, timestamp: '2026-09-12T12:00:00.000Z', status: 'ok' },
    { provider: null, model: 'x', estimatedCost: 0, timestamp: '2026-09-12T12:00:00.000Z', status: 'ok' }
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { provider: '?', ok: 3, error: 1, total: 4 })
})

test('9b T7: status trim before ok/error', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'openai', status: ' ok ' }),
    plainEvent({ provider: 'openai', status: ' error ' })
  ])
  assert.deepEqual(row, { provider: 'openai', ok: 1, error: 1, total: 2 })
})

test('9b T8: invalid status → total only', async () => {
  const h = await loadHelpers()
  const [row] = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'openai', status: 'pending' }),
    plainEvent({ provider: 'openai', status: 'unknown' }),
    plainEvent({ provider: 'openai', status: '' }),
    { provider: 'openai', model: 'x', estimatedCost: 0, timestamp: '2026-09-12T12:00:00.000Z' },
    { provider: 'openai', model: 'x', estimatedCost: 0, timestamp: '2026-09-12T12:00:00.000Z', status: null }
  ])
  assert.deepEqual(row, { provider: 'openai', ok: 0, error: 0, total: 5 })
})

test('9b T9: null / malformed events skipped safely', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    null,
    undefined,
    'not-an-object',
    42,
    plainEvent({ provider: 'openai', status: 'ok' })
  ])
  assert.deepEqual(rows, [{ provider: 'openai', ok: 1, error: 0, total: 1 }])
  assert.deepEqual(h.analyzeUsageEventProviderStatus(null), [])
  assert.deepEqual(h.analyzeUsageEventProviderStatus(undefined), [])
  assert.deepEqual(h.analyzeUsageEventProviderStatus('x'), [])
})

test('9b T10: independent of byProvider.oks/errors', async () => {
  const h = await loadHelpers()
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderStatus')
  const fnEnd = billing.indexOf('export type UsageEventProviderDailyStatus', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(fnBody, /byProvider/)
  assert.doesNotMatch(fnBody, /analyzeFailoverChains/)

  // Rescue chain: hop errors on openai, final success claude — All Events still counts both hops + plain.
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_9b_indep_bp',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:10:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_9b_indep_bp',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:10:02.000Z'
    }),
    plainEvent({ provider: 'openai', status: 'ok' })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const openaiHop = analysis.byProvider.find((r) => r.provider === 'openai')
  const status = byProvider(h.analyzeUsageEventProviderStatus(events))
  // All-event openai: 1 error hop + 1 plain ok → ok=1 error=1 total=2
  // byProvider oks/errors are hop-only and must not equal All-event totals by coincidence of meaning.
  assert.equal(openaiHop.errors, 1)
  assert.equal(openaiHop.oks, 0)
  assert.deepEqual(status.openai, { provider: 'openai', ok: 1, error: 1, total: 2 })
  assert.notEqual(status.openai.ok, openaiHop.oks)
  assert.notEqual(status.openai.total, openaiHop.oks + openaiHop.errors)
})

test('9b T11: independent of finalSuccess / finalFailed', async () => {
  const h = await loadHelpers()
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderStatus')
  const fnEnd = billing.indexOf('export type UsageEventProviderDailyStatus', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /finalSuccess/)
  assert.doesNotMatch(fnBody, /finalFailed/)

  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_9b_indep_fs',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:11:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_9b_indep_fs',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:11:02.000Z'
    }),
    plainEvent({ provider: 'openai', status: 'ok' }),
    plainEvent({ provider: 'openai', status: 'error' })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const status = byProvider(h.analyzeUsageEventProviderStatus(events))
  // Chain finalSuccess → claude once; All-event openai is 1ok+2error=3 (not derived from final*)
  assert.deepEqual(analysis.finalSuccessProviderCounts, [{ provider: 'claude', count: 1 }])
  assert.deepEqual(analysis.finalFailedProviderCounts, [])
  assert.deepEqual(status.openai, { provider: 'openai', ok: 1, error: 2, total: 3 })
  assert.deepEqual(status.claude, { provider: 'claude', ok: 1, error: 0, total: 1 })
})

test('9b T12: Secret Safety — only provider/ok/error/total', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 1,
      timestamp: '2026-09-12T12:00:00.000Z',
      status: 'ok',
      billingMode: 'DEVELOPMENT',
      credentialId: 'cred-SECRET-9B',
      apiKey: 'sk-LEAKED-9B',
      password: 'hunter2',
      token: 'tok-9b',
      Authorization: 'Bearer x',
      secret: 's',
      rawError: 'boom'
    }
  ])
  const json = JSON.stringify(rows)
  assert.equal(rows.length, 1)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['error', 'ok', 'provider', 'total'])
  assert.equal(json.includes('credentialId'), false)
  assert.equal(json.includes('billingMode'), false)
  assert.equal(json.includes('sk-LEAKED-9B'), false)
  assert.equal(json.includes('hunter2'), false)
  assert.equal(json.includes('tok-9b'), false)
  assert.equal(json.includes('Authorization'), false)
  assert.equal(json.includes('password'), false)
  assert.equal(json.includes('secret'), false)
  assert.equal(json.includes('rawError'), false)
})

test('9b T13: localApi wires usage_event_provider_status from Core', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeUsageEventProviderStatus/)
  assert.match(local, /usage_event_provider_status/)
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  // Must call Core on month-filtered usageEvents, not invent aggregates in localApi.
  assert.match(local, /analyzeUsageEventProviderStatus\s*\(\s*usageEvents\s*\)/)
  const analyzeIdx = local.indexOf('analyzeUsageEventProviderStatus(usageEvents)')
  const routerIdx = local.indexOf('usage_event_provider_status:')
  assert.ok(analyzeIdx >= 0 && routerIdx > analyzeIdx)
})

test('9b T14: existing router_failover_analysis preserved as sibling field', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /router_failover_analysis:\s*routerFailoverAnalysis/)
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  // Must not nest All UsageEvent status inside failover analysis object.
  const analysisAssign = local.indexOf('router_failover_analysis:')
  const statusAssign = local.indexOf('usage_event_provider_status:')
  assert.ok(analysisAssign >= 0 && statusAssign >= 0)
  assert.notEqual(analysisAssign, statusAssign)

  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_9b_preserve',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:12:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_9b_preserve',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:12:02.000Z'
    })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  assert.ok('byProvider' in analysis)
  assert.ok('finalSuccessProviderCounts' in analysis)
  assert.ok('finalFailedProviderCounts' in analysis)
  assert.ok('dailyBuckets' in analysis)
  assert.equal('usage_event_provider_status' in analysis, false)
  assert.equal('usageEventProviderStatus' in analysis, false)
})

test('9b T15: export from usage.ts / index.ts', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  const index = await read('electron/main/ai/index.ts')
  assert.match(usage, /analyzeUsageEventProviderStatus/)
  assert.match(usage, /UsageEventProviderStatus/)
  assert.match(index, /analyzeUsageEventProviderStatus/)
  assert.match(index, /UsageEventProviderStatus/)

  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-9b\.test\.mjs/)

  // Phase 9-B: panel must not call Core; Phase 9-C may display the API field.
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeUsageEventProviderStatus/)

  // No Health/Risk/Problem in Phase 9-B Core addition (status aggregate only).
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const fnStart = billing.indexOf('export function analyzeUsageEventProviderStatus')
  const fnEnd = billing.indexOf('export type UsageEventProviderDailyStatus', fnStart)
  const fnBody = billing.slice(fnStart, fnEnd)
  assert.doesNotMatch(fnBody, /health|risk|problemProvider|degraded|unhealthy|alert/i)
})

test('9b order: provider name sort (stable, not count ranking)', async () => {
  const h = await loadHelpers()
  const rows = h.analyzeUsageEventProviderStatus([
    plainEvent({ provider: 'zebra', status: 'ok' }),
    plainEvent({ provider: 'alpha', status: 'error' }),
    plainEvent({ provider: 'alpha', status: 'error' }),
    plainEvent({ provider: 'mid', status: 'ok' })
  ])
  assert.deepEqual(
    rows.map((r) => r.provider),
    ['alpha', 'mid', 'zebra']
  )
})
