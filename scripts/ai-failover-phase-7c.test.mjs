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

function analysisBlock(panel) {
  const start = panel.indexOf('Router Failover Analysis')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

function chainBlock(panel) {
  const start = panel.indexOf('Router Failover Chain')
  const end = panel.indexOf('エンジン別回数')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

test('7c T1: Chain displays finalFailedProvider from Summary', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const chain = chainBlock(panel)
  assert.match(panel, /finalFailedProvider\?:/)
  assert.match(chain, /Final Failed Provider/)
  assert.match(chain, /formatChainFinalFailedProvider\s*\(/)
  assert.match(chain, /chain\.finalFailedProvider/)
})

test('7c T2: Analysis displays finalFailedProviderCounts directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Final Failed Providers/)
  assert.match(block, /failoverAnalysis\.finalFailedProviderCounts/)
  assert.match(block, /finalFailedProviderCounts\.map/)
  assert.match(block, /Array\.isArray\(failoverAnalysis\.finalFailedProviderCounts\)/)
  assert.match(block, /Hop の Errors とは別/)
})

test('7c T3: Analysis displays reasonTransitions directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Reason Transitions/)
  assert.match(block, /failoverAnalysis\.reasonTransitions/)
  assert.match(block, /reasonTransitions\.map/)
  assert.match(block, /Array\.isArray\(failoverAnalysis\.reasonTransitions\)/)
  assert.match(block, /row\.from/)
  assert.match(block, /row\.to/)
  assert.match(block, /row\.count/)
})

test('7c T4: no hops[last] / resolve Final Failed estimation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
  assert.doesNotMatch(panel, /resolveFinalFailedProvider/)
  assert.doesNotMatch(panel, /resolveFinalSuccessProvider/)
  assert.match(panel, /Never infer from hops/)
})

test('7c T5: Final Failed not aliased from byProvider.errors', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, />Errors</)
  assert.match(block, /Final Failed Providers/)
  assert.match(block, /Final Success Providers/)
  assert.doesNotMatch(
    block,
    /byProvider.*finalFailedProviderCounts|finalFailedProviderCounts.*byProvider\.errors/
  )
  assert.match(block, /finalFailedProviderCounts\.map\(\(row\)/)
})

test('7c T6: no UI re-aggregation of reasons[] for transitions', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = analysisBlock(panel)
  assert.doesNotMatch(block, /reasons\s*\[\s*i\s*\]/)
  assert.doesNotMatch(block, /reasons\s*\[\s*i\s*\+\s*1\s*\]/)
  assert.match(block, /failoverAnalysis\.reasonTransitions\.map/)
})

test('7c T7: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
})

test('7c T8: panel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('7c T9: secrets not on Final Failed / Transitions display path', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const analysisPart = analysisBlock(panel)
  const chainPart = chainBlock(panel)
  for (const part of [analysisPart, chainPart]) {
    assert.doesNotMatch(part, /credentialId/)
    assert.doesNotMatch(part, /billingMode/)
    assert.doesNotMatch(part, /api[_-]?key/i)
    assert.doesNotMatch(part, /Authorization/)
    assert.doesNotMatch(part, /password/i)
    assert.doesNotMatch(part, /raw error/i)
  }
})

test('7c T10: PHP Fallback separation maintained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /Router Failover Chain/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('7c T11: Analysis → Chain → Hop hierarchy + Phase 5/6 UI retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const a = panel.indexOf('Router Failover Analysis')
  const c = panel.indexOf('Router Failover Chain')
  const h = panel.indexOf('Hop details')
  assert.ok(a >= 0 && c > a && h > c)
  assert.match(panel, /usage-failover-overview/)
  assert.match(panel, /usage-failover-hop-timeline/)
  assert.match(panel, /Status path/)
  assert.match(panel, /Final Status/)
  assert.match(panel, /Final Reason/)
  assert.match(panel, /Final Success Provider/)
  assert.match(panel, /Final Failed Provider/)
  const successIdx = panel.indexOf('Final Success Providers')
  const failedIdx = panel.indexOf('Final Failed Providers')
  const reasonIdx = panel.indexOf('>Reason</')
  const transitionIdx = panel.indexOf('Reason Transitions')
  assert.ok(successIdx >= 0 && failedIdx > successIdx)
  assert.ok(reasonIdx >= 0 && transitionIdx > reasonIdx)
})

test('7c T12: null/empty gated; format null provider as dash; Health not added', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function formatChainFinalFailedProvider/)
  assert.match(panel, /return '—'/)
  assert.match(
    panel,
    /finalFailedProviderCounts\.length > 0|finalFailedProviderCounts\)\.length > 0/
  )
  assert.match(
    panel,
    /reasonTransitions\.length > 0|reasonTransitions\)\.length > 0/
  )
  assert.doesNotMatch(panel, /Problem Provider|Provider Health|Provider Risk/i)
  assert.doesNotMatch(panel, /(?<!final)failedProviderCounts/)
})

test('7c T13: 7-C registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-7c\.test\.mjs/)
})
