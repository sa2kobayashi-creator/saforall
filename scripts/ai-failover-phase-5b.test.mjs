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
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

test('5b T1: uses router_failover_chain_summaries', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /router_failover_chain_summaries/)
  assert.match(panel, /resolveFailoverChains/)
})

test('5b T2: chain hops displayed directly', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /resolveChainHops\(chain\)/)
  assert.match(panel, /hops\.map\(/)
  assert.match(panel, /Array\.isArray\(chain\.hops\)/)
})

test('5b T3: panel does not call analyzeFailoverChains', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
})

test('5b T4: panel does not call groupUsageEventsByFailoverId', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('5b T5: Hop provider display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Provider</)
  assert.match(hop, /hop\?\.provider|hop\.provider/)
  assert.match(hop, /engineDisplayName/)
})

test('5b T6: Hop status display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Status</)
  assert.match(hop, /hop\?\.status|hop\.status/)
})

test('5b T7: Hop attempt display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Attempt</)
  assert.match(hop, /hop\?\.attempt|hop\.attempt/)
  assert.match(hop, /formatHopAttempt/)
})

test('5b T8: Hop reason display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Reason</)
  assert.match(hop, /hop\?\.reason|hop\.reason/)
})

test('5b T9: Hop mode display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Mode</)
  assert.match(hop, /hop\?\.mode|hop\.mode/)
  assert.match(hop, /formatHopMode/)
})

test('5b T10: Hop timestamp display path', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(hop, />Time</)
  assert.match(hop, /hop\?\.timestamp|hop\.timestamp/)
  assert.match(hop, /formatHopTimestamp/)
  assert.match(hop, /usage-failover-hop-timeline/)
})

test('5b T11: credentialId not in Hop UI', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(hop, /credentialId/)
})

test('5b T12: billingMode not in Hop UI', async () => {
  const hop = hopUiBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(hop, /billingMode/)
})

test('5b T13: no final-success Provider hop estimation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  // Phase 6-C may display Core finalSuccess* fields; estimation from hops remains forbidden.
  assert.doesNotMatch(panel, /hops\[hops\.length\s*-\s*1\]/)
  assert.doesNotMatch(panel, /resolveFinalSuccessProvider/)
})

test('5b T14: no failedProviderCounts aggregation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /failedProviderCounts/i)
  assert.doesNotMatch(panel, /failedProviders/i)
})

test('5b T15: no reasonTransitions aggregation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /reasonTransitions/i)
})

test('5b T16: no problem Provider auto-label', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /Problem Provider/i)
  assert.doesNotMatch(panel, /問題Provider|問題 Provider/)
  assert.doesNotMatch(panel, /Provider Health|Provider Risk|Unhealthy Provider/i)
})

test('5b T17: Analysis → Chain → Hop hierarchy', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const a = panel.indexOf('Router Failover Analysis')
  const c = panel.indexOf('Router Failover Chain')
  const h = panel.indexOf('Hop details')
  assert.ok(a >= 0 && c > a && h > c)
  assert.match(panel, /Final Status/)
  assert.match(panel, /Final Reason/)
  assert.match(panel, /usage-failover-overview/)
})

test('5b T18: PHP Fallback separation', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Chain/)
  assert.doesNotMatch(panel, /<h[34][^>]*>\s*Fallback\s*</)
})

test('5b T19: failoverId remains Chain key', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /key=\{chain\.failoverId\}/)
})

test('5b T20: malformed hops safety + run-all registration', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(panel, /function resolveChainHops/)
  assert.match(panel, /Array\.isArray\(chain\.hops\)/)
  assert.match(panel, /hops\.length === 0/)
  assert.match(panel, /formatChainStatuses/)
  assert.match(runAll, /ai-failover-phase-5b\.test\.mjs/)
})
