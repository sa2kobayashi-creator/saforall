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
  assert.doesNotMatch(text, /password/i)
  for (const secret of secrets) {
    if (secret && String(secret).length >= 8) assert.equal(text.includes(secret), false)
  }
}

function makeThreeHopAsk(failoverId = 'fo_3a_ask3') {
  return [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0.001,
      timestamp: '2026-09-12T10:00:01.000Z',
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
      estimatedCost: 0.002,
      timestamp: '2026-09-12T10:00:02.000Z',
      status: 'error',
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
      timestamp: '2026-09-12T10:00:03.000Z',
      status: 'ok',
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

function makeTwoHopRescue(failoverId = 'fo_3a_rescue') {
  return [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T11:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'auth_error',
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
      timestamp: '2026-09-12T11:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
}

function makeExhausted(failoverId = 'fo_3a_exhausted') {
  return [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T12:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'timeout',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0,
      timestamp: '2026-09-12T12:00:02.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'timeout',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
}

test('3a T1/T14: 3 events → 1 chain; totalChains === 1', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = makeThreeHopAsk()
  const summaries = h.groupUsageEventsByFailoverId(events)
  const analysis = h.analyzeFailoverChains(summaries)
  assert.equal(events.length, 3)
  assert.equal(summaries.length, 1)
  assert.equal(analysis.totalChains, 1)
})

test('3a T2: successfulChains counts finalStatus=ok', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const ok = h.groupUsageEventsByFailoverId(makeTwoHopRescue())
  const bad = h.groupUsageEventsByFailoverId(makeExhausted())
  const analysis = h.analyzeFailoverChains([...ok, ...bad])
  assert.equal(analysis.successfulChains, 1)
  assert.equal(analysis.totalChains, 2)
})

test('3a T3: exhaustedChains counts finalStatus=error', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const analysis = h.analyzeFailoverChains(
    h.groupUsageEventsByFailoverId(makeExhausted())
  )
  assert.equal(analysis.exhaustedChains, 1)
  assert.equal(analysis.successfulChains, 0)
})

test('3a T4: successRate = successful/total; empty → null', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const mixed = h.analyzeFailoverChains([
    ...h.groupUsageEventsByFailoverId(makeTwoHopRescue('fo_ok')),
    ...h.groupUsageEventsByFailoverId(makeExhausted('fo_bad')),
    ...h.groupUsageEventsByFailoverId(makeTwoHopRescue('fo_ok2')),
    ...h.groupUsageEventsByFailoverId(makeExhausted('fo_bad2'))
  ])
  // 2 success / 4 total
  assert.equal(mixed.totalChains, 4)
  assert.equal(mixed.successfulChains, 2)
  assert.equal(mixed.successRate, 0.5)
  assert.equal(h.analyzeFailoverChains([]).successRate, null)
})

test('3a T5: rescued = hops>=2 and final ok only', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const rescued = h.groupUsageEventsByFailoverId(makeTwoHopRescue())
  const exhausted = h.groupUsageEventsByFailoverId(makeExhausted())
  // 1-hop success-like malformed summary (not rescued)
  const oneHopOk = [
    {
      failoverId: 'fo_1hop',
      mode: 'ask',
      path: ['openai'],
      providers: ['openai'],
      reasons: ['success'],
      statuses: ['ok'],
      hops: [
        {
          provider: 'openai',
          status: 'ok',
          attempt: 1,
          reason: 'success',
          mode: 'ask',
          timestamp: '2026-09-12T13:00:00.000Z',
          credentialId: null,
          billingMode: null
        }
      ],
      finalStatus: 'ok',
      finalReason: 'success'
    }
  ]
  const analysis = h.analyzeFailoverChains([...rescued, ...exhausted, ...oneHopOk])
  assert.equal(analysis.rescuedChains, 1)
  assert.equal(analysis.successfulChains, 2)
})

test('3a T6: rescueRate = rescued/total; empty → null', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const analysis = h.analyzeFailoverChains([
    ...h.groupUsageEventsByFailoverId(makeTwoHopRescue('a')),
    ...h.groupUsageEventsByFailoverId(makeExhausted('b'))
  ])
  assert.equal(analysis.rescueRate, 0.5)
  assert.equal(h.analyzeFailoverChains([]).rescueRate, null)
})

