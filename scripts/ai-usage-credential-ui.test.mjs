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

test('usageEventsToRecentRows passes credentialId from UsageEvent', async () => {
  const {
    usageEventsToRecentRows,
    formatCredentialIdShort,
    credentialIdForUi
  } = await import('../electron/main/ai/usageBillingUi.ts')

  const byokId = 'byok_openai_a1b2c3d4e5f6'
  const rows = usageEventsToRecentRows(
    [
      {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        estimatedCost: 0.001,
        timestamp: '2026-09-10T12:00:00.000Z',
        status: 'ok',
        billingMode: 'BYOK',
        credentialId: byokId
      },
      {
        provider: 'claude',
        model: 'claude-sonnet',
        estimatedCost: 0.002,
        timestamp: '2026-09-10T12:01:00.000Z',
        status: 'ok',
        billingMode: 'DEVELOPMENT',
        credentialId: 'dev:claude'
      },
      {
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        estimatedCost: 0,
        timestamp: '2026-09-10T12:02:00.000Z',
        status: 'ok',
        billingMode: 'DEVELOPMENT'
      }
    ],
    10
  )

  assert.equal(rows[0]?.credentialId, byokId)
  assert.equal(rows[0]?.billingMode, 'BYOK')
  assert.equal(rows[1]?.credentialId, 'dev:claude')
  assert.equal(rows[1]?.billingMode, 'DEVELOPMENT')
  assert.equal(rows[2]?.credentialId, null)
  assert.equal(credentialIdForUi(''), null)
  assert.equal(formatCredentialIdShort('dev:openai'), 'dev:openai')
  assert.equal(formatCredentialIdShort(byokId), 'byok_opena…e5f6')
  assert.equal(formatCredentialIdShort(null), '—')
  assert.doesNotMatch(JSON.stringify(rows), /sk-|api[_-]?key|secret/i)
})

test('enrichRecentWithBillingMode attaches credentialId from matched event only', async () => {
  const { enrichRecentWithBillingMode } = await import(
    '../electron/main/ai/usageBillingUi.ts'
  )

  const events = [
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      estimatedCost: 0.001,
      timestamp: '2026-09-10T12:00:00.000Z',
      billingMode: 'BYOK',
      credentialId: 'byok_openai_deadbeef1234'
    }
  ]

  const matched = enrichRecentWithBillingMode(
    [{ id: 1, engine: 'openai', created_at: '2026-09-10T12:00:05.000Z' }],
    events
  )
  assert.equal(matched[0]?.billingMode, 'BYOK')
  assert.equal(matched[0]?.credentialId, 'byok_openai_deadbeef1234')

  const viaFallbackOnly = enrichRecentWithBillingMode(
    [{ id: 2, engine: 'openai', created_at: '2026-09-10T16:00:00.000Z' }],
    [],
    () => 'BYOK'
  )
  assert.equal(viaFallbackOnly[0]?.billingMode, 'BYOK')
  assert.equal(viaFallbackOnly[0]?.credentialId, null)

  const alreadyHas = enrichRecentWithBillingMode(
    [
      {
        id: 3,
        engine: 'claude',
        created_at: '2026-09-10T12:00:00.000Z',
        billingMode: 'DEVELOPMENT',
        credentialId: 'dev:claude'
      }
    ],
    events
  )
  assert.equal(alreadyHas[0]?.credentialId, 'dev:claude')
})

test('UsagePanel Credential column uses shortened display; no secret fields', async () => {
  const ui = await read('src/components/UsagePanel.tsx')
  const local = await read('electron/main/localApi.ts')
  const billing = await read('electron/main/ai/usageBillingUi.ts')

  assert.match(ui, /<th>Credential<\/th>/)
  assert.match(ui, /formatCredentialId/)
  assert.match(ui, /row\.credentialId/)
  assert.match(ui, /Never invent or overwrite credentialId/)
  assert.match(local, /credentialId comes only from UsageEvent/)
  assert.match(billing, /Do not invent credentialId/)
  assert.doesNotMatch(ui, /apiKey|api_key|secretKey/i)
  assert.doesNotMatch(billing, /apiKey|api_key|secretKey|sk-[a-zA-Z0-9]/i)
})

test('recordUsage / router still write credentialId without secrets', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  const router = await read('electron/main/ai/router.ts')
  assert.match(usage, /credentialId\?: string \| null/)
  assert.match(router, /credentialId:/)
  assert.doesNotMatch(router, /credential\.apiKey|credential\.secret/)
})
