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

test('3b T1: Router Failover Analysis heading exists', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Analysis/)
})

test('3b T2: panel reads router_failover_analysis', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /router_failover_analysis/)
  assert.match(panel, /failoverAnalysis/)
})

test('3b T3: basic stats from analysis fields', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /totalChains/)
  assert.match(panel, /successfulChains/)
  assert.match(panel, /exhaustedChains/)
  assert.match(panel, /successRate/)
  assert.match(panel, /Total Chains/)
  assert.match(panel, /Successful/)
  assert.match(panel, /Exhausted/)
  assert.match(panel, /Success Rate/)
})

test('3b T4: rescue stats displayed', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /rescuedChains/)
  assert.match(panel, /rescueRate/)
  assert.match(panel, /Rescued/)
  assert.match(panel, /Rescue Rate/)
})

test('3b T5: hop distribution displayed', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /hopDistribution/)
  assert.match(panel, /\.one/)
  assert.match(panel, /\.two/)
  assert.match(panel, /\.three/)
  assert.match(panel, /fourPlus/)
  assert.match(panel, /1 Hop/)
  assert.match(panel, /2 Hop/)
  assert.match(panel, /3 Hop/)
  assert.match(panel, /4\+ Hop/)
})

test('3b T6: average / max hops displayed', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /averageHops/)
  assert.match(panel, /maxHops/)
  assert.match(panel, /Average Hops/)
  assert.match(panel, /Max Hops/)
})

test('3b T7: mode ask / agent / unknown displayed', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /byMode/)
  assert.match(panel, /byMode\?\.ask|byMode\.ask/)
  assert.match(panel, /byMode\?\.agent|byMode\.agent/)
  assert.match(panel, /byMode\?\.unknown|byMode\.unknown/)
  assert.match(panel, />Ask</)
  assert.match(panel, />Agent</)
  assert.match(panel, />Unknown</)
})

test('3b T8: provider stats from byProvider', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /byProvider/)
  assert.match(panel, /row\.provider/)
  assert.match(panel, /row\.hops/)
  assert.match(panel, /row\.errors/)
  assert.match(panel, /row\.oks/)
  assert.match(panel, />Provider</)
  assert.match(panel, />Hops</)
  assert.match(panel, />Errors</)
  assert.match(panel, />OKs</)
})

test('3b T9: reason stats from byReason', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /byReason/)
  assert.match(panel, /row\.reason/)
  assert.match(panel, /row\.count/)
  assert.match(panel, />Reason</)
  assert.match(panel, />Count</)
})

test('3b T10: rate null → em dash via formatFailoverRate', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function formatFailoverRate/)
  assert.match(panel, /rate == null/)
  assert.match(panel, /return '—'/)
  assert.match(panel, /formatFailoverRate\(failoverAnalysis\.successRate\)/)
  assert.match(panel, /formatFailoverRate\(failoverAnalysis\.rescueRate\)/)
})

test('3b T11: analysis null/undefined safe (block gated)', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /failoverAnalysis != null/)
  assert.match(panel, /router_failover_analysis \?\? null/)
  assert.match(panel, /Array\.isArray\(failoverAnalysis\.byProvider\)/)
  assert.match(panel, /Array\.isArray\(failoverAnalysis\.byReason\)/)
})

test('3b T12: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /from ['"].*usageBillingUi/)
})

test('3b T13: panel does not call groupUsageEventsByFailoverId / regroup', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(panel, /new Map<\s*string,\s*RouteRecent/)
  assert.doesNotMatch(panel, /attemptA[\s\S]{0,80}999/)
  assert.match(panel, /resolveFailoverChains/)
  assert.match(panel, /no Chain regrouping|display API summaries only/)
})

test('3b T14: analysis UI does not use secret fields', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const analysisBlock = panel.slice(
    panel.indexOf('usage-failover-analysis'),
    panel.indexOf('Router Failover Chain')
  )
  assert.ok(analysisBlock.length > 100)
  assert.doesNotMatch(analysisBlock, /credentialId/)
  assert.doesNotMatch(analysisBlock, /billingMode/)
  assert.doesNotMatch(analysisBlock, /apiKey|API[_ ]?[Kk]ey/)
  assert.doesNotMatch(analysisBlock, /Authorization/)
  assert.doesNotMatch(analysisBlock, /\bsecret\b/i)
  assert.doesNotMatch(analysisBlock, /\btoken\b/i)
  assert.doesNotMatch(analysisBlock, /password/i)
  assert.doesNotMatch(analysisBlock, /rawError|raw error/i)
})

test('3b T15: existing Router Failover Chain list kept', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /failoverChains\.map/)
  assert.match(panel, /formatChainProviders/)
  assert.match(panel, /formatChainReasons/)
})

test('3b T16: PHP fallback separated from Router Failover Analysis', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /PHP フォールバックとは別/)
  assert.doesNotMatch(panel, /<h4[^>]*>Fallback Analysis/)
  assert.doesNotMatch(panel, /<h4[^>]*>フォールバック分析/)
})

test('3b T17: analysis placed before Chain list', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const analysisIdx = panel.indexOf('Router Failover Analysis')
  const chainIdx = panel.indexOf('Router Failover Chain')
  assert.ok(analysisIdx > 0)
  assert.ok(chainIdx > analysisIdx)
})

test('3b T18: wiring — css / run-all / forbidden surfaces', async () => {
  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /usage-failover-analysis/)

  const suite = await read('scripts/run-all-tests.mjs')
  assert.match(suite, /ai-failover-phase-3b\.test\.mjs/)

  for (const rel of [
    'electron/main/ai/failover.ts',
    'electron/main/ai/router.ts',
    'electron/main/api.ts',
    'electron/main/ai/usageBillingUi.ts',
    'electron/main/localApi.ts'
  ]) {
    const src = await read(rel)
    assert.doesNotMatch(src, /usage-failover-analysis/)
    assert.doesNotMatch(src, /formatFailoverRate/)
  }
})
