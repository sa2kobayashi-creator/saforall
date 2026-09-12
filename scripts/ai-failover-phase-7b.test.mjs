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

test('7b T1: success chain → finalFailedProvider null', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_7b_ok',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T13:00:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_7b_ok',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T13:00:02.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.finalStatus, 'ok')
  assert.equal(chain.finalSuccessProvider, 'claude')
  assert.equal(chain.finalFailedProvider, null)
})

test('7b T2: failed chain → last error provider', async () => {
  const h = await loadHelpers()
  const id = 'fo_7b_fail3'
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: id,
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T13:01:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 2,
      failoverId: id,
      reason: 'rate_limit',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T13:01:02.000Z'
    }),
    hopEvent({
      provider: 'gemini',
      status: 'error',
      attempt: 3,
      failoverId: id,
      reason: 'unavailable',
      path: ['openai', 'claude', 'gemini'],
      timestamp: '2026-09-12T13:01:03.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.finalStatus, 'error')
  assert.equal(chain.finalSuccessProvider, null)
  assert.equal(chain.finalFailedProvider, 'gemini')
})

test('7b T3: hops null / empty / non-array → null', async () => {
  const h = await loadHelpers()
  assert.equal(h.resolveFinalFailedProvider('error', null), null)
  assert.equal(h.resolveFinalFailedProvider('error', []), null)
  assert.equal(h.resolveFinalFailedProvider('error', undefined), null)
  assert.equal(h.resolveFinalFailedProvider('error', 'not-an-array'), null)
  assert.equal(h.resolveFinalFailedProvider('ok', [{ provider: 'openai', status: 'error' }]), null)
})

test('7b T4: error hop with empty provider skipped', async () => {
  const h = await loadHelpers()
  assert.equal(
    h.resolveFinalFailedProvider('error', [
      {
        provider: 'openai',
        status: 'error',
        attempt: 1,
        reason: 'timeout',
        mode: 'ask',
        timestamp: '',
        credentialId: null,
        billingMode: null
      },
      {
        provider: '   ',
        status: 'error',
        attempt: 2,
        reason: 'rate_limit',
        mode: 'ask',
        timestamp: '',
        credentialId: null,
        billingMode: null
      }
    ]),
    'openai'
  )
  assert.equal(
    h.resolveFinalFailedProvider('error', [
      {
        provider: '',
        status: 'error',
        attempt: 1,
        reason: 'timeout',
        mode: 'ask',
        timestamp: '',
        credentialId: null,
        billingMode: null
      }
    ]),
    null
  )
})

test('7b T5: finalFailedProviderCounts aggregates non-null only', async () => {
  const h = await loadHelpers()
  const events = [
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_c1',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:02:01.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_c1',
        reason: 'unavailable',
        path: ['openai', 'gemini'],
        timestamp: '2026-09-12T13:02:02.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_c2',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:02:03.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_c2',
        reason: 'unavailable',
        path: ['openai', 'gemini'],
        timestamp: '2026-09-12T13:02:04.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'claude',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_c3',
        reason: 'auth',
        path: ['claude'],
        timestamp: '2026-09-12T13:02:05.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_okx',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:02:06.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'ok',
        attempt: 2,
        failoverId: 'fo_7b_okx',
        reason: 'success',
        path: ['openai', 'claude'],
        timestamp: '2026-09-12T13:02:07.000Z'
      })
    ]
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const byProv = Object.fromEntries(
    analysis.finalFailedProviderCounts.map((row) => [row.provider, row.count])
  )
  assert.equal(byProv.gemini, 2)
  assert.equal(byProv.claude, 1)
  assert.equal(byProv.openai, undefined)
  assert.equal(analysis.finalFailedProviderCounts.length, 2)
})

test('7b T6: finalFailedProviderCounts independent of byProvider.errors', async () => {
  const h = await loadHelpers()
  // Rescue: openai error then claude ok → openai has hop errors, finalFailed empty; finalSuccess=claude
  // Plus exhausted: openai→gemini both error → finalFailed=gemini; openai hop errors again
  const events = [
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_rescue',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:03:01.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'ok',
        attempt: 2,
        failoverId: 'fo_7b_rescue',
        reason: 'success',
        path: ['openai', 'claude'],
        timestamp: '2026-09-12T13:03:02.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_exh',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:03:03.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_exh',
        reason: 'unavailable',
        path: ['openai', 'gemini'],
        timestamp: '2026-09-12T13:03:04.000Z'
      })
    ]
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const openai = analysis.byProvider.find((r) => r.provider === 'openai')
  assert.ok(openai)
  assert.ok(openai.errors >= 2)
  const failed = Object.fromEntries(
    analysis.finalFailedProviderCounts.map((row) => [row.provider, row.count])
  )
  assert.equal(failed.gemini, 1)
  assert.equal(failed.openai, undefined)
  assert.notEqual(
    JSON.stringify(analysis.byProvider.map((r) => [r.provider, r.errors])),
    JSON.stringify(analysis.finalFailedProviderCounts)
  )
  const success = Object.fromEntries(
    analysis.finalSuccessProviderCounts.map((row) => [row.provider, row.count])
  )
  assert.equal(success.claude, 1)
  assert.equal(failed.claude, undefined)
})

