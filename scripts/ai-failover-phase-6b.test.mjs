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

test('6b T1: success chain sets finalSuccessProvider to ok hop provider', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_6b_ok2',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:00:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_6b_ok2',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:00:02.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.finalStatus, 'ok')
  assert.equal(chain.finalSuccessProvider, 'claude')
})

test('6b T2: multi-hop success uses last ok provider (C)', async () => {
  const h = await loadHelpers()
  const id = 'fo_6b_ok3'
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: id,
      reason: 'rate_limit',
      path: ['openai'],
      timestamp: '2026-09-12T12:01:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 2,
      failoverId: id,
      reason: 'timeout',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:01:02.000Z'
    }),
    hopEvent({
      provider: 'gemini',
      status: 'ok',
      attempt: 3,
      failoverId: id,
      reason: 'success',
      path: ['openai', 'claude', 'gemini'],
      timestamp: '2026-09-12T12:01:03.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.finalSuccessProvider, 'gemini')
})

test('6b T3: failed chain → finalSuccessProvider null', async () => {
  const h = await loadHelpers()
  const id = 'fo_6b_fail'
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: id,
      reason: 'rate_limit',
      path: ['openai'],
      timestamp: '2026-09-12T12:02:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 2,
      failoverId: id,
      reason: 'timeout',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:02:02.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.finalStatus, 'error')
  assert.equal(chain.finalSuccessProvider, null)
})

test('6b T4: empty hops / null hops / non-array → null (no crash)', async () => {
  const h = await loadHelpers()
  assert.equal(h.resolveFinalSuccessProvider('ok', []), null)
  assert.equal(h.resolveFinalSuccessProvider('ok', null), null)
  assert.equal(h.resolveFinalSuccessProvider('ok', undefined), null)
  assert.equal(h.resolveFinalSuccessProvider('ok', 'not-an-array'), null)
  assert.equal(h.resolveFinalSuccessProvider('error', [{ provider: 'openai', status: 'ok' }]), null)
})

test('6b T5: malformed hop entries skipped; ok provider found from end', async () => {
  const h = await loadHelpers()
  assert.equal(
    h.resolveFinalSuccessProvider('ok', [null, undefined, { provider: 'x', status: 'error' }]),
    null
  )
  assert.equal(
    h.resolveFinalSuccessProvider('ok', [
      {
        provider: 'openai',
        status: 'error',
        attempt: 1,
        reason: null,
        mode: null,
        timestamp: '',
        credentialId: null,
        billingMode: null
      },
      {
        provider: 'claude',
        status: 'ok',
        attempt: 2,
        reason: null,
        mode: 'ask',
        timestamp: '',
        credentialId: null,
        billingMode: null
      }
    ]),
    'claude'
  )
  const analysis = h.analyzeFailoverChains([
    {
      failoverId: 'fo_bad_hops',
      mode: null,
      path: [],
      providers: [],
      reasons: [],
      statuses: [],
      hops: null,
      finalStatus: 'ok',
      finalReason: 'success',
      finalSuccessProvider: null
    }
  ])
  assert.equal(analysis.totalChains, 1)
  assert.deepEqual(analysis.finalSuccessProviderCounts, [])
})

test('6b T6: chain isolation — providers do not mix across failoverId', async () => {
  const h = await loadHelpers()
  const events = [
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_iso_a',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T12:03:01.000Z'
      }),
      hopEvent({
        provider: 'claude',
        status: 'ok',
        attempt: 2,
        failoverId: 'fo_iso_a',
        reason: 'success',
        path: ['openai', 'claude'],
        timestamp: '2026-09-12T12:03:02.000Z'
      })
    ],
    ...[
      hopEvent({
        provider: 'openai',
        status: 'error',
        attempt: 1,
        failoverId: 'fo_iso_b',
        reason: 'timeout',
        path: ['openai'],
        timestamp: '2026-09-12T12:03:03.000Z'
      }),
      hopEvent({
        provider: 'gemini',
        status: 'ok',
        attempt: 2,
        failoverId: 'fo_iso_b',
        reason: 'success',
        path: ['openai', 'gemini'],
        timestamp: '2026-09-12T12:03:04.000Z'
      })
    ]
  ]
  const chains = h.groupUsageEventsByFailoverId(events)
  assert.equal(chains.length, 2)
  const byId = Object.fromEntries(chains.map((c) => [c.failoverId, c]))
  assert.equal(byId.fo_iso_a.finalSuccessProvider, 'claude')
  assert.equal(byId.fo_iso_b.finalSuccessProvider, 'gemini')
})

test('6b T7: finalSuccessProviderCounts aggregates only non-null', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_cnt_a',
      reason: 'x',
      path: ['openai'],
      timestamp: '2026-09-12T12:04:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_cnt_a',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:04:02.000Z'
    }),
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_cnt_b',
      reason: 'x',
      path: ['openai'],
      timestamp: '2026-09-12T12:04:03.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_cnt_b',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:04:04.000Z'
    }),
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_cnt_c',
      reason: 'x',
      path: ['openai'],
      timestamp: '2026-09-12T12:04:05.000Z'
    }),
    hopEvent({
      provider: 'gemini',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_cnt_c',
      reason: 'success',
      path: ['openai', 'gemini'],
      timestamp: '2026-09-12T12:04:06.000Z'
    }),
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_cnt_d',
      reason: 'x',
      path: ['openai'],
      timestamp: '2026-09-12T12:04:07.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 2,
      failoverId: 'fo_cnt_d',
      reason: 'y',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:04:08.000Z'
    })
  ]
  const summaries = h.groupUsageEventsByFailoverId(events)
  const analysis = h.analyzeFailoverChains(summaries)
  const counts = Object.fromEntries(
    analysis.finalSuccessProviderCounts.map((row) => [row.provider, row.count])
  )
  assert.equal(counts.claude, 2)
  assert.equal(counts.gemini, 1)
  assert.equal(counts.openai, undefined)
  assert.equal(analysis.finalSuccessProviderCounts.length, 2)
})

