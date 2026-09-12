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

function assertNoSecretLeak(payload, secrets = []) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  assert.doesNotMatch(text, /sk-[A-Za-z0-9_\-]{8,}/)
  assert.doesNotMatch(text, /Authorization/i)
  assert.doesNotMatch(text, /"secret"\s*:/)
  assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9_\-\.]+/)
  for (const secret of secrets) {
    if (secret && String(secret).length >= 8) assert.equal(text.includes(secret), false)
  }
}

function assertCountMatchesGroup(events, helpers) {
  assert.equal(
    helpers.countFailoverChains(events),
    helpers.groupUsageEventsByFailoverId(events).length
  )
}

function makeThreeHopAsk(failoverId = 'fo_2c7_ask3') {
  return [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0.001,
      timestamp: '2026-09-12T01:00:01.000Z',
      status: 'error',
      billingMode: 'BYOK',
      credentialId: 'byok_openai_2c7',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.002,
      timestamp: '2026-09-12T01:00:02.000Z',
      status: 'error',
      billingMode: 'DEVELOPMENT',
      credentialId: 'dev:claude',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'network_error',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    },
    {
      provider: 'gemini',
      model: 'gemini',
      estimatedCost: 0.003,
      timestamp: '2026-09-12T01:00:03.000Z',
      status: 'ok',
      billingMode: 'DEVELOPMENT',
      credentialId: 'dev:gemini',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'gemini',
        reason: 'success',
        attempt: 3,
        failoverId,
        path: ['openai', 'claude', 'gemini'],
        mode: 'ask'
      }
    }
  ]
}

test('2c7 T1: 3-hop chain restores OpenAI → Claude → Gemini', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = makeThreeHopAsk()
  const chains = h.groupUsageEventsByFailoverId(events)
  assert.equal(chains.length, 1)
  assert.deepEqual(chains[0].providers, ['openai', 'claude', 'gemini'])
  assert.deepEqual(chains[0].path, ['openai', 'claude', 'gemini'])
  assert.equal(h.formatFailoverChainProviders(chains[0]), 'openai → claude → gemini')
})

test('2c7 T2: reasons align with hops', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const [chain] = h.groupUsageEventsByFailoverId(makeThreeHopAsk())
  assert.deepEqual(chain.reasons, ['rate_limit', 'network_error', 'success'])
  assert.deepEqual(chain.statuses, ['error', 'error', 'ok'])
  assert.deepEqual(
    chain.hops.map((hop) => hop.attempt),
    [1, 2, 3]
  )
})

test('2c7 T3: same failoverId × 3 events → 1 chain', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = makeThreeHopAsk('fo_2c7_one')
  assert.equal(events.length, 3)
  assert.equal(h.countFailoverChains(events), 1)
  assert.equal(h.groupUsageEventsByFailoverId(events).length, 1)
  assertCountMatchesGroup(events, h)
})

test('2c7 T4: two failoverIds → 2 chains', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const a = makeThreeHopAsk('fo_2c7_a')
  const b = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T02:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'timeout',
        attempt: 1,
        failoverId: 'fo_2c7_b',
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T02:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId: 'fo_2c7_b',
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
  const all = [...a, ...b]
  assert.equal(h.countFailoverChains(all), 2)
  assert.equal(h.groupUsageEventsByFailoverId(all).length, 2)
  assertCountMatchesGroup(all, h)
})

test('2c7 T5: normal success failover=null → 0 chains', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T03:00:00.000Z',
      status: 'ok',
      failover: null
    }
  ]
  assert.equal(h.countFailoverChains(events), 0)
  assert.deepEqual(h.groupUsageEventsByFailoverId(events), [])
})

test('2c7 T6: single failure failover=null → 0 chains', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T03:01:00.000Z',
      status: 'error',
      failover: null
    }
  ]
  assert.equal(h.countFailoverChains(events), 0)
  assert.deepEqual(h.groupUsageEventsByFailoverId(events), [])
})

test('2c7 T7: malformed failoverId without primaryProvider — count === summary length', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T04:00:00.000Z',
      status: 'error',
      failover: {
        // primaryProvider intentionally missing
        failoverId: 'fo_2c7_malformed',
        reason: 'rate_limit',
        attempt: 1,
        mode: 'ask'
      }
    }
  ]
  assert.equal(h.failoverForUi(events[0].failover), null)
  assert.equal(h.chainFailoverId(events[0].failover), 'fo_2c7_malformed')
  assertCountMatchesGroup(events, h)
  assert.equal(h.countFailoverChains(events), 1)
  assert.equal(h.groupUsageEventsByFailoverId(events).length, 1)
  assert.equal(h.groupUsageEventsByFailoverId(events)[0].hops[0].provider, 'openai')
})