test('7b T7: reasonTransitions aggregates adjacent reasons', async () => {
  const h = await loadHelpers()
  const events = [
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_rt_a',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:04:01.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_rt_a',
        reason: 'rate_limit',
        path: ['openai', 'claude'],
        timestamp: '2026-09-12T13:04:02.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'error',
        attempt: 3,
        failoverId: 'fo_7b_rt_a',
        reason: 'credential_error',
        path: ['openai', 'claude', 'gemini'],
        timestamp: '2026-09-12T13:04:03.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_rt_b',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T13:04:04.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_rt_b',
        reason: 'rate_limit',
        path: ['openai', 'claude'],
        timestamp: '2026-09-12T13:04:05.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'claude',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_7b_rt_c',
        reason: 'rate_limit',
        path: ['claude'],
        timestamp: '2026-09-12T13:04:06.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'error',
        attempt: 2,
        failoverId: 'fo_7b_rt_c',
        reason: 'unavailable',
        path: ['claude', 'gemini'],
        timestamp: '2026-09-12T13:04:07.000Z'
      })
    ]
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const key = (from, to) => `${from}\0${to}`
  const map = new Map(
    analysis.reasonTransitions.map((row) => [key(row.from, row.to), row.count])
  )
  assert.equal(map.get(key('timeout', 'rate_limit')), 2)
  assert.equal(map.get(key('rate_limit', 'credential_error')), 1)
  assert.equal(map.get(key('rate_limit', 'unavailable')), 1)
})

test('7b T8: reasonTransitions empty when reasons length < 2', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeFailoverChains([
    {
      failoverId: 'fo_one_reason',
      mode: null,
      path: ['openai'],
      providers: ['openai'],
      reasons: ['timeout'],
      statuses: ['error'],
      hops: [],
      finalStatus: 'error',
      finalReason: 'timeout',
      finalSuccessProvider: null,
      finalFailedProvider: 'openai'
    },
    {
      failoverId: 'fo_no_reasons',
      mode: null,
      path: [],
      providers: [],
      reasons: [],
      statuses: [],
      hops: null,
      finalStatus: 'error',
      finalReason: null,
      finalSuccessProvider: null,
      finalFailedProvider: null
    }
  ])
  assert.deepEqual(analysis.reasonTransitions, [])
})

test('7b T9: chain isolation — failed providers do not mix across failoverId', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_iso_fail_a',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T13:05:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_iso_fail_b',
      reason: 'rate_limit',
      path: ['claude'],
      timestamp: '2026-09-12T13:05:02.000Z'
    })
  ]
  const chains = h.groupUsageEventsByFailoverId(events)
  const byId = Object.fromEntries(chains.map((c) => [c.failoverId, c]))
  assert.equal(byId.fo_iso_fail_a.finalFailedProvider, 'openai')
  assert.equal(byId.fo_iso_fail_b.finalFailedProvider, 'claude')
})

test('7b T10: existing success fields retained; new fields present', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_7b_retain',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T13:06:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_7b_retain',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T13:06:02.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.ok('finalSuccessProvider' in chain)
  assert.ok('finalFailedProvider' in chain)
  const analysis = h.analyzeFailoverChains([chain])
  assert.ok(Array.isArray(analysis.finalSuccessProviderCounts))
  assert.ok(Array.isArray(analysis.finalFailedProviderCounts))
  assert.ok(Array.isArray(analysis.reasonTransitions))
  assert.equal(analysis.finalSuccessProviderCounts[0]?.provider, 'claude')
  assert.deepEqual(analysis.finalFailedProviderCounts, [])
})

test('7b T11: secrets / Health not on Phase 7 aggregates; panel UI unchanged for 7-B', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(billing, /finalFailedProvider/)
  assert.match(billing, /finalFailedProviderCounts/)
  assert.match(billing, /reasonTransitions/)
  assert.match(billing, /export function resolveFinalFailedProvider/)
  assert.doesNotMatch(billing, /(?<!final)failedProviderCounts/)
  assert.doesNotMatch(billing, /providerHealth|providerRisk|Problem Provider/i)
  const failedBlock = billing.slice(
    billing.indexOf('finalFailedProviderCounts'),
    billing.indexOf('finalFailedProviderCounts') + 500
  )
  assert.doesNotMatch(failedBlock, /credentialId/)
  assert.doesNotMatch(failedBlock, /billingMode/)
  assert.doesNotMatch(failedBlock, /apiKey|Authorization|password|secret/i)
  // Phase 7-B: UI must not yet display / resolve Failed fields
  assert.doesNotMatch(panel, /finalFailedProvider/)
  assert.doesNotMatch(panel, /finalFailedProviderCounts/)
  assert.doesNotMatch(panel, /reasonTransitions/)
  assert.doesNotMatch(panel, /resolveFinalFailedProvider/)
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
})

test('7b T12: 7-B registered; panel does not call analyze/group', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(runAll, /ai-failover-phase-7b\.test\.mjs/)
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})