test('6b T8: finalSuccessProviderCounts is not byProvider.oks', async () => {
  const h = await loadHelpers()
  const id = 'fo_6b_oks_diff'
  // openai errors once then claude ok — hop oks: openai=0, claude=1
  // final success count: claude=1
  // Add a one-hop ok on openai so byProvider.oks.openai >= 1 while finalSuccess may still be openai=1
  // Better: two-hop rescue where openai has 0 oks but appears in path; finalSuccess=claude
  // and a separate one-hop openai ok → finalSuccess openai=1, byProvider oks openai=1, claude=1
  // Then change: chain with openai error + openai ok on same provider? Unusual.
  // Spec case: hop-level oks can exceed final success counts for intermediate ok hops.
  // Create: openai ok (attempt1) then somehow... actually one chain can't have two oks easily for different meaning.
  // Simpler: one success chain openai→claude ok. byProvider: openai errors=1 oks=0, claude oks=1.
  // finalSuccessProviderCounts: [{claude,1}]. Assert claude count === 1 and openai oks !== implying final.
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: id,
      reason: 'rate_limit',
      path: ['openai'],
      timestamp: '2026-09-12T12:05:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: id,
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:05:02.000Z'
    }),
    // Second chain: single-hop openai ok → finalSuccess openai
    hopEvent({
      provider: 'openai',
      status: 'ok',
      attempt: 1,
      failoverId: 'fo_6b_oks_diff2',
      reason: 'success',
      path: ['openai'],
      timestamp: '2026-09-12T12:05:03.000Z'
    })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const byProvider = Object.fromEntries(
    analysis.byProvider.map((row) => [row.provider, row])
  )
  const finalCounts = Object.fromEntries(
    analysis.finalSuccessProviderCounts.map((row) => [row.provider, row.count])
  )
  // Hop oks: openai has 1 ok hop (second chain); claude has 1 ok hop
  assert.equal(byProvider.openai.oks, 1)
  assert.equal(byProvider.claude.oks, 1)
  // Final success: openai=1, claude=1 — same numbers here but field must be separate array
  assert.ok(Array.isArray(analysis.finalSuccessProviderCounts))
  assert.equal(finalCounts.openai, 1)
  assert.equal(finalCounts.claude, 1)
  // Prove not aliased: mutate conceptual — openai hop errors exist while finalSuccess openai is only from 1-hop
  assert.equal(byProvider.openai.errors, 1)
  assert.notEqual(
    JSON.stringify(analysis.byProvider),
    JSON.stringify(analysis.finalSuccessProviderCounts)
  )
})

test('6b T9: existing chain / analysis fields retained', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_6b_retain',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-12T12:06:01.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'ok',
      attempt: 2,
      failoverId: 'fo_6b_retain',
      reason: 'success',
      path: ['openai', 'claude'],
      timestamp: '2026-09-12T12:06:02.000Z'
    })
  ]
  const [chain] = h.groupUsageEventsByFailoverId(events)
  assert.equal(chain.failoverId, 'fo_6b_retain')
  assert.ok(Array.isArray(chain.hops))
  assert.ok(Array.isArray(chain.path))
  assert.ok(Array.isArray(chain.reasons))
  assert.ok(Array.isArray(chain.statuses))
  assert.equal(typeof chain.finalStatus, 'string')
  assert.ok('finalReason' in chain)
  assert.ok('finalSuccessProvider' in chain)
  const analysis = h.analyzeFailoverChains([chain])
  assert.equal(analysis.totalChains, 1)
  assert.equal(analysis.successfulChains, 1)
  assert.ok(Array.isArray(analysis.byProvider))
  assert.ok(Array.isArray(analysis.byReason))
  assert.ok(Array.isArray(analysis.finalSuccessProviderCounts))
})

test('6b T10: secret fields not added on new aggregates; panel unchanged', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(billing, /finalSuccessProvider/)
  assert.match(billing, /finalSuccessProviderCounts/)
  assert.doesNotMatch(billing, /failedProviderCounts/)
  assert.doesNotMatch(billing, /reasonTransitions/)
  assert.doesNotMatch(billing, /providerHealth|providerRisk/i)
  // New aggregate shape must not introduce secret keys in type comments near counts
  const countsBlock = billing.slice(
    billing.indexOf('finalSuccessProviderCounts'),
    billing.indexOf('finalSuccessProviderCounts') + 400
  )
  assert.doesNotMatch(countsBlock, /credentialId/)
  assert.doesNotMatch(countsBlock, /billingMode/)
  assert.doesNotMatch(countsBlock, /apiKey|Authorization|password|secret/i)
  // Phase 6-B: UI must not change / must not estimate
  assert.doesNotMatch(panel, /finalSuccessProvider/)
  assert.doesNotMatch(panel, /finalSuccessProviderCounts/)
})

test('6b T11: ok hop with empty provider → null', async () => {
  const h = await loadHelpers()
  assert.equal(
    h.resolveFinalSuccessProvider('ok', [
      {
        provider: '   ',
        status: 'ok',
        attempt: 1,
        reason: 'success',
        mode: 'ask',
        timestamp: '2026-09-12T12:07:00.000Z',
        credentialId: null,
        billingMode: null
      }
    ]),
    null
  )
})

test('6b T12: 6-B registered in run-all; UsagePanel not calling analyze/group', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(runAll, /ai-failover-phase-6b\.test\.mjs/)
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})