test('3a T7: hop distribution 1/2/3/4+', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const one = {
    failoverId: 'h1',
    mode: 'ask',
    path: ['openai'],
    providers: ['openai'],
    reasons: ['success'],
    statuses: ['ok'],
    hops: [{ provider: 'openai', status: 'ok', attempt: 1, reason: 'success', mode: 'ask', timestamp: '', credentialId: null, billingMode: null }],
    finalStatus: 'ok',
    finalReason: 'success'
  }
  const four = {
    failoverId: 'h4',
    mode: 'ask',
    path: ['a', 'b', 'c', 'd'],
    providers: ['a', 'b', 'c', 'd'],
    reasons: ['rate_limit', 'network_error', 'timeout', 'success'],
    statuses: ['error', 'error', 'error', 'ok'],
    hops: [
      { provider: 'a', status: 'error', attempt: 1, reason: 'rate_limit', mode: 'ask', timestamp: '', credentialId: null, billingMode: null },
      { provider: 'b', status: 'error', attempt: 2, reason: 'network_error', mode: 'ask', timestamp: '', credentialId: null, billingMode: null },
      { provider: 'c', status: 'error', attempt: 3, reason: 'timeout', mode: 'ask', timestamp: '', credentialId: null, billingMode: null },
      { provider: 'd', status: 'ok', attempt: 4, reason: 'success', mode: 'ask', timestamp: '', credentialId: null, billingMode: null }
    ],
    finalStatus: 'ok',
    finalReason: 'success'
  }
  const analysis = h.analyzeFailoverChains([
    one,
    ...h.groupUsageEventsByFailoverId(makeTwoHopRescue()),
    ...h.groupUsageEventsByFailoverId(makeThreeHopAsk()),
    four
  ])
  assert.deepEqual(analysis.hopDistribution, {
    one: 1,
    two: 1,
    three: 1,
    fourPlus: 1
  })
})

test('3a T8/T9: averageHops and maxHops', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const analysis = h.analyzeFailoverChains([
    ...h.groupUsageEventsByFailoverId(makeTwoHopRescue()),
    ...h.groupUsageEventsByFailoverId(makeThreeHopAsk())
  ])
  assert.equal(analysis.averageHops, 2.5)
  assert.equal(analysis.maxHops, 3)
  const empty = h.analyzeFailoverChains([])
  assert.equal(empty.averageHops, null)
  assert.equal(empty.maxHops, 0)
})

test('3a T10: provider analysis hops/errors/oks', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const analysis = h.analyzeFailoverChains(
    h.groupUsageEventsByFailoverId(makeThreeHopAsk())
  )
  const byName = Object.fromEntries(analysis.byProvider.map((row) => [row.provider, row]))
  assert.equal(byName.openai.hops, 1)
  assert.equal(byName.openai.errors, 1)
  assert.equal(byName.openai.oks, 0)
  assert.equal(byName.claude.errors, 1)
  assert.equal(byName.gemini.oks, 1)
})

test('3a T11: reason analysis frequencies', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const analysis = h.analyzeFailoverChains(
    h.groupUsageEventsByFailoverId(makeThreeHopAsk())
  )
  const byName = Object.fromEntries(analysis.byReason.map((row) => [row.reason, row.count]))
  assert.equal(byName.rate_limit, 1)
  assert.equal(byName.network_error, 1)
  assert.equal(byName.success, 1)
})

test('3a T12: mode ask / agent / unknown', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const ask = h.groupUsageEventsByFailoverId(makeTwoHopRescue('ask1'))
  const agentEvents = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T14:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId: 'fo_agent',
        path: ['openai'],
        mode: 'agent'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-12T14:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId: 'fo_agent',
        path: ['openai', 'claude'],
        mode: 'agent'
      }
    }
  ]
  const agent = h.groupUsageEventsByFailoverId(agentEvents)
  const unknown = [
    {
      failoverId: 'fo_unk',
      mode: null,
      path: ['openai', 'claude'],
      providers: ['openai', 'claude'],
      reasons: ['rate_limit', 'success'],
      statuses: ['error', 'ok'],
      hops: [
        { provider: 'openai', status: 'error', attempt: 1, reason: 'rate_limit', mode: null, timestamp: '', credentialId: null, billingMode: null },
        { provider: 'claude', status: 'ok', attempt: 2, reason: 'success', mode: null, timestamp: '', credentialId: null, billingMode: null }
      ],
      finalStatus: 'ok',
      finalReason: 'success'
    }
  ]
  const analysis = h.analyzeFailoverChains([...ask, ...agent, ...unknown])
  assert.deepEqual(analysis.byMode, { ask: 1, agent: 1, unknown: 1 })
})

