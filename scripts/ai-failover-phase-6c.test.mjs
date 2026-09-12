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

test('6c T1: Chain displays finalSuccessProvider from Summary', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const chain = chainBlock(panel)
  assert.match(panel, /finalSuccessProvider\?:/)
  assert.match(chain, /Final Success Provider/)
  assert.match(chain, /formatChainFinalSuccessProvider\s*\(/)
  assert.match(chain, /chain\.finalSuccessProvider/)
})

test('6c T2: Analysis displays finalSuccessProviderCounts directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Final Success Providers/)
  assert.match(block, /failoverAnalysis\.finalSuccessProviderCounts/)
  assert.match(block, /finalSuccessProviderCounts\.map/)
  assert.match(block, /Array\.isArray\(failoverAnalysis\.finalSuccessProviderCounts\)/)
})

test('6c T3: no hops[last] final-success estimation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
  assert.doesNotMatch(panel, /resolveFinalSuccessProvider/)
  assert.match(panel, /Never infer from hops/)
})

test('6c T4: Final Success not aliased from byProvider.oks', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const block = analysisBlock(panel)
  assert.match(block, />OKs</)
  assert.match(block, /Final Success Providers/)
  assert.match(block, /Hop の OKs とは別/)
  assert.doesNotMatch(block, /byProvider.*finalSuccessProviderCounts|finalSuccessProviderCounts.*byProvider\.oks/)
  // Counts table maps its own array, not row.oks
  assert.match(block, /finalSuccessProviderCounts\.map\(\(row\)/)
  assert.match(block, /row\.count/)
})

test('6c T5: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
})

test('6c T6: panel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('6c T7: secrets not on Final Success display path', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('Final Success Providers')
  const chainStart = panel.indexOf('Final Success Provider')
  assert.ok(start >= 0 && chainStart >= 0)
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

test('6c T8: PHP Fallback separation maintained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /Router Failover Chain/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('6c T9: Analysis → Chain → Hop hierarchy maintained', async () => {
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
})

test('6c T10: null/empty counts gated; format null provider as dash', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function formatChainFinalSuccessProvider/)
  assert.match(panel, /return '—'/)
  assert.match(
    panel,
    /finalSuccessProviderCounts\.length > 0|finalSuccessProviderCounts\)\.length > 0/
  )
})

test('6c T11: 6-C registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-6c\.test\.mjs/)
})

test('6c T12: Core / forbidden surfaces not modified by 6-C intent', async () => {
  // Static: panel is display-only; Core still owns resolver.
  const billing = await read('electron/main/ai/usageBillingUi.ts')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(billing, /export function resolveFinalSuccessProvider/)
  assert.doesNotMatch(panel, /(?<!final)failedProviderCounts/)
  assert.doesNotMatch(panel, /Problem Provider|Provider Health|Provider Risk/i)
})
