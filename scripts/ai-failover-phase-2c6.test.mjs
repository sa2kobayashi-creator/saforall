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

function makeAskChainEvents() {
  const failoverId = 'fo_2c6_ask_chain'
  const secret = 'sk-settings-openai-2c6-SECRET'
  return {
    secret,
    failoverId,
    events: [
      {
        provider: 'openai',
        model: 'gpt-test',
        estimatedCost: 0.001,
        timestamp: '2026-09-11T10:00:01.000Z',
        status: 'error',
        billingMode: 'BYOK',
        credentialId: 'byok_openai_2c6',
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
        model: 'claude-test',
        estimatedCost: 0.002,
        timestamp: '2026-09-11T10:00:02.000Z',
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
        model: 'gemini-test',
        estimatedCost: 0.003,
        timestamp: '2026-09-11T10:00:03.000Z',
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
}

test('2c6 A-E: groupUsageEventsByFailoverId restores providers/reasons/status/path', async () => {
  const {
    groupUsageEventsByFailoverId,
    formatFailoverChainProviders,
    formatFailoverChainReasons,
    countFailoverChains
  } = await import('../electron/main/ai/usageBillingUi.ts')

  const { events, failoverId } = makeAskChainEvents()
  const chains = groupUsageEventsByFailoverId(events)

  // A: 3 events → 1 chain
  assert.equal(chains.length, 1)
  assert.equal(chains[0].failoverId, failoverId)
  assert.equal(chains[0].hops.length, 3)

  // B: attempt order restores providers
  assert.deepEqual(chains[0].providers, ['openai', 'claude', 'gemini'])

  // C: reasons from each hop
  assert.deepEqual(chains[0].reasons, ['rate_limit', 'network_error', 'success'])

  // D: statuses from each hop
  assert.deepEqual(chains[0].statuses, ['error', 'error', 'ok'])

  // E: final path is full route
  assert.deepEqual(chains[0].path, ['openai', 'claude', 'gemini'])
  assert.equal(
    formatFailoverChainProviders(chains[0]),
    'openai → claude → gemini'
  )
  assert.equal(
    formatFailoverChainReasons(chains[0]),
    'rate_limit → network_error → success'
  )
  assert.equal(countFailoverChains(events), 1)
})

test('2c6 F: normal success without failoverId is not a chain', async () => {
  const { groupUsageEventsByFailoverId, countFailoverChains } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0.01,
      timestamp: '2026-09-11T11:00:00.000Z',
      status: 'ok',
      billingMode: 'BYOK',
      credentialId: 'byok_ok',
      failover: null
    }
  ]
  assert.deepEqual(groupUsageEventsByFailoverId(events), [])
  assert.equal(countFailoverChains(events), 0)
})

test('2c6 G: single failure without failoverId is not a chain', async () => {
  const { groupUsageEventsByFailoverId, countFailoverChains } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  // C-5: chainActive=false / path.length<=1 → failover null (no failoverId)
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-11T11:01:00.000Z',
      status: 'error',
      billingMode: 'BYOK',
      credentialId: 'byok_fail',
      failover: null
    }
  ]
  assert.deepEqual(groupUsageEventsByFailoverId(events), [])
  assert.equal(countFailoverChains(events), 0)
})

test('2c6 H: Ask mode is preserved on chain', async () => {
  const { groupUsageEventsByFailoverId } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  const { events } = makeAskChainEvents()
  const [chain] = groupUsageEventsByFailoverId(events)
  assert.equal(chain.mode, 'ask')
  assert.ok(chain.hops.every((h) => h.mode === 'ask'))
})

test('2c6 I: Agent mode is preserved on chain', async () => {
  const {
    groupUsageEventsByFailoverId,
    formatFailoverChainLabel
  } = await import('../electron/main/ai/usageBillingUi.ts')
  const failoverId = 'fo_2c6_agent_chain'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-11T12:00:01.000Z',
      status: 'error',
      billingMode: 'BYOK',
      credentialId: 'byok_openai_agent',
      failover: {
        primaryProvider: 'openai',
        reason: 'auth_error',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'agent'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-11T12:00:02.000Z',
      status: 'ok',
      billingMode: 'DEVELOPMENT',
      credentialId: 'dev:claude',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'agent'
      }
    }
  ]
  const chains = groupUsageEventsByFailoverId(events)
  assert.equal(chains.length, 1)
  assert.equal(chains[0].mode, 'agent')
  assert.deepEqual(chains[0].providers, ['openai', 'claude'])
  assert.deepEqual(chains[0].reasons, ['auth_error', 'success'])
  assert.match(formatFailoverChainLabel(chains[0]), /\[agent\]/)
  // N-ish: agent chain must not invent gemini/workers
  assert.equal(chains[0].path.includes('gemini'), false)
  assert.equal(chains[0].path.includes('workers'), false)
})

