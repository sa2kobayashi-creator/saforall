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

function hopUiBlock(panel) {
  const start = panel.indexOf('Hop details')
  const end = panel.indexOf('エンジン別回数')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

test('5a T1: Analysis reads router_failover_analysis directly', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /router_failover_analysis/)
  assert.match(panel, /failoverAnalysis/)
  assert.match(panel, /router_failover_analysis \?\? null/)
})

test('5a T2: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
})

test('5a T3: panel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('5a T4: Success / Exhausted from analysis fields', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, />Overview</)
  assert.match(block, /totalChains/)
  assert.match(block, /successfulChains/)
  assert.match(block, /exhaustedChains/)
  assert.match(block, />Total Chains</)
  assert.match(block, />Successful</)
  assert.match(block, />Exhausted</)
})

test('5a T5: no Success/Rescue rate recalculation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /formatFailoverRate\(failoverAnalysis\.successRate\)/)
  assert.match(panel, /formatFailoverRate\(failoverAnalysis\.rescueRate\)/)
  assert.doesNotMatch(panel, /successRate\s*=/)
  assert.doesNotMatch(panel, /rescueRate\s*=/)
  assert.doesNotMatch(panel, /rescuedChains\s*=/)
})

test('5a T6: Hop stats not recomputed in panel', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /hopDistribution/)
  assert.match(block, /averageHops/)
  assert.match(block, /maxHops/)
  assert.doesNotMatch(block, /hops\.length/)
  assert.doesNotMatch(block, /averageHops\s*=/)
  assert.doesNotMatch(block, /maxHops\s*=/)
})

test('5a T7: Mode uses byMode directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /byMode\?\.ask|byMode\.ask/)
  assert.match(block, /byMode\?\.agent|byMode\.agent/)
  assert.match(block, /byMode\?\.unknown|byMode\.unknown/)
})

test('5a T8: Provider uses byProvider directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /failoverAnalysis\.byProvider/)
  assert.match(block, /row\.provider/)
  assert.match(block, /row\.hops/)
  assert.match(block, /row\.errors/)
  assert.match(block, /row\.oks/)
})

test('5a T9: Reason uses byReason directly', async () => {
  const block = analysisBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /failoverAnalysis\.byReason/)
  assert.match(block, /row\.reason/)
  assert.match(block, /row\.count/)
})

test('5a T10: Provider Error Rate display-only and safe', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function formatProviderErrorRate/)
  assert.match(panel, /h <= 0/)
  assert.match(panel, /formatProviderErrorRate\(row\.errors,\s*row\.hops\)/)
})

test('5a T11: Chain finalStatus / finalReason from Summary', async () => {
  const chain = chainBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(chain, /Final Status/)
  assert.match(chain, /Final Reason/)
  assert.match(chain, /formatChainFinalStatus\(chain\.finalStatus\)/)
  assert.match(chain, /formatChainFinalReason\(chain\.finalReason\)/)
  assert.doesNotMatch(chain, /hops\[hops\.length/)
  assert.doesNotMatch(chain, /finalStatus\s*=/)
  assert.doesNotMatch(chain, /finalReason\s*=/)
})

test('5a T12: no final-success Provider hop estimation in panel', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  // Phase 6-C may display Core finalSuccessProvider; panel must not estimate from hops.
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
  assert.doesNotMatch(panel, /resolveFinalSuccessProvider/)
})

test('5a T13: no problem Provider auto-label', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /Problem Provider/i)
  assert.doesNotMatch(panel, /問題Provider|問題 Provider/)
  assert.doesNotMatch(panel, /Provider Health|Provider Risk/i)
})

test('5a T14: credentialId / billingMode not added to Analysis/Chain/Hop UI', async () => {
  const analysis = analysisBlock(await read('src/components/UsagePanel.tsx'))
  const chain = chainBlock(await read('src/components/UsagePanel.tsx'))
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(analysis, /credentialId/)
  assert.doesNotMatch(analysis, /billingMode/)
  assert.doesNotMatch(chain, /credentialId/)
  assert.doesNotMatch(chain, /billingMode/)
  assert.doesNotMatch(hop, /credentialId/)
  assert.doesNotMatch(hop, /billingMode/)
})

test('5a T15: secrets not on Analysis/Chain/Hop display path', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('Router Failover Analysis')
  const end = panel.indexOf('エンジン別回数')
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /Authorization/)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /\btoken\b/i)
  assert.doesNotMatch(block, /raw error/i)
})

test('5a T16: PHP Fallback separation maintained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /Router Failover Chain/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('5a T17: Analysis → Chain → Hop hierarchy maintained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const a = panel.indexOf('Router Failover Analysis')
  const c = panel.indexOf('Router Failover Chain')
  const h = panel.indexOf('Hop details')
  assert.ok(a >= 0 && c > a && h > c)
})

test('5a T18: 4-A Mode/Provider/Reason visibility retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage-failover-mode-list/)
  assert.match(panel, /usage-failover-mini-bar/)
  assert.match(panel, /relativeBarWidth/)
  assert.match(panel, /formatProviderErrorRate/)
  assert.match(panel, /usage-failover-provider-table/)
  assert.match(panel, /usage-failover-reason-table/)
})

test('5a T19: 4-B Hop whitelist retained', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Provider</)
  assert.match(hop, />Status</)
  assert.match(hop, />Attempt</)
  assert.match(hop, />Reason</)
  assert.match(hop, />Mode</)
  assert.match(hop, />Time</)
  assert.doesNotMatch(hop, /credentialId/)
  assert.doesNotMatch(hop, /billingMode/)
})

test('5a T20: failoverId Chain key retained + 5-A registered', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(panel, /key=\{chain\.failoverId\}/)
  assert.match(runAll, /ai-failover-phase-5a\.test\.mjs/)
})
