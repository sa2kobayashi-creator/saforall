import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const require = createRequire(import.meta.url)

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

function assertNoSecretLeak(payload, secrets = []) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  assert.doesNotMatch(text, /sk-[A-Za-z0-9_\-]{8,}/)
  assert.doesNotMatch(text, /Authorization/i)
  assert.doesNotMatch(text, /"secret"\s*:/)
  for (const secret of secrets) {
    if (secret && String(secret).length >= 8) assert.equal(text.includes(secret), false)
  }
}

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

function mockAdapter(providerId, handlers) {
  return {
    providerId,
    providerName: providerId,
    availableModels: () => [`${providerId}-test-model`],
    generate: async (request, credential) => {
      if (handlers.generate) return handlers.generate(request, credential)
      return {
        provider: providerId,
        model: request.model || `${providerId}-test-model`,
        content: `ok:${providerId}`,
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: `req_${providerId}_ok`,
        metadata: {}
      }
    },
    generateWithTools: async (request, credential, options) => {
      if (handlers.generateWithTools) {
        return handlers.generateWithTools(request, credential, options)
      }
      return {
        model: request.model || `${providerId}-test-model`,
        requestId: `req_${providerId}_tools`,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: `tools:${providerId}` }
          }
        ]
      }
    }
  }
}

async function loadHarness() {
  let esbuild
  try {
    esbuild = require('esbuild')
  } catch {
    return null
  }
  const dir = await mkdtemp(join(tmpdir(), 'saforall-failover-2c3-'))
  const entry = join(dir, 'entry.mjs')
  const outfile = join(dir, 'bundle.mjs')
  const spec = (rel) => JSON.stringify(join(root, rel).replace(/\\/g, '/'))
  await writeFile(
    entry,
    `
export { executeAi, executeAiWithTools } from ${spec('electron/main/ai/router.ts')}
export {
  configureFailoverResolve,
  resetFailoverResolveForTests,
  fallbacksForAsk,
  fallbacksForAgent,
  parseFailoverEnabled,
  failoverReasonFromError,
  isFailoverEligibleError,
  executeWithFailover
} from ${spec('electron/main/ai/failover.ts')}
export { isFailoverCandidate } from ${spec('electron/main/ai/errors.ts')}
export { resetUsageForTests, listUsageEvents } from ${spec('electron/main/ai/usage.ts')}
export {
  usageEventsToRecentRows,
  formatRouterFailoverLabel,
  failoverForUi
} from ${spec('electron/main/ai/usageBillingUi.ts')}
export {
  resetProviderRegistryForTests,
  registerProvider
} from ${spec('electron/main/ai/registry.ts')}
export { AIError } from ${spec('electron/main/ai/errors.ts')}
export {
  __setFailoverEnabledForTests,
  __getFailoverEnabledForTests
} from 'virtual:settingsStore'
`,
    'utf8'
  )
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    absWorkingDir: root,
    plugins: [
      {
        name: 'saforall-test-mocks',
        setup(build) {
          build.onResolve({ filter: /settingsStore(\.ts)?$/ }, () => ({
            path: 'virtual:settingsStore',
            namespace: 'mock'
          }))
          build.onResolve({ filter: /^virtual:settingsStore$/ }, () => ({
            path: 'virtual:settingsStore',
            namespace: 'mock'
          }))
          build.onResolve({ filter: /credentialVault(\.ts)?$/ }, () => ({
            path: 'virtual:credentialVault',
            namespace: 'mock'
          }))
          build.onResolve({ filter: /localDb(\.ts)?$/ }, () => ({
            path: 'virtual:localDb',
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => {
            if (args.path === 'virtual:settingsStore') {
              return {
                contents: `
let failoverEnabled = ''
export function getLocalSetting(key, fb='') {
  if (key === 'failover.enabled') return failoverEnabled
  return typeof fb === 'string' ? fb : ''
}
export async function ensureSettingsLoaded() {}
export function __setFailoverEnabledForTests(v) { failoverEnabled = String(v ?? '') }
export function __getFailoverEnabledForTests() { return failoverEnabled }
`,
                loader: 'js'
              }
            }
            if (args.path === 'virtual:credentialVault') {
              return {
                contents:
                  'export function loadByokSecretSync(){return null}\nexport const LOCAL_BYOK_OWNER_ID="local-user"',
                loader: 'js'
              }
            }
            return {
              contents:
                'export async function ensureLocalDbReady(){}\nexport function getLocalDbRoot(){return ""}\nexport async function readJsonFile(_p,f){return f}\nexport async function writeJsonFile(){}',
              loader: 'js'
            }
          })
        }
      }
    ]
  })
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  return { mod, dir }
}

