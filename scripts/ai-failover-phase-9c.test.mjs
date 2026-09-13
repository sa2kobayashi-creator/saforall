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

/** Phase 9-C section: after Failover Analysis, before Chain. */
function allUsageBlock(panel) {
  const start = panel.indexOf('{usageEventProviderStatus != null')
  const end = panel.indexOf('Router Failover Chain')
  assert.ok(start >= 0 && end > start, 'All UsageEvent section must precede Chain')
  return panel.slice(start, end)
}

function analysisBlock(panel) {
  const start = panel.indexOf('<div className="usage-failover-analysis">')
  const end = panel.indexOf('{usageEventProviderStatus != null')
  assert.ok(start >= 0 && end > start, 'Failover Analysis must precede All UsageEvent')
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
  assert.match(panel, /row\.provider/)
})

test('9c T2: section is sibling after Failover Analysis (not nested)', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  const analysisStart = panel.indexOf('Router Failover Analysis')
  const allStart = panel.indexOf('UsageEvent Provider Status — Monthly Population')
  const chainStart = panel.indexOf('Router Failover Chain')
  assert.ok(analysisStart >= 0 && allStart > analysisStart && chainStart > allStart)

  const analysisDivClose = panel.indexOf('usage-failover-analysis')
  const allDiv = panel.indexOf('className="usage-event-provider-status"')
  assert.ok(analysisDivClose >= 0 && allDiv > analysisDivClose)

  const analysis = analysisBlock(panel)
  assert.doesNotMatch(analysis, /UsageEvent Provider Status — Monthly Population/)
  assert.doesNotMatch(analysis, /usageEventProviderStatus/)
  assert.doesNotMatch(analysis, /usage_event_provider_status/)
})

test('9c T3: notes separate Failover Analysis / Hop / Final*', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /指定月（routerMonth）に属する UsageEvent/)
  assert.match(block, /failoverId/)
  assert.match(block, /Router Failover Analysis/)
  assert.match(block, /Failover\s*Chain/)
  assert.match(block, /別集計/)
  assert.match(block, /Hop \/ Final Success \/ Final Failed/)
  assert.match(block, /別集計/)
})

test('9c T4: notes — month population; not Raw allEvents', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Population: Month/)
  assert.match(block, /Monthly Population/)
  assert.doesNotMatch(block, /All UsageEvent Provider Status/)
  assert.doesNotMatch(block, /直近 7 日かつ最大 10,000 件/)
})

test('9c T5: display block does not re-aggregate', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.doesNotMatch(block, /\.reduce\s*\(/)
  assert.doesNotMatch(block, /new Map\s*\(/)
  assert.doesNotMatch(block, /groupUsageEventsByFailoverId/)
  assert.doesNotMatch(block, /analyzeFailoverChains/)
  assert.doesNotMatch(block, /analyzeUsageEventProviderStatus/)
  assert.doesNotMatch(block, /hops\[\s*hops\.length\s*-\s*1\s*\]/)
  assert.doesNotMatch(block, /hops\[last\]/)
  assert.doesNotMatch(block, /byProvider\.errors/)
  assert.doesNotMatch(block, /finalSuccessProviderCounts/)
  assert.doesNotMatch(block, /finalFailedProviderCounts/)
  assert.doesNotMatch(block, /row\.error\s*\/\s*row\.total/)

  const panel = await read('src/components/UsagePanel.tsx')
  assert.doesNotMatch(panel, /analyzeUsageEventProviderStatus/)
  assert.doesNotMatch(panel, /analyzeFailoverChains\s*\(/)
  assert.doesNotMatch(panel, /groupUsageEventsByFailoverId/)
})

test('9c T6: table columns are Provider / OK / Error / Total only', async () => {
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

test('9c T7: Health / Risk / Problem Provider forbidden in new section', async () => {
  const block = allUsageBlock(await read('src/components/UsagePanel.tsx'))
  assert.match(block, /Health \/ Risk/)
  assert.match(block, /自動判定や断定ラベルではない/)
  assert.match(block, /事実表示/)
  assert.doesNotMatch(block, /Problem Provider|Bad Provider|Unhealthy Provider/i)
  assert.doesNotMatch(block, /問題Provider|問題 Provider/)
  assert.doesNotMatch(block, /\bdanger\b/i)
  assert.doesNotMatch(block, /unhealthy/i)
  assert.doesNotMatch(block, /providerHealth|providerRisk|problemProvider/i)
  assert.doesNotMatch(block, /閾値|障害Provider|危険|不健康/)
  assert.doesNotMatch(block, /\bcomplete\s*=\s*true\b/i)
})

test('9c T8: secrets not on All UsageEvent display path', async () => {
  // Status section only — Raw Billing Mode section (12-E B) may mention billingMode by design.
  const panel = await read('src/components/UsagePanel.tsx')
  const start = panel.indexOf('UsageEvent Provider Status — Monthly Population')
  const end = panel.indexOf('All UsageEvent Provider × Model')
  assert.ok(start >= 0 && end > start)
  const block = panel.slice(start, end)
  assert.doesNotMatch(block, /credentialId/)
  assert.doesNotMatch(block, /billingMode/)
  assert.doesNotMatch(block, /api[_-]?key/i)
  assert.doesNotMatch(block, /Authorization/)
  assert.doesNotMatch(block, /password/i)
  assert.doesNotMatch(block, /raw error/i)
  assert.doesNotMatch(block, /\bsecret\b/i)
})

test('9c T9: CSS + hierarchy; existing Failover Analysis preserved', async () => {
  const css = await read('src/components/UsagePanel.css')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(css, /\.usage-event-provider-status\b/)
  assert.match(css, /\.usage-event-provider-status-table\b/)
  assert.match(css, /\.usage-event-provider-status-note\b/)
  assert.match(panel, /usage-event-provider-status/)
  assert.match(css, /\.usage-failover-analysis\b/)
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover Analysis/)
  assert.match(panel, /Final Failed Providers/)
  assert.match(panel, /Reason Transitions/)
  assert.match(panel, /Daily Analysis/)
  assert.match(panel, /Router Failover Chain/)
})

test('9c T10: registered in run-all; Core/API files not changed by 9-C intent', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /ai-failover-phase-9c\.test\.mjs/)
  // Phase 9-B wiring must remain; 9-C must not re-implement Core in UI.
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /usage_event_provider_status:\s*usageEventProviderStatus/)
  assert.match(local, /analyzeUsageEventProviderStatus\s*\(\s*usageEvents\s*\)/)
})
