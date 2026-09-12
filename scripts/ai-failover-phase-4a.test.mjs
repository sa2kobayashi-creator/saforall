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

test('4a T1: Provider analysis uses router_failover_analysis.byProvider', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /router_failover_analysis/)
  assert.match(panel, /failoverAnalysis\.byProvider/)
  assert.match(panel, /failoverAnalysis\.byProvider\.map/)
})

test('4a T2: Reason analysis uses router_failover_analysis.byReason', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /failoverAnalysis\.byReason/)
  assert.match(panel, /failoverAnalysis\.byReason\.map/)
})

test('4a T3: Mode analysis uses router_failover_analysis.byMode', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /byMode\?\.ask|byMode\.ask/)
  assert.match(panel, /byMode\?\.agent|byMode\.agent/)
  assert.match(panel, /byMode\?\.unknown|byMode\.unknown/)
})

test('4a T4: Provider table columns retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, />Provider</)
  assert.match(panel, />Hops</)
  assert.match(panel, />Errors</)
  assert.match(panel, />OKs</)
  assert.match(panel, /row\.provider/)
  assert.match(panel, /row\.hops/)
  assert.match(panel, /row\.errors/)
  assert.match(panel, /row\.oks/)
})

test('4a T5: Reason table columns retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, />Reason</)
  assert.match(panel, />Count</)
  assert.match(panel, /row\.reason/)
  assert.match(panel, /row\.count/)
})

test('4a T6: Mode Ask / Agent / Unknown retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, />Ask</)
  assert.match(panel, />Agent</)
  assert.match(panel, />Unknown</)
  assert.match(panel, /usage-failover-mode-list/)
})

test('4a T7: Error rate is display-only from row errors/hops', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function formatProviderErrorRate/)
  assert.match(panel, /hops === 0|h <= 0/)
  assert.match(panel, /formatProviderErrorRate\(row\.errors,\s*row\.hops\)/)
  assert.match(panel, />Error Rate</)
  // Must not recompute Core rates
  assert.doesNotMatch(panel, /successRate\s*=/)
  assert.doesNotMatch(panel, /rescueRate\s*=/)
})

test('4a T8: Provider/Reason relative bars are display-only', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const css = await read('src/components/UsagePanel.css')
  assert.match(panel, /function relativeBarWidth/)
  assert.match(panel, /providerHopMax/)
  assert.match(panel, /reasonCountMax/)
  assert.match(panel, /modeCountMax/)
  assert.match(panel, /usage-failover-mini-bar/)
  assert.match(css, /\.usage-failover-mini-bar/)
  assert.match(css, /\.usage-bar-track/)
  assert.match(css, /\.usage-bar-fill/)
})

test('4a T9: UsagePanel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /from ['"].*usageBillingUi/)
})

test('4a T10: UsagePanel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('4a T11: no Summary regroup in panel', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
  assert.match(panel, /function resolveFailoverChains/)
  assert.match(panel, /router_failover_chain_summaries/)
  assert.match(panel, /\.filter\(/)
  assert.doesNotMatch(panel, /Map\s*\(/)
})

test('4a T12: secrets not on analysis display path', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const analysisBlock = panel.slice(
    panel.indexOf('Router Failover Analysis'),
    panel.indexOf('Router Failover Chain')
  )
  assert.doesNotMatch(analysisBlock, /api[_-]?key/i)
  assert.doesNotMatch(analysisBlock, /Authorization/)
  assert.doesNotMatch(analysisBlock, /password/i)
  assert.doesNotMatch(analysisBlock, /credentialId/)
  assert.doesNotMatch(analysisBlock, /billingMode/)
  assert.doesNotMatch(analysisBlock, /raw error/i)
})

test('4a T13: PHP Fallback separation maintained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('4a T14: Router Failover Chain list retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /failoverChains/)
  assert.match(panel, /usage-failover-chains/)
  assert.match(panel, /usage-failover-chain/)
  const analysisIdx = panel.indexOf('Router Failover Analysis')
  const chainIdx = panel.indexOf('Router Failover Chain')
  assert.ok(analysisIdx >= 0 && chainIdx > analysisIdx)
})

test('4a T15: 4-A test registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-4a\.test\.mjs/)
})
