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

function assertNoSecretLeak(payload, secrets = []) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  assert.doesNotMatch(text, /sk-[A-Za-z0-9_\-]{8,}/)
  assert.doesNotMatch(text, /Authorization/i)
  assert.doesNotMatch(text, /"secret"\s*:/)
  for (const secret of secrets) {
    if (secret && secret.length >= 8) assert.equal(text.includes(secret), false)
  }
}

/** Test double that mimics CredentialResolver priority per provider (no settingsStore). */
function makeResolve(map) {
  return (input) => {
    const row = map[input.providerId]
    if (!row) {
      return {
        credential: null,
        available: false,
        billingMode: 'DEVELOPMENT',
        reason: 'missing'
      }
    }
    return {
      credential: {
        id: row.id,
        providerId: input.providerId,
        ownerType: row.ownerType || 'development',
        billingMode: row.billingMode,
        source: row.source || 'settings',
        secret: row.secret,
        baseUrl: 'https://example.test',
        extra: {}
      },
      available: true,
      billingMode: row.billingMode,
      reason: row.reason || `development:${row.source || 'settings'}`
    }
  }
}

test('A: Failover disabled → does not failover', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { createFailoverContext, shouldFailover } = await import(
    '../electron/main/ai/failover.ts'
  )
  const config = {
    enabled: false,
    primaryProvider: 'openai',
    fallbackProviders: ['claude'],
    resolve: makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-settings-openai-primaryxx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-settings-claude-fallback',
        billingMode: 'DEVELOPMENT'
      }
    })
  }
  const context = createFailoverContext(config)
  const decision = shouldFailover(
    new AIError('RATE_LIMIT', 'rate limit', { providerId: 'openai' }),
    context,
    config
  )
  assert.equal(decision.shouldFailover, false)
  assert.equal(decision.reason, 'disabled')
  assert.equal(decision.nextProvider, null)
})

test('B: Failover enabled → can select fallback provider', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { createFailoverContext, selectFallbackCredential, shouldFailover } = await import(
    '../electron/main/ai/failover.ts'
  )
  const config = {
    enabled: true,
    primaryProvider: 'openai',
    fallbackProviders: ['claude'],
    maxFailoverAttempts: 1,
    resolve: makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-settings-openai-primaryxx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-settings-claude-fallback',
        billingMode: 'DEVELOPMENT'
      }
    })
  }
  const context = createFailoverContext(config)
  const decision = shouldFailover(
    new AIError('RATE_LIMIT', 'too many requests', { providerId: 'openai' }),
    context,
    config
  )
  assert.equal(decision.shouldFailover, true)
  assert.equal(decision.nextProvider, 'claude')
  const selected = selectFallbackCredential(context, config)
  assert.equal(selected?.providerId, 'claude')
  assert.equal(selected?.credential.providerId, 'claude')
})

test('C: same provider is never selected as fallback', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { createFailoverContext, selectNextFallbackProvider, shouldFailover } = await import(
    '../electron/main/ai/failover.ts'
  )
  const config = {
    enabled: true,
    primaryProvider: 'openai',
    fallbackProviders: ['openai', 'openai'],
    resolve: makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-settings-openai-onlyxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  }
  const context = createFailoverContext(config)
  assert.equal(selectNextFallbackProvider(context, config), null)
  const decision = shouldFailover(
    new AIError('NETWORK_ERROR', 'fetch failed', { providerId: 'openai' }),
    context,
    config
  )
  assert.equal(decision.shouldFailover, false)
  assert.equal(decision.reason, 'no_fallback')
})