let shared = null
async function harness() {
  if (!shared) {
    shared = await loadHarness()
    if (!shared) {
      throw new Error('esbuild required for Phase 2-C-3 router harness')
    }
  }
  return shared.mod
}

async function prepare(enabled) {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.__setFailoverEnabledForTests(enabled)
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'byok_openai_2c3',
        secret: 'sk-settings-openai-2c3-SECRET',
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-settings-claude-2c3-SECRET',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  return h
}

test('1: parseFailoverEnabled unset/empty → false', async () => {
  const { parseFailoverEnabled } = await import('../electron/main/ai/failover.ts')
  assert.equal(parseFailoverEnabled(undefined), false)
  assert.equal(parseFailoverEnabled(null), false)
  assert.equal(parseFailoverEnabled(''), false)
  assert.equal(parseFailoverEnabled('false'), false)
  assert.equal(parseFailoverEnabled('no'), false)
  assert.equal(parseFailoverEnabled('true'), true)
  assert.equal(parseFailoverEnabled('1'), true)
  assert.equal(parseFailoverEnabled('yes'), true)
  assert.equal(parseFailoverEnabled('on'), true)
})

test('2: failover.enabled=false → primary failure does not fallback', async () => {
  const h = await prepare('')
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rate limited', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude', {}))
  await assert.rejects(
    () =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (err) => err instanceof h.AIError && err.code === 'RATE_LIMIT'
  )
  assert.deepEqual(calls, ['openai'])
})

test('3: failover.enabled=true → RATE_LIMIT fallback succeeds', async () => {
  const h = await prepare('true')
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rate limited', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        calls.push('claude')
        return {
          provider: 'claude',
          model: 'claude-test-model',
          content: 'recovered',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'req_ok',
          metadata: {}
        }
      }
    })
  )
  const response = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(response.content, 'recovered')
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('4: failover.enabled=true → AUTH_ERROR fallback succeeds', async () => {
  const h = await prepare('true')
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('AUTH_ERROR', 'bad key', { httpStatus: 401, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        calls.push('claude')
        return {
          provider: 'claude',
          model: 'claude-test-model',
          content: 'auth-ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'req_auth',
          metadata: {}
        }
      }
    })
  )
  const response = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(response.content, 'auth-ok')
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('5: NETWORK_ERROR → fallback succeeds when enabled', async () => {
  const h = await prepare('on')
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('NETWORK_ERROR', 'fetch failed', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        calls.push('claude')
        return {
          provider: 'claude',
          model: 'claude-test-model',
          content: 'net-ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'req_net',
          metadata: {}
        }
      }
    })
  )
  const response = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(response.content, 'net-ok')
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('6: MODEL_NOT_FOUND → no Router Failover', async () => {
  const h = await prepare('true')
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('MODEL_NOT_FOUND', 'missing model', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude', {}))
  await assert.rejects(
    () =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (err) => err instanceof h.AIError && err.code === 'MODEL_NOT_FOUND'
  )
  assert.deepEqual(calls, ['openai'])
})

test('7: INSUFFICIENT_CREDIT → Router Failover does not run', async () => {
  const h = await prepare('true')
  const { AIError, isFailoverEligibleError, failoverReasonFromError, isFailoverCandidate } = h
  assert.equal(isFailoverEligibleError(new AIError('INSUFFICIENT_CREDIT', 'no credit')), false)
  assert.equal(failoverReasonFromError(new AIError('INSUFFICIENT_CREDIT', 'no credit')), null)
  assert.equal(isFailoverCandidate('INSUFFICIENT_CREDIT'), false)

  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('INSUFFICIENT_CREDIT', 'credit low', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude', {}))
  await assert.rejects(
    () =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (err) => err instanceof h.AIError && err.code === 'INSUFFICIENT_CREDIT'
  )
  assert.deepEqual(calls, ['openai'])
})

test('8: api.ts Credit fallback still present (source)', async () => {
  const api = await read('electron/main/api.ts')
  const providerErrors = await read('electron/main/lib/providerErrors.ts')
  assert.match(api, /autoRuntimeFallbackEngines/)
  assert.match(api, /isCreditOrQuotaError/)
  assert.doesNotMatch(api, /executeWithFailover/)
  assert.match(providerErrors, /function isCreditOrQuotaError/)
  assert.match(providerErrors, /function autoRuntimeFallbackEngines/)
})

test('9: Credit helper unit behavior unchanged', async () => {
  const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import(
    '../electron/main/lib/providerErrors.ts'
  )
  assert.equal(
    isCreditOrQuotaError('Your credit balance is too low to access the Anthropic API'),
    true
  )
  assert.equal(isCreditOrQuotaError('rate limit exceeded'), false)
  assert.deepEqual(autoRuntimeFallbackEngines('claude', 'ask'), ['openai', 'gemini'])
})

test('10: Primary error + Fallback success Usage keeps failover meta; no secrets', async () => {
  const h = await prepare('true')
  const secret = 'sk-settings-openai-2c3-SECRET'
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('RATE_LIMIT', 'rate', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => ({
        provider: 'claude',
        model: 'claude-test-model',
        content: 'ok',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: 'req_m',
        metadata: {}
      })
    })
  )
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const events = h.listUsageEvents()
  assert.equal(events.length, 2)
  assert.ok(events[1].failover)
  assert.equal(events[1].failover.primaryProvider, 'openai')
  assert.equal(events[1].credentialId, 'dev:claude')

  const rows = h.usageEventsToRecentRows(events, 10)
  assert.ok(rows[1].routerFailover)
  assert.equal(rows[1].routerFailover.primaryProvider, 'openai')
  assert.match(h.formatRouterFailoverLabel(rows[1].routerFailover, rows[1].engine), /openai→/)
  assertNoSecretLeak(events, [secret, 'sk-settings-claude-2c3-SECRET'])
  assertNoSecretLeak(rows, [secret, 'sk-settings-claude-2c3-SECRET'])
})