test('2c6 J: chain count is unique failoverId, not event count', async () => {
  const { groupUsageEventsByFailoverId, countFailoverChains } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  const { events: a } = makeAskChainEvents()
  const bId = 'fo_2c6_second'
  const b = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-11T13:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'timeout',
        attempt: 1,
        failoverId: bId,
        path: ['openai'],
        mode: 'ask'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.01,
      timestamp: '2026-09-11T13:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId: bId,
        path: ['openai', 'claude'],
        mode: 'ask'
      }
    }
  ]
  const all = [...a, ...b]
  assert.equal(all.length, 5)
  assert.equal(countFailoverChains(all), 2)
  assert.equal(groupUsageEventsByFailoverId(all).length, 2)
})

test('2c6 K: PHP fallback fields stay separate from Router Failover chains', async () => {
  const {
    groupUsageEventsByFailoverId,
    usageEventsToRecentRows
  } = await import('../electron/main/ai/usageBillingUi.ts')
  const { events } = makeAskChainEvents()
  const chains = groupUsageEventsByFailoverId(events)
  const rows = usageEventsToRecentRows(events, 10)

  // recent rows keep PHP-style columns null; Router meta is routerFailover only
  for (const row of rows) {
    assert.equal(row.fallback_from, null)
    assert.equal(row.fallback_reason, null)
    assert.ok(row.routerFailover?.failoverId)
  }
  assert.equal(chains.length, 1)

  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /PHP[\s\S]*フォールバックとは別/)
  assert.match(panel, /fallback_from/)
  assert.match(panel, /routerFailover/)
})

test('2c6 L: chain helpers never leak secrets / Authorization / API keys', async () => {
  const {
    groupUsageEventsByFailoverId,
    formatFailoverChainLabel,
    formatFailoverChainProviders,
    formatFailoverChainReasons,
    usageEventsToRecentRows
  } = await import('../electron/main/ai/usageBillingUi.ts')

  const { events, secret } = makeAskChainEvents()
  // Intentionally polluted event (must not appear in chain output)
  const polluted = events.map((e, i) =>
    i === 0
      ? {
          ...e,
          rawError: 'Authorization: Bearer sk-LEAKED-TOKEN-VALUE',
          secret
        }
      : e
  )
  const chains = groupUsageEventsByFailoverId(polluted)
  const label = formatFailoverChainLabel(chains[0])
  const providers = formatFailoverChainProviders(chains[0])
  const reasons = formatFailoverChainReasons(chains[0])
  const rows = usageEventsToRecentRows(events, 10)

  assertNoSecretLeak(chains, [secret, 'sk-LEAKED-TOKEN-VALUE'])
  assertNoSecretLeak(label, [secret])
  assertNoSecretLeak(providers, [secret])
  assertNoSecretLeak(reasons, [secret])
  assertNoSecretLeak(rows, [secret])
  assert.equal(JSON.stringify(chains[0]).includes('Authorization'), false)
  assert.equal(JSON.stringify(chains[0]).includes('rawError'), false)
  assert.equal(JSON.stringify(chains[0]).includes('"secret"'), false)
})

test('2c6 M: agent chain reconstruction does not inject gemini/workers', async () => {
  const { groupUsageEventsByFailoverId } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  const failoverId = 'fo_2c6_agent_only'
  const events = [
    {
      provider: 'openai',
      model: 'gpt',
      estimatedCost: 0,
      timestamp: '2026-09-11T14:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'agent'
      }
    },
    {
      provider: 'claude',
      model: 'claude',
      estimatedCost: 0.02,
      timestamp: '2026-09-11T14:00:02.000Z',
      status: 'ok',
      failover: {
        primaryProvider: 'openai',
        fallbackProvider: 'claude',
        reason: 'success',
        attempt: 2,
        failoverId,
        path: ['openai', 'claude'],
        mode: 'agent'
      }
    }
  ]
  const [chain] = groupUsageEventsByFailoverId(events)
  assert.deepEqual(chain.path, ['openai', 'claude'])
  assert.equal(chain.path.some((p) => p === 'gemini' || p === 'workers'), false)
  assert.equal(chain.providers.some((p) => p === 'gemini' || p === 'workers'), false)
})