test('D/E/F/G: eligible error classification', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { isFailoverEligibleError, failoverReasonFromError } = await import(
    '../electron/main/ai/failover.ts'
  )
  assert.equal(
    isFailoverEligibleError(new AIError('AUTH_ERROR', 'unauthorized', { httpStatus: 401 })),
    true
  )
  assert.equal(failoverReasonFromError(new AIError('AUTH_ERROR', 'x')), 'auth_error')
  assert.equal(
    isFailoverEligibleError(new AIError('RATE_LIMIT', 'rate limit', { httpStatus: 429 })),
    true
  )
  assert.equal(failoverReasonFromError(new AIError('RATE_LIMIT', 'x')), 'rate_limit')
  assert.equal(
    isFailoverEligibleError(new AIError('PROVIDER_ERROR', 'HTTP 503', { httpStatus: 503 })),
    true
  )
  assert.equal(
    failoverReasonFromError(new AIError('PROVIDER_ERROR', 'x')),
    'provider_unavailable'
  )
  assert.equal(isFailoverEligibleError(new AIError('NETWORK_ERROR', 'fetch failed')), true)
  assert.equal(failoverReasonFromError(new AIError('NETWORK_ERROR', 'x')), 'network_error')
  assert.equal(isFailoverEligibleError(new AIError('TIMEOUT', 'timed out')), true)
  assert.equal(failoverReasonFromError(new AIError('TIMEOUT', 'x')), 'timeout')
})

test('H: non-eligible errors do not failover', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { createFailoverContext, isFailoverEligibleError, shouldFailover } = await import(
    '../electron/main/ai/failover.ts'
  )
  const config = {
    enabled: true,
    primaryProvider: 'openai',
    fallbackProviders: ['claude'],
    resolve: makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-settings-shared-keyxxxx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-settings-shared-keyxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  }
  const context = createFailoverContext(config)
  for (const code of ['MODEL_NOT_FOUND', 'AGENT_UNSUPPORTED', 'UNKNOWN', 'INSUFFICIENT_CREDIT']) {
    const error = new AIError(code, `err-${code}`, { providerId: 'openai' })
    assert.equal(isFailoverEligibleError(error), false)
    const decision = shouldFailover(error, context, config)
    assert.equal(decision.shouldFailover, false)
    assert.equal(decision.reason, 'not_eligible')
  }
})

test('I: primary and fallback credentials are not mixed across providers', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { executeWithFailover } = await import('../electron/main/ai/failover.ts')
  const openaiSecret = 'sk-settings-openai-PRIMARY-secret'
  const claudeSecret = 'sk-settings-claude-FALLBACK-secret'
  const seen = []
  const result = await executeWithFailover(
    {
      enabled: true,
      primaryProvider: 'openai',
      fallbackProviders: ['claude'],
      maxFailoverAttempts: 1,
      resolve: makeResolve({
        openai: {
          id: 'byok_openai_primary01',
          secret: openaiSecret,
          billingMode: 'BYOK',
          ownerType: 'user',
          source: 'byok',
          reason: 'byok'
        },
        claude: {
          id: 'dev:claude',
          secret: claudeSecret,
          billingMode: 'DEVELOPMENT'
        }
      })
    },
    async ({ providerId, credential }) => {
      seen.push({ providerId, credentialId: credential.id, secret: credential.secret })
      if (providerId === 'openai') {
        throw new AIError('RATE_LIMIT', 'rate limit', { providerId: 'openai' })
      }
      return 'ok-from-claude'
    }
  )
  assert.equal(result.ok, true)
  assert.equal(result.value, 'ok-from-claude')
  assert.equal(seen.length, 2)
  assert.equal(seen[0].providerId, 'openai')
  assert.equal(seen[0].secret, openaiSecret)
  assert.equal(seen[1].providerId, 'claude')
  assert.equal(seen[1].secret, claudeSecret)
  assert.notEqual(seen[0].credentialId, seen[1].credentialId)
  assert.equal(seen[0].credentialId, 'byok_openai_primary01')
  assert.equal(seen[1].credentialId, 'dev:claude')
})

