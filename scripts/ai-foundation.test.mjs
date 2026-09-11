import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

test('Provider Registry registers OpenAI / Gemini / Claude / Workers', async () => {
  const registry = await readFile(join(root, 'electron/main/ai/registry.ts'), 'utf8')
  assert.match(registry, /export function registerProvider/)
  assert.match(registry, /export function getProvider/)
  assert.match(registry, /openaiAdapter/)
  assert.match(registry, /geminiAdapter/)
  assert.match(registry, /claudeAdapter/)
  assert.match(registry, /workersAdapter/)
  const kinds = await readFile(join(root, 'electron/main/ai/types.ts'), 'utf8')
  assert.match(kinds, /cursor: 'coding_agent'/)
  assert.match(kinds, /openai: 'llm'/)
})

test('Development Credential prefers settings then existing env names', async () => {
  const { pickDevelopmentSecret } = await import('../electron/main/ai/credentialLogic.ts')
  assert.deepEqual(pickDevelopmentSecret('sk-settings-openai-keyxx', 'sk-env'), {
    secret: 'sk-settings-openai-keyxx',
    source: 'settings'
  })
  assert.deepEqual(pickDevelopmentSecret('', 'sk-ant-env-claude-keyxx'), {
    secret: 'sk-ant-env-claude-keyxx',
    source: 'env'
  })
  assert.deepEqual(pickDevelopmentSecret('  ', ''), { secret: '', source: '' })

  const cred = await readFile(join(root, 'electron/main/ai/credentials.ts'), 'utf8')
  assert.match(cred, /OPENAI_API_KEY/)
  assert.match(cred, /GEMINI_API_KEY/)
  assert.match(cred, /ANTHROPIC_API_KEY/)
  assert.match(cred, /CLOUDFLARE_API_TOKEN/)
  assert.match(cred, /CURSOR_API_KEY/)
  assert.doesNotMatch(cred, /CLOUDFLARE_API_KEY/)
  assert.match(cred, /export function resolveCredential/)
  assert.match(cred, /AUTH_ERROR/)
})

test('Router uses registry + credential resolver and records usage (no billing)', async () => {
  const router = await readFile(join(root, 'electron/main/ai/router.ts'), 'utf8')
  assert.match(router, /export async function executeAi/)
  assert.match(router, /getProvider\(providerId\)/)
  assert.match(router, /resolveCredential/)
  assert.match(router, /executeWithFailover/)
  assert.doesNotMatch(router, /credentialOverride/)
  assert.match(router, /recordUsage/)
  assert.match(router, /routingMode/)
  assert.doesNotMatch(router, /billing\.user_plan/)
  assert.doesNotMatch(router, /user\.credit/)
  assert.match(router, /isLlmProviderId/)
})

test('common AIError maps rate limit and auth failures', async () => {
  const { classifyProviderError, redactSecrets } = await import(
    '../electron/main/ai/errors.ts'
  )
  assert.equal(classifyProviderError('HTTP 429: rate limit exceeded'), 'RATE_LIMIT')
  assert.equal(classifyProviderError('invalid api key', 401), 'AUTH_ERROR')
  assert.equal(classifyProviderError('Your credit balance is too low'), 'INSUFFICIENT_CREDIT')
  const secret = 'sk-ant-super-secret-value-1234'
  const redacted = redactSecrets(`Authorization: Bearer ${secret}`, [secret])
  assert.equal(redacted.includes(secret), false)
  assert.match(redacted, /Bearer \*\*\*/)
})

test('Usage tracker and cost calculator are separated from the Router', async () => {
  const usage = await readFile(join(root, 'electron/main/ai/usage.ts'), 'utf8')
  const cost = await readFile(join(root, 'electron/main/ai/cost.ts'), 'utf8')
  assert.match(usage, /export async function recordUsage/)
  assert.match(usage, /inputTokens/)
  assert.match(usage, /outputTokens/)
  assert.match(usage, /requestId/)
  assert.match(cost, /export function estimateCostUsd/)
  assert.doesNotMatch(
    await readFile(join(root, 'electron/main/ai/router.ts'), 'utf8'),
    /const RATES/
  )
})

test('wiring: Ask/Agent go through Resolver; generateAssistantText uses executeAi; Cursor stays', async () => {
  const local = await readFile(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  const direct = await readFile(join(root, 'electron/main/directLlm.ts'), 'utf8')
  const cursor = await readFile(join(root, 'electron/main/cursorAgent.ts'), 'utf8')
  const settings = await readFile(join(root, 'electron/main/settingsStore.ts'), 'utf8')
  assert.match(local, /resolveCredential/)
  assert.match(direct, /executeAi/)
  assert.match(direct, /runCursorAgent/)
  assert.match(cursor, /export async function runCursorAgent/)
  assert.match(settings, /OPENAI_API_KEY/)
  assert.match(settings, /ANTHROPIC_API_KEY/)
})