test('2c6 N: Cursor / failover execution / PHP surfaces unchanged by C-6', async () => {
  const forbiddenTouches = [
    'electron/main/ai/failover.ts',
    'electron/main/ai/router.ts',
    'electron/main/api.ts',
    'electron/main/lib/providerErrors.ts',
    'src/components/SettingsPanel.tsx'
  ]
  // C-6 must not rewrite these files for this phase — verify exports still look like C-5
  const failover = await read('electron/main/ai/failover.ts')
  assert.match(failover, /executeWithFailover/)
  assert.match(failover, /newFailoverId/)
  assert.match(failover, /onAttempt/)

  const router = await read('electron/main/ai/router.ts')
  assert.match(router, /executeWithFailover/)
  assert.doesNotMatch(router, /groupUsageEventsByFailoverId/)

  const api = await read('electron/main/api.ts')
  assert.match(api, /INSUFFICIENT_CREDIT|insufficient.?credit|credit/i)

  for (const rel of forbiddenTouches) {
    const src = await read(rel)
    assert.doesNotMatch(src, /groupUsageEventsByFailoverId/)
    assert.doesNotMatch(src, /router_failover_chain_summaries/)
  }

  // Cursor package must remain untouched conceptually (no C-6 wiring)
  const cursorAdapter = await read('electron/main/ai/adapters/types.ts')
  assert.doesNotMatch(cursorAdapter, /groupUsageEventsByFailoverId/)
})

test('2c6 O: wiring — UI / localApi / exports / no new persist schema', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  assert.match(billing, /export function groupUsageEventsByFailoverId/)
  assert.match(billing, /export function formatFailoverChainProviders/)
  assert.match(billing, /export function formatFailoverChainReasons/)
  assert.match(billing, /FailoverChainSummary/)
  assert.doesNotMatch(billing, /reasonPath/)
  assert.doesNotMatch(billing, /hops\s*:\s*\[\]/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /groupUsageEventsByFailoverId/)
  assert.match(usage, /UsageFailoverMeta/)
  // No new persisted field on UsageEvent / UsageFailoverMeta for C-6
  assert.doesNotMatch(usage, /reasonPath/)
  assert.doesNotMatch(usage, /chainSummar/)

  const local = await read('electron/main/localApi.ts')
  assert.match(local, /groupUsageEventsByFailoverId/)
  assert.match(local, /router_failover_chain_summaries/)
  assert.match(local, /countFailoverChains/)

  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /router_failover_chain_summaries/)
  assert.match(panel, /resolveFailoverChains/)
  assert.match(panel, /formatChainProviders/)
  assert.match(panel, /formatChainReasons/)
  assert.match(panel, /\[ask\]|modeTag/)

  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /usage-failover-chain/)

  const index = await read('electron/main/ai/index.ts')
  assert.match(index, /groupUsageEventsByFailoverId/)

  const suite = await read('scripts/run-all-tests.mjs')
  assert.match(suite, /ai-failover-phase-2c6\.test\.mjs/)
})

test('2c6: attempt sort uses timestamp as tie-break; legacy events without meta still safe', async () => {
  const { groupUsageEventsByFailoverId, usageEventsToRecentRows } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )
  const failoverId = 'fo_2c6_tie'
  // Same attempt missing on one — still groups by id without crash
  const events = [
    {
      provider: 'claude',
      model: 'c',
      estimatedCost: 0,
      timestamp: '2026-09-11T15:00:02.000Z',
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
    },
    {
      provider: 'openai',
      model: 'o',
      estimatedCost: 0,
      timestamp: '2026-09-11T15:00:01.000Z',
      status: 'error',
      failover: {
        primaryProvider: 'openai',
        reason: 'rate_limit',
        attempt: 1,
        failoverId,
        path: ['openai'],
        mode: 'ask'
      }
    }
  ]
  const [chain] = groupUsageEventsByFailoverId(events)
  assert.deepEqual(chain.providers, ['openai', 'claude'])

  // Legacy: no failoverId / path / mode → normal rows, no crash
  const legacy = usageEventsToRecentRows(
    [
      {
        provider: 'openai',
        model: 'legacy',
        estimatedCost: 0.1,
        timestamp: '2026-01-01T00:00:00.000Z',
        status: 'ok',
        billingMode: 'DEVELOPMENT'
      }
    ],
    5
  )
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].routerFailover, null)
  assert.equal(groupUsageEventsByFailoverId([
    {
      provider: 'openai',
      model: 'legacy',
      estimatedCost: 0.1,
      timestamp: '2026-01-01T00:00:00.000Z',
      status: 'ok'
    }
  ]).length, 0)
})