test('2c7 T8: path missing still reconstructs from providers', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const failoverId = 'fo_2c7_nopath'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T05:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T05:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId,
        mode: 'ask'
      }
    }
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.deepEqual(chain.providers, ['openai', 'claude'])
  assert.deepEqual(chain.path, ['openai', 'claude'])
  assertCountMatchesGroup(events, h)
})

test('2c7 T9: reason missing falls back via status', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const failoverId = 'fo_2c7_noreason'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T06:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T06:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.deepEqual(chain.reasons, ['error', 'success'])
  assert.equal(h.formatFailoverChainReasons(chain), 'error → success')
})

test('2c7 T10: same attempt + same timestamp does not crash or split chain', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const failoverId = 'fo_2c7_tie'
  const ts = '2026-09-12T07:00:00.000Z'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: ts,
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: ts,
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 1,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
  const chains = h.groupUsageEventsByFailoverId(events)
  assert.equal(chains.length, 1)
  assert.equal(chains[0].hops.length, 2)
  assertCountMatchesGroup(events, h)
})

test('2c7 T11: Ask / Agent modes preserved; agent has no gemini/workers', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const ask = h.groupUsageEventsByFailoverId(makeThreeHopAsk())[0]
  assert.equal(ask.mode, 'ask')

  const agentId = 'fo_2c7_agent'
  const agentEvents = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T08:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId: agentId,
        path: ['openai'],
        mode: 'agent'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.02,
      timestamp: '2026-09-12T08:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId: agentId,
        path: ['openai', 'claude'],
        mode: 'agent'
      }
    }
  ]
  const [agent] = h.groupUsageEventsByFailoverId(agentEvents)
  assert.equal(agent.mode, 'agent')
  assert.deepEqual(agent.path, ['openai', 'claude'])
  assert.equal(agent.path.includes('gemini'), false)
  assert.equal(agent.path.includes('workers'), false)
  assert.match(h.formatFailoverChainLabel(agent), /\[agent\]/)
})

test('2c7 T12: PHP fallback columns stay separate from Router Failover Chain', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = makeThreeHopAsk()
  const rows = h.usageEventsToRecentRows(events, 10)
  for (const row of rows) {
    assert.equal(row.fallback_from, null)
    assert.equal(row.fallback_reason, null)
    assert.ok(row.routerFailover?.failoverId)
  }
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /fallback_from/)
  assert.match(panel, /routerFailover/)
  assert.match(panel, /router_failover_chain_summaries/)
})

test('2c7 T13: summary never leaks secrets / Authorization / raw error', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const secret = 'sk-settings-openai-2c7-SECRET'
  const events = makeThreeHopAsk().map((event, index) =>
    index === 0
      ? {
          ...event,
          secret,
          rawError: 'Authorization: Bearer sk-LEAKED-2c7-TOKEN',
          failover: { ...event.failover }
        }
      : event
  )
  const chains = h.groupUsageEventsByFailoverId(events)
  assertNoSecretLeak(chains, [secret, 'sk-LEAKED-2c7-TOKEN'])
  assertNoSecretLeak(h.formatFailoverChainLabel(chains[0]), [secret])
  assert.equal(JSON.stringify(chains[0]).includes('rawError'), false)
  assert.equal(JSON.stringify(chains[0]).includes('Authorization'), false)
})

test('2c7 T14: UsagePanel does not re-implement Chain grouping', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /resolveFailoverChains/)
  assert.match(panel, /router_failover_chain_summaries/)
  // No client-side Map bucketing / attempt=999 dual rules
  assert.doesNotMatch(panel, /new Map<\s*string,\s*RouteRecent/)
  assert.doesNotMatch(panel, /attemptA[\s\S]{0,80}999/)
  assert.doesNotMatch(panel, /buckets\.get/)
  assert.match(panel, /Single Source|display API summaries only|no Chain regrouping/)
})

test('2c7 T15 wiring: helpers / exports / forbidden surfaces untouched', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  assert.match(billing, /export function chainFailoverId/)
  assert.match(billing, /Same ID rule as groupUsageEventsByFailoverId|ID rule matches countFailoverChains/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /chainFailoverId/)

  const suite = await read('scripts/run-all-tests.mjs')
  assert.match(suite, /ai-failover-phase-2c7\.test\.mjs/)

  for (const rel of [
    'electron/main/ai/failover.ts',
    'electron/main/ai/router.ts',
    'electron/main/api.ts'
  ]) {
    const src = await read(rel)
    assert.doesNotMatch(src, /chainFailoverId/)
    assert.doesNotMatch(src, /Phase 2-C-7/)
  }
})

test('2c7: path length != hop count does not crash; final path preferred', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const failoverId = 'fo_2c7_path_mismatch'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T09:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T09:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId,
        // Intentionally longer than hop count (2)
        path: ['openai', 'claude', 'gemini'],
        mode: 'ask'
      }
    }
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.hops.length, 2)
  assert.deepEqual(chain.path, ['openai', 'claude', 'gemini'])
  assertCountMatchesGroup(events, h)
})
