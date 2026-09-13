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

function analysisBlock(panel) {
  const start = panel.indexOf('Router Failover Analysis')
  // Phase 12-E B: Raw/Status sections sit before Chain; Analysis secrets scope ends at Status.
  const end = panel.indexOf('UsageEvent Provider Status — Monthly Population')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
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

test('8b T1: Final Failed UI uses Core finalFailedProviderCounts', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Final Failed Providers/)
  assert.match(block, /failoverAnalysis\.finalFailedProviderCounts/)
  assert.match(block, /sortFinalFailedCountsForDisplay/)
  assert.match(block, /Final Failed が多い Provider/)
})

test('8b T2: Final Failed not confused with byProvider.errors', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Hop の Errors とは別/)
  assert.match(block, />Errors</)
  assert.doesNotMatch(
    block,
    /byProvider\.errors.*finalFailedProviderCounts|finalFailedProviderCounts.*byProvider\.errors/
  )
})

test('8b T3: no hops[last] / resolveFinalFailed in panel', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
  assert.doesNotMatch(panel, /resolveFinalFailedProvider/)
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('8b T4: Exhausted uses Overview Core value with chain-final note', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /failoverAnalysis\.exhaustedChains/)
  assert.match(block, /Exhausted = Chain 最終枯渇/)
  assert.match(block, /Hop Errors の合計ではない/)
  // Must not recompute Exhausted from hop errors / error rate.
  assert.doesNotMatch(block, /exhaustedChains\s*=/)
  assert.doesNotMatch(block, /exhaustedCount\s*=\s*.*errors/i)
})

test('8b T5: Reason Transitions Core direct display; no reasons[] UI agg', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /failoverAnalysis\.reasonTransitions/)
  assert.match(block, /row\.from/)
  assert.match(block, /row\.to/)
  assert.doesNotMatch(block, /reasons\s*\[\s*i\s*\]/)
  assert.doesNotMatch(block, /reasons\s*\[\s*i\s*\+\s*1\s*\]/)
})

test('8b T6: dailyBuckets — same-day aggregation', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_8b_d1a',
      reason: 'timeout',
      path: ['openai'],
      timestamp: '2026-09-10T10:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 2,
      failoverId: 'fo_8b_d1a',
      reason: 'rate_limit',
      path: ['openai', 'claude'],
      timestamp: '2026-09-10T10:01:00.000Z'
    }),
    hopEvent({
      provider: 'gemini',
      status: 'ok',
      attempt: 1,
      failoverId: 'fo_8b_d1b',
      reason: 'success',
      path: ['gemini'],
      timestamp: '2026-09-10T18:00:00.000Z'
    })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const day = analysis.dailyBuckets.find((b) => b.date === '2026-09-10')
  assert.ok(day)
  assert.equal(day.chainCount, 2)
  assert.equal(day.successfulCount, 1)
  assert.equal(day.exhaustedCount, 1)
})

test('8b T7: dailyBuckets — successful and exhausted counts', async () => {
  const h = await loadHelpers()
  const events = [
    hopEvent({
      provider: 'openai',
      status: 'ok',
      attempt: 1,
      failoverId: 'fo_8b_ok',
      reason: 'success',
      path: ['openai'],
      timestamp: '2026-09-11T12:00:00.000Z'
    }),
    hopEvent({
      provider: 'claude',
      status: 'error',
      attempt: 1,
      failoverId: 'fo_8b_ex',
      reason: 'timeout',
      path: ['claude'],
      timestamp: '2026-09-12T12:00:00.000Z'
    })
  ]
  const analysis = h.analyzeFailoverChains(h.groupUsageEventsByFailoverId(events))
  const byDate = Object.fromEntries(analysis.dailyBuckets.map((b) => [b.date, b]))
  assert.equal(byDate['2026-09-11'].successfulCount, 1)
  assert.equal(byDate['2026-09-11'].exhaustedCount, 0)
  assert.equal(byDate['2026-09-12'].successfulCount, 0)
  assert.equal(byDate['2026-09-12'].exhaustedCount, 1)
  assert.equal(analysis.successfulChains, 1)
  assert.equal(analysis.exhaustedChains, 1)
})

test('8b T8: invalid timestamps excluded from dailyBuckets', async () => {
  const h = await loadHelpers()
  const analysis = h.analyzeFailoverChains([
    {
      failoverId: 'fo_bad_ts',
      mode: null,
      path: ['openai'],
      providers: ['openai'],
      reasons: ['timeout'],
      statuses: ['error'],
      hops: [
        {
          provider: 'openai',
          status: 'error',
          attempt: 1,
          reason: 'timeout',
          mode: 'ask',
          timestamp: 'not-a-date',
          credentialId: null,
          billingMode: null
        }
      ],
      finalStatus: 'error',
      finalReason: 'timeout',
      finalSuccessProvider: null,
      finalFailedProvider: 'openai'
    },
    {
      failoverId: 'fo_empty_ts',
      mode: null,
      path: ['claude'],
      providers: ['claude'],
      reasons: ['timeout'],
      statuses: ['error'],
      hops: [
        {
          provider: 'claude',
          status: 'error',
          attempt: 1,
          reason: 'timeout',
          mode: 'ask',
          timestamp: '',
          credentialId: null,
          billingMode: null
        }
      ],
      finalStatus: 'error',
      finalReason: 'timeout',
      finalSuccessProvider: null,
      finalFailedProvider: 'claude'
    }
  ])
  assert.equal(analysis.totalChains, 2)
  assert.equal(analysis.exhaustedChains, 2)
  assert.deepEqual(analysis.dailyBuckets, [])
})

test('8b T9: Daily Analysis UI direct display; no Health/Risk/Problem', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = analysisBlock(panel)
  assert.match(block, /Daily Analysis/)
  assert.match(block, /failoverAnalysis\.dailyBuckets/)
  assert.match(block, /row\.date/)
  assert.match(block, /row\.chainCount/)
  assert.match(block, /row\.successfulCount/)
  assert.match(block, /row\.exhaustedCount/)
  assert.doesNotMatch(panel, /Problem Provider|Bad Provider|Unhealthy Provider/i)
  assert.doesNotMatch(panel, /Provider Health|Provider Risk|Health Score|Risk Score/i)
  assert.doesNotMatch(panel, /Bad Day|Degraded Day|Incident/i)
})

test('8b T10: operational section order Overview → Failed → Transitions → Hop', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  const overview = block.indexOf('>Overview</')
  const failed = block.indexOf('Final Failed Providers')
  const transitions = block.indexOf('Reason Transitions')
  const hop = block.indexOf('>Hop</')
  const success = block.indexOf('Final Success Providers')
  const reason = block.indexOf('>Reason</')
  const daily = block.indexOf('Daily Analysis')
  assert.ok(overview >= 0 && failed > overview && transitions > failed)
  assert.ok(hop > transitions && success > hop && reason > success)
  assert.ok(daily > reason)
})

test('8b T11: secrets not on Phase 8-B display path; PHP separation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = analysisBlock(panel)
  assert.doesNotMatch(block, /credentialId/)
  assert.doesNotMatch(block, /billingMode/)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /Authorization/)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /raw error/i)
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('8b T12: Core exports dailyBuckets; localApi / forbidden not touched by intent', async () => {
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(billing, /dailyBuckets/)
  assert.match(billing, /FailoverChainDailyBucket/)
  assert.doesNotMatch(billing, /providerHealth|providerRisk|problemProvider/i)
  assert.match(runAll, /ai-failover-phase-8b\.test\.mjs/)
})
