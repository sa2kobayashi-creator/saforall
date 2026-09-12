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

function hopUiBlock(panel) {
  const start = panel.indexOf('Hop details')
  const end = panel.indexOf('エンジン別回数')
  assert.ok(start >= 0 && end > start, 'Hop UI block markers missing')
  return panel.slice(start, end)
}

test('4b T1: FailoverChainSummary hops are referenced', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /FailoverChainHopView/)
  assert.match(panel, /hops\?:/)
  assert.match(panel, /chain\.hops/)
  assert.match(panel, /resolveChainHops/)
})

test('4b T2: hops mapped directly for display', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /hops\.map\(/)
  assert.match(panel, /resolveChainHops\(chain\)/)
  assert.match(panel, /Array\.isArray\(chain\.hops\)/)
})

test('4b T3: provider display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Provider</)
  assert.match(hop, /hop\?\.provider|hop\.provider/)
  assert.match(hop, /engineDisplayName/)
})

test('4b T4: status display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Status</)
  assert.match(hop, /hop\?\.status|hop\.status/)
})

test('4b T5: attempt display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Attempt</)
  assert.match(hop, /hop\?\.attempt|hop\.attempt/)
  assert.match(hop, /formatHopAttempt/)
})

test('4b T6: reason display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Reason</)
  assert.match(hop, /hop\?\.reason|hop\.reason/)
})

test('4b T7: mode display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Mode</)
  assert.match(hop, /hop\?\.mode|hop\.mode/)
  assert.match(hop, /formatHopMode/)
})

test('4b T8: timestamp display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Time</)
  assert.match(hop, /hop\?\.timestamp|hop\.timestamp/)
  assert.match(hop, /formatHopTimestamp/)
})

test('4b T9: credentialId not shown in Hop UI', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(hop, /credentialId/)
})

test('4b T10: billingMode not shown in Hop UI', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(hop, /billingMode/)
})

test('4b T11: secrets not on Hop display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(hop, /api[_-]?key/i)
  assert.doesNotMatch(hop, /Authorization/)
  assert.doesNotMatch(hop, /password/i)
  assert.doesNotMatch(hop, /\btoken\b/i)
  assert.doesNotMatch(hop, /raw error/i)
  assert.doesNotMatch(hop, /Credential object/)
})

test('4b T12: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
})

test('4b T13: panel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('4b T14: no Chain regrouping', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function resolveFailoverChains/)
  assert.match(panel, /router_failover_chain_summaries/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(panel, /Map\s*\(/)
})

test('4b T15: failoverId remains Chain key', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /key=\{chain\.failoverId\}/)
})

test('4b T16: Router Failover Analysis retained', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /router_failover_analysis/)
  assert.match(panel, /failoverAnalysis/)
})

test('4b T17: PHP Fallback separation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /Hop details/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('4b T18: existing Chain UI retained with Hop details', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover Chain/)
  assert.match(panel, /formatChainProviders/)
  assert.match(panel, /formatChainReasons/)
  assert.match(panel, /usage-failover-chain-path/)
  assert.match(panel, /usage-failover-chain-reasons/)
  assert.match(panel, /Hop details/)
  assert.match(panel, /usage-failover-hop-list/)
  const analysisIdx = panel.indexOf('Router Failover Analysis')
  const chainIdx = panel.indexOf('Router Failover Chain')
  const hopIdx = panel.indexOf('Hop details')
  assert.ok(analysisIdx >= 0 && chainIdx > analysisIdx && hopIdx > chainIdx)
})

test('4b T19: null / malformed / empty hops safe handling', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /function resolveChainHops/)
  assert.match(panel, /Array\.isArray\(chain\.hops\)/)
  assert.match(panel, /hops\.length === 0/)
  assert.match(panel, /formatHopText/)
  assert.match(panel, /formatHopAttempt/)
  assert.match(panel, /formatHopMode/)
  assert.match(panel, /formatHopTimestamp/)
})

test('4b T20: 4-B registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-4b\.test\.mjs/)
})