test('3a T13: malformed / empty summaries do not crash', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const malformed = [
    null,
    undefined,
    {
      failoverId: 'bad',
      mode: null,
      path: [],
      providers: [],
      reasons: [null, ''],
      statuses: ['weird'],
      hops: null,
      finalStatus: 'weird',
      finalReason: null
    },
    {
      failoverId: 'empty-hops',
      mode: 'ask',
      path: ['openai'],
      providers: ['openai'],
      reasons: [],
      statuses: [],
      hops: [],
      finalStatus: 'error',
      finalReason: null
    },
    {
      failoverId: 'broken-hop',
      mode: 'ask',
      path: ['openai'],
      providers: ['openai'],
      reasons: ['rate_limit'],
      statuses: ['error'],
      hops: [null, { provider: '', status: 'error', attempt: 1, reason: null, mode: 'ask', timestamp: '', credentialId: null, billingMode: null }],
      finalStatus: 'error',
      finalReason: 'rate_limit'
    }
  ]
  const analysis = h.analyzeFailoverChains(malformed)
  assert.equal(typeof analysis.totalChains, 'number')
  assert.equal(h.analyzeFailoverChains([]).totalChains, 0)
  assert.equal(h.analyzeFailoverChains(null).totalChains, 0)
})

test('3a T15: count / summaries / analysis.totalChains consistency', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const events = [
    ...makeThreeHopAsk('fo_c1'),
    ...makeTwoHopRescue('fo_c2'),
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-12T15:00:00.000Z',
      status: 'error',
      failover: {
        failoverId: 'fo_malformed_pp',
        reason: 'rate_limit',
        attempt: 1,
        mode: 'ask'
      }
    }
  ]
  const summaries = h.groupUsageEventsByFailoverId(events)
  const analysis = h.analyzeFailoverChains(summaries)
  assert.equal(h.countFailoverChains(events), summaries.length)
  assert.equal(analysis.totalChains, summaries.length)
})

test('3a T16: analysis payload never leaks secrets', async () => {
  const h = await import('../electron/main/ai/usageBillingUi.ts')
  const secret = 'sk-settings-openai-3a-SECRET'
  const events = makeThreeHopAsk().map((event, index) =>
    index === 0
      ? { ...event, secret, rawError: 'Authorization: Bearer sk-LEAKED-3A', password: 'hunter2' }
      : event
  )
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  assertNoSecretLeak(analysis, [secret, 'sk-LEAKED-3A', 'hunter2'])
  assert.equal(JSON.stringify(analysis).includes('credentialId'), false)
  assert.equal(JSON.stringify(analysis).includes('billingMode'), false)
})

test('3a T17: localApi wiring exposes router_failover_analysis', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /analyzeFailoverChains/)
  assert.match(local, /router_failover_analysis/)
  assert.match(local, /router_failover_chain_summaries/)
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /analyzeFailoverChains/)
  assert.match(usage, /FailoverChainAnalysis/)
  const index = await read('electron/main/ai/index.ts')
  assert.match(index, /analyzeFailoverChains/)
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains/)
  assert.doesNotMatch(panel, /router_failover_analysis/)
})

test('3a T18 wiring: forbidden surfaces / UI / schema untouched', async () => {
  for (const rel of [
    'electron/main/ai/failover.ts',
    'electron/main/ai/router.ts',
    'electron/main/api.ts',
    'src/components/UsagePanel.tsx',
    'src/components/UsagePanel.css'
  ]) {
    const src = await read(rel)
    assert.doesNotMatch(src, /analyzeFailoverChains/)
    assert.doesNotMatch(src, /router_failover_analysis/)
  }
  const suite = await read('scripts/run-all-tests.mjs')
  assert.match(suite, /ai-failover-phase-3a\.test\.mjs/)
})