test('J: BYOK/dev secrets never appear in failover context / usage meta / sources', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { executeWithFailover, failoverUsageMetaFromContext } = await import(
    '../electron/main/ai/failover.ts'
  )
  const secret = 'sk-byok-MUST-NOT-LEAK-1234567890'
  const outcome = await executeWithFailover(
    {
      enabled: true,
      primaryProvider: 'openai',
      fallbackProviders: ['claude'],
      resolve: makeResolve({
        openai: {
          id: 'byok_openai_leakcheck',
          secret,
          billingMode: 'BYOK',
          ownerType: 'user',
          source: 'byok',
          reason: 'byok'
        },
        claude: {
          id: 'dev:claude',
          secret,
          billingMode: 'DEVELOPMENT'
        }
      })
    },
    async ({ providerId }) => {
      if (providerId === 'openai') {
        throw new AIError('AUTH_ERROR', 'invalid api key', { providerId: 'openai' })
      }
      return 'recovered'
    }
  )
  assert.equal(outcome.ok, true)
  assertNoSecretLeak(outcome.context, [secret])
  const meta = failoverUsageMetaFromContext(outcome.context)
  assertNoSecretLeak(meta, [secret])
  assertNoSecretLeak(
    {
      provider: outcome.providerId,
      credentialId: outcome.credentialId,
      billingMode: outcome.billingMode,
      failover: meta
    },
    [secret]
  )

  const failoverSrc = await read('electron/main/ai/failover.ts')
  const usageSrc = await read('electron/main/ai/usage.ts')
  const indexSrc = await read('electron/main/ai/index.ts')
  assert.doesNotMatch(failoverSrc, /\bcredentialOverride\b/)
  assert.doesNotMatch(failoverSrc, /provider\.api_key/)
  assert.doesNotMatch(failoverSrc, /\bapiKey\s*:/)
  assert.match(indexSrc, /resolveCredential\(\{/)
  assert.match(indexSrc, /configureFailoverResolve/)
  assert.match(usageSrc, /failover\?:/)
  assert.doesNotMatch(usageSrc, /Authorization/)
})

test('K: CredentialResolver priority BYOK → settings → env is unchanged', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  assert.deepEqual(pickCredentialPriority('sk-byok-aaaa', 'sk-settings', 'sk-env'), {
    secret: 'sk-byok-aaaa',
    source: 'byok'
  })
  assert.deepEqual(pickCredentialPriority('', 'sk-settings', 'sk-env'), {
    secret: 'sk-settings',
    source: 'settings'
  })
  const failover = await read('electron/main/ai/failover.ts')
  const indexSrc = await read('electron/main/ai/index.ts')
  assert.match(failover, /FailoverCredentialResolve/)
  assert.doesNotMatch(failover, /\bcredentialOverride\b/)
  assert.match(indexSrc, /configureFailoverResolve\(\(input\) =>/)
  assert.match(indexSrc, /resolveCredential\(\{/)
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(creds, /Priority: BYOK → Development settings → Development env/)
})

test('L: failover does not loop infinitely', async () => {
  const { AIError } = await import('../electron/main/ai/errors.ts')
  const { executeWithFailover } = await import('../electron/main/ai/failover.ts')
  let calls = 0
  const result = await executeWithFailover(
    {
      enabled: true,
      primaryProvider: 'openai',
      fallbackProviders: ['claude', 'gemini'],
      maxFailoverAttempts: 1,
      resolve: makeResolve({
        openai: {
          id: 'dev:openai',
          secret: 'sk-settings-openai-loopxxxx',
          billingMode: 'DEVELOPMENT'
        },
        claude: {
          id: 'dev:claude',
          secret: 'sk-settings-claude-loopxxxx',
          billingMode: 'DEVELOPMENT'
        },
        gemini: {
          id: 'dev:gemini',
          secret: 'sk-settings-gemini-loopxxxx',
          billingMode: 'DEVELOPMENT'
        }
      })
    },
    async ({ providerId }) => {
      calls += 1
      throw new AIError('PROVIDER_ERROR', `down-${providerId}`, { providerId })
    }
  )
  assert.equal(result.ok, false)
  assert.equal(calls, 2)
  assert.ok(calls < 5)
  assert.deepEqual(result.context.visitedProviders, ['openai', 'claude'])
  assert.equal(result.context.attempts.length, 2)
})

test('Phase 2-C-1: UI / Cursor / PHP untouched by Failover foundation', async () => {
  const settings = await read('src/components/SettingsPanel.tsx')
  const usageUi = await read('src/components/UsagePanel.tsx')
  const cursor = await read('electron/main/cursorAgent.ts')
  const php = await read('server/src/UsageService.php')
  assert.doesNotMatch(settings, /executeWithFailover|FailoverConfig/)
  assert.doesNotMatch(usageUi, /executeWithFailover|FailoverConfig/)
  assert.doesNotMatch(cursor, /executeWithFailover/)
  assert.doesNotMatch(php, /failover/)
})