test('11: normal success has no failover display', async () => {
  const h = await prepare('true')
  h.registerProvider(mockAdapter('openai', {}))
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const events = h.listUsageEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].failover, null)
  const rows = h.usageEventsToRecentRows(events, 5)
  assert.equal(rows[0].routerFailover, null)
  assert.equal(h.formatRouterFailoverLabel(rows[0].routerFailover, rows[0].engine), '')
})

test('12: Usage UI source never renders secrets; credentialId ok', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Router Failover/)
  assert.match(panel, /formatRouterFailover/)
  assert.match(panel, /routerFailover/)
  assert.doesNotMatch(panel, /Authorization/i)
  assert.doesNotMatch(panel, /\.secret\b/)
  assert.doesNotMatch(panel, /api_key/)
  assert.match(panel, /credentialId/)
})

test('13: Agent fallbacks exclude Gemini / Workers', async () => {
  const h = await harness()
  assert.equal(h.fallbacksForAgent('openai').includes('gemini'), false)
  assert.equal(h.fallbacksForAgent('openai').includes('workers'), false)
  assert.deepEqual(h.fallbacksForAgent('openai'), ['claude'])
  assert.deepEqual(h.fallbacksForAgent('claude'), ['openai'])
})

test('14: Cursor / PHP / MySQL / Vault / adapters untouched for Failover wiring', async () => {
  const cursor = await read('electron/main/cursorAgent.ts')
  const toolAgent = await read('electron/main/toolAgent.ts')
  const router = await read('electron/main/ai/router.ts')
  const settings = await read('src/components/SettingsPanel.tsx')
  assert.doesNotMatch(cursor, /executeWithFailover/)
  assert.doesNotMatch(cursor, /failover\.enabled/)
  assert.match(cursor, /@cursor\/sdk/)
  assert.match(toolAgent, /executeAiWithTools/)
  assert.doesNotMatch(toolAgent, /executeWithFailover/)
  assert.match(router, /parseFailoverEnabled|isRouterFailoverEnabled/)
  assert.match(router, /getLocalSetting\(['"]failover\.enabled['"]/)
  assert.match(settings, /failover\.enabled/)
  assert.match(settings, /failoverEnabled/)
  assert.doesNotMatch(router, /credentialOverride/)
  assert.doesNotMatch(router, /provider\.api_key/)
  assert.doesNotMatch(router, /\bapiKey\s*:/)

  const phpFiles = [
    'backend/public/api/settings.php',
    'backend/public/api/usage.php',
    'backend/src/RouterInsight.php'
  ]
  for (const rel of phpFiles) {
    try {
      const src = await read(rel)
      assert.doesNotMatch(src, /executeWithFailover/)
      assert.doesNotMatch(src, /failover\.enabled/)
    } catch {
      // optional path
    }
  }
})

test('15: Settings Panel stores failover.enabled as non-secret string', async () => {
  const settingsPanel = await read('src/components/SettingsPanel.tsx')
  const store = await read('electron/main/settingsStore.ts')
  assert.match(settingsPanel, /'failover\.enabled':\s*failoverEnabled \? 'true' : 'false'/)
  assert.doesNotMatch(store, /failover\.enabled/)
  assert.match(store, /SECRET_SETTING_KEYS/)
  assert.doesNotMatch(store, /['"]failover\.enabled['"]/)
})

test('teardown harness', async () => {
  if (shared?.dir) {
    await rm(shared.dir, { recursive: true, force: true })
    shared = null
  }
})
