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

test('UsageService exposes routeMonthInsight and hints', async () => {
  const usage = await read('server/src/UsageService.php')
  assert.match(usage, /function routeMonthInsight/)
  assert.match(usage, /function buildRouteHints/)
  assert.match(usage, /'router' => self::routeMonthInsight/)
  assert.match(usage, /フォールバック率が/)
  assert.match(usage, /gemini_for_mid_tasks/)
  assert.match(usage, /'code' => 'light_on_expensive'/)
  assert.match(usage, /'code' => 'design_on_cheap'/)
})

test('ai_usage API returns router insight', async () => {
  const api = await read('server/api/ai_usage.php')
  assert.match(api, /'router' => \$detail\['router'\]/)
})

test('UsagePanel renders Router section and hints', async () => {
  const ui = await read('src/components/UsagePanel.tsx')
  assert.match(ui, /Router 振り分け/)
  assert.match(ui, /data\.router/)
  assert.match(ui, /usage-hints/)
  assert.match(ui, /by_task/)
  assert.match(ui, /直近の判定/)
  assert.match(ui, /formatBillingMode/)
  assert.match(ui, /billingMode/)
  assert.match(ui, /閉じる（今月は再表示しない）/)
  assert.match(ui, /dismissRouterHintCode/)
})

test('Usage recent rows expose BYOK / DEVELOPMENT billingMode', async () => {
  const {
    billingModeForUi,
    usageEventsToRecentRows,
    enrichRecentWithBillingMode
  } = await import('../electron/main/ai/usageBillingUi.ts')

  assert.equal(billingModeForUi('BYOK'), 'BYOK')
  assert.equal(billingModeForUi('DEVELOPMENT'), 'DEVELOPMENT')
  assert.equal(billingModeForUi('ORGANIZATION'), null)
  assert.equal(billingModeForUi(null), null)

  const events = [
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      estimatedCost: 0.001,
      timestamp: '2026-09-10T12:00:00.000Z',
      status: 'ok',
      billingMode: 'BYOK',
      credentialId: 'byok_openai_abc123def456'
    },
    {
      provider: 'claude',
      model: 'claude-sonnet-5',
      estimatedCost: 0.002,
      timestamp: '2026-09-10T12:01:00.000Z',
      status: 'ok',
      billingMode: 'DEVELOPMENT',
      credentialId: 'dev:claude'
    }
  ]
  const rows = usageEventsToRecentRows(events, 12)
  assert.equal(rows[0]?.billingMode, 'BYOK')
  assert.equal(rows[0]?.credentialId, 'byok_openai_abc123def456')
  assert.equal(rows[1]?.billingMode, 'DEVELOPMENT')
  assert.equal(rows[1]?.credentialId, 'dev:claude')
  assert.doesNotMatch(JSON.stringify(rows), /sk-|secret|apiKey/i)

  const enriched = enrichRecentWithBillingMode(
    [{ id: 9, engine: 'openai', created_at: '2026-09-10T12:00:05.000Z' }],
    events
  )
  assert.equal(enriched[0]?.billingMode, 'BYOK')
  assert.equal(enriched[0]?.credentialId, 'byok_openai_abc123def456')

  const mysqlStyle = enrichRecentWithBillingMode(
    [{ id: 10, engine: 'claude', created_at: '2026-09-10 12:01:10' }],
    events
  )
  assert.equal(mysqlStyle[0]?.billingMode, 'DEVELOPMENT')
  assert.equal(mysqlStyle[0]?.credentialId, 'dev:claude')

  const viaFallback = enrichRecentWithBillingMode(
    [{ id: 11, engine: 'openai', created_at: '2026-09-10 16:46:00' }],
    [],
    (engine) => (engine === 'openai' ? 'BYOK' : 'DEVELOPMENT')
  )
  assert.equal(viaFallback[0]?.billingMode, 'BYOK')
  assert.equal(viaFallback[0]?.credentialId, null)
})

test('UsagePanel recent history supports month filter and show more', async () => {
  const ui = await read('src/components/UsagePanel.tsx')
  const php = await read('server/src/UsageService.php')
  const api = await read('server/api/ai_usage.php')
  const local = await read('electron/main/localApi.ts')
  assert.match(ui, /listRecentMonthOptions/)
  assert.match(ui, /RECENT_PAGE_SIZE/)
  assert.match(ui, /もっと見る/)
  assert.match(ui, /\/ai\/usage\?month=/)
  assert.match(php, /normalizeMonth/)
  assert.match(php, /LIMIT 200/)
  assert.match(php, /\$month = null/)
  assert.match(api, /\$_GET\['month'\]/)
  assert.match(local, /query\.get\('month'\)/)
  assert.match(local, /usageEventsToRecentRows\(usageEvents, 200\)/)
})

test('UsagePanel fills billingMode when Main omits it', async () => {
  const ui = await read('src/components/UsagePanel.tsx')
  assert.match(ui, /attachBillingModes/)
  assert.match(ui, /listByokCredentials/)
  assert.match(ui, /byokEngines\.has\(engine\) \? 'BYOK' : 'DEVELOPMENT'/)
})

test('local /ai/usage wires router.recent billingMode; UI labels are fixed', async () => {
  const local = await read('electron/main/localApi.ts')
  const api = await read('electron/main/api.ts')
  const ui = await read('src/components/UsagePanel.tsx')
  assert.match(local, /usageEventsToRecentRows/)
  assert.match(local, /listPersistedUsageEvents/)
  assert.match(api, /enrichRecentWithBillingMode/)
  assert.match(api, /resolveCredential\(id\)\.billingMode/)
  assert.match(ui, /<th>課金<\/th>/)
  assert.match(ui, /<th>Credential<\/th>/)
  assert.match(ui, /return 'BYOK'/)
  assert.match(ui, /return 'DEVELOPMENT'/)
  assert.match(ui, /formatCredentialId/)
})

test('router hint dismiss helpers are month-scoped', async () => {
  const { currentUsageMonth, filterVisibleRouterHints } = await import(
    '../src/lib/routerHintDismiss.ts'
  )
  assert.match(currentUsageMonth(new Date('2026-09-10T00:00:00')), /^2026-09$/)
  const visible = filterVisibleRouterHints(
    [
      { code: 'light_on_expensive', text: 'a' },
      { code: 'design_on_cheap', text: 'b' },
      { code: 'profile_ok', text: 'c' }
    ],
    ['light_on_expensive', 'design_on_cheap']
  )
  assert.deepEqual(
    visible.map((row) => row.code),
    ['profile_ok']
  )
})

test('PIPELINE documents router log tuning UI', async () => {
  const doc = await read('docs/PIPELINE.md')
  assert.match(doc, /ai_route_log/)
  assert.match(doc, /振り分けヒント/)
})
