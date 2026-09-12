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

function allUsageBlock(panel) {
  const start = panel.indexOf('All UsageEvent Provider Status')
  const end = panel.indexOf('Router Failover Analysis')
  assert.ok(start >= 0 && end > start, 'All UsageEvent section must precede Failover Analysis')
  return panel.slice(start, end)
}

function analysisBlock(panel) {
  const start = panel.indexOf('Router Failover Analysis')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start)
  return panel.slice(start, end)
}

test('9c T1: panel reads usage_event_provider_status from API', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /usage_event_provider_status\?:/)
  assert.match(panel, /UsageEventProviderStatusRow/)
  assert.match(panel, /data\?\.router\?\.usage_event_provider_status/)
  assert.match(panel, /usageEventProviderStatus\.map/)
  assert.match(panel, /row\.ok/)
  assert.match(panel, /row\.error/)
  assert.match(panel, /row\.total/)
})

test('9c T2: section is outside Failover Analysis (sibling, not nested)', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const allStart = panel.indexOf('All UsageEvent Provider Status')
  const analysisStart = panel.indexOf('Router Failover Analysis')
  const analysisDiv = panel.indexOf('usage-failover-analysis')
  const allDiv = panel.indexOf('usage-event-provider-status')
  assert.ok(allStart >= 0 && analysisStart > allStart)
  assert.ok(allDiv >= 0 && analysisDiv > allDiv)

  const analysis = analysisBlock(panel)
  assert.doesNotMatch(analysis, /All UsageEvent Provider Status/)
  assert.doesNotMatch(analysis, /usageEventProviderStatus/)
  assert.doesNotMatch(analysis, /usage_event_provider_status/)
})

test('9c T3: notes separate Failover Analysis / Hop / Final*', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Failover Analysis とは別母集団/)
  assert.match(block, /Hop \/ Final Success \/ Final\s*Failed とは別/)
  assert.match(block, /failoverId/)
})

test('9c T4: notes — not Health/Risk; MAX_EVENTS=500 retained population', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Health \/ Risk/)
  assert.match(block, /自動判定や断定ラベルではない/)
  assert.match(block, /事実集計/)
  assert.match(block, /最大 500/)
  assert.match(block, /完全な過去データではない/)
  assert.doesNotMatch(block, /Problem Provider|Bad Provider|Unhealthy Provider/i)
  assert.doesNotMatch(block, /問題Provider|問題 Provider/)
  assert.doesNotMatch(block, /providerHealth|providerRisk|problemProvider/i)
})

test('9c T5: no Core re-aggregation / byProvider derivation in panel', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeUsageEventProviderStatus/)
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
  const block = allUsageBlock(panel)
  assert.doesNotMatch(block, /byProvider/)
  assert.doesNotMatch(block, /finalSuccessProviderCounts/)
  assert.doesNotMatch(block, /finalFailedProviderCounts/)
  assert.doesNotMatch(block, /row\.error\s*\/\s*row\.total/)
  assert.doesNotMatch(block, /ok\s*\+\s*error/)
})

test('9c T6: table columns are provider / OK / Error / Total only', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, />Provider</)
  assert.match(block, />OK</)
  assert.match(block, />Error</)
  assert.match(block, />Total</)
  assert.doesNotMatch(block, />Hops</)
  assert.doesNotMatch(block, />Error Rate</)
  assert.doesNotMatch(block, />Health</)
  assert.doesNotMatch(block, />Risk</)
})

test('9c T7: secrets not on All UsageEvent display path', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(block, /credentialId/)
  assert.doesNotMatch(block, /billingMode/)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /Authorization/)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /raw error/i)
})

test('9c T8: CSS class for separate section; Failover Analysis styles untouched by rename', async () => {
  const css = await read('src/components/UsagePanel.css')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(css, /\.usage-event-provider-status\b/)
  assert.match(css, /\.usage-event-provider-status-table\b/)
  assert.match(css, /\.usage-event-provider-status-note\b/)
  assert.match(panel, /usage-event-provider-status/)
  assert.match(css, /\.usage-failover-analysis\b/)
})

test('9c T9: PHP Fallback / Failover Analysis hierarchy preserved', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /フォールバック/)
  assert.match(panel, /All UsageEvent Provider Status/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /Router Failover Chain/)
  const allIdx = panel.indexOf('All UsageEvent Provider Status')
  const analysisIdx = panel.indexOf('Router Failover Analysis')
  const chainIdx = panel.indexOf('Router Failover Chain')
  assert.ok(allIdx < analysisIdx && analysisIdx < chainIdx)
})

test('9c T10: registered in run-all; Core/localApi not re-meaning', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-9c\.test\.mjs/)
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /analyzeUsageEventProviderStatus\s*\(\s*usageEvents\s*\)/)
})
