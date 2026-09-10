import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

test('isCreditOrQuotaError detects Anthropic / OpenAI billing failures', async () => {
  const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import(
    '../electron/main/lib/providerErrors.ts'
  )
  assert.equal(
    isCreditOrQuotaError('Your credit balance is too low to access the Anthropic API'),
    true
  )
  assert.equal(isCreditOrQuotaError('HTTP 402: Payment Required'), true)
  assert.equal(isCreditOrQuotaError('insufficient_quota'), true)
  assert.equal(isCreditOrQuotaError('rate limit exceeded'), false)
  assert.deepEqual(autoRuntimeFallbackEngines('claude', 'ask'), ['openai', 'gemini'])
  assert.deepEqual(autoRuntimeFallbackEngines('claude', 'agent'), ['openai'])
})

test('Auto runtime credit fallback is wired in api.ts', async () => {
  const api = await readFile(join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(api, /runtime_credit_fallback_from_/)
  assert.match(api, /emitErrors: false/)
  assert.match(api, /CREDIT_EXHAUSTED/)
  const guide = await readFile(join(root, 'src/lib/aiErrorGuide.ts'), 'utf8')
  assert.match(guide, /代替エンジンへ切り替え/)
})
