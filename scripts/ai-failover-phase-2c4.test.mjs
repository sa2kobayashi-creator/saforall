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

function mockAdapter(providerId, handlers = {}) {
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

const FULL_RESOLVE = {
  openai: {
    id: 'byok_openai_2c4',
    secret: 'sk-settings-openai-2c4-SECRET',
    billingMode: 'BYOK',
    ownerType: 'user',
    source: 'byok',
    reason: 'byok'
  },
  claude: {
    id: 'dev:claude',
    secret: 'sk-settings-claude-2c4-SECRET',
    billingMode: 'DEVELOPMENT'
  },
  gemini: {
    id: 'byok_gemini_2c4',
    secret: 'sk-settings-gemini-2c4-SECRET',
    billingMode: 'BYOK',
    ownerType: 'user',
    source: 'byok',
    reason: 'byok'
  },
  workers: {
    id: 'dev:workers',
    secret: 'sk-settings-workers-2c4-SECRET',
    billingMode: 'DEVELOPMENT'
  }
}

async function loadHarness() {
  let esbuild
  try {
    esbuild = require('esbuild')
  } catch {
    return null
  }
  const dir = await mkdtemp(join(tmpdir(), 'saforall-failover-2c4-'))
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
  parseFailoverMaxAttempts,
  normalizeMaxFailoverAttempts,
  ASK_FAILOVER_MAX_ATTEMPTS,
  AGENT_FAILOVER_MAX_ATTEMPTS,
  failoverReasonFromError,
  isFailoverEligibleError,
  executeWithFailover,
  createFailoverContext,
  shouldFailover
} from ${spec('electron/main/ai/failover.ts')}
export { isFailoverCandidate } from ${spec('electron/main/ai/errors.ts')}
export { resetUsageForTests, listUsageEvents } from ${spec('electron/main/ai/usage.ts')}
export {
  resetProviderRegistryForTests,
  registerProvider
} from ${spec('electron/main/ai/registry.ts')}
export { AIError } from ${spec('electron/main/ai/errors.ts')}
export {
  __setFailoverEnabledForTests,
  __setFailoverMaxAttemptsForTests,
  __resetFailoverSettingsForTests
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
let failoverEnabled = 'true'
let failoverMaxAttempts = ''
export function getLocalSetting(key, fb='') {
  if (key === 'failover.enabled') return failoverEnabled
  if (key === 'failover.max_attempts') return failoverMaxAttempts
  return typeof fb === 'string' ? fb : ''
}
export async function ensureSettingsLoaded() {}
export function __setFailoverEnabledForTests(v) { failoverEnabled = String(v ?? '') }
export function __setFailoverMaxAttemptsForTests(v) { failoverMaxAttempts = String(v ?? '') }
export function __resetFailoverSettingsForTests() {
  failoverEnabled = 'true'
  failoverMaxAttempts = ''
}
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
    if (!shared) throw new Error('esbuild required for Phase 2-C-4 harness')
  }
  return shared.mod
}

async function prepare({ enabled = 'true', maxAttempts = '', resolveMap = FULL_RESOLVE } = {}) {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.__resetFailoverSettingsForTests()
  h.__setFailoverEnabledForTests(enabled)
  h.__setFailoverMaxAttemptsForTests(maxAttempts)
  h.configureFailoverResolve(makeResolve(resolveMap))
  return h
}

test('parse: max_attempts unset/invalid → 1; clamp Ask≤3 Agent≤1', async () => {
  const {
    parseFailoverMaxAttempts,
    normalizeMaxFailoverAttempts,
    ASK_FAILOVER_MAX_ATTEMPTS,
    AGENT_FAILOVER_MAX_ATTEMPTS
  } = await import('../electron/main/ai/failover.ts')
  assert.equal(ASK_FAILOVER_MAX_ATTEMPTS, 3)
  assert.equal(AGENT_FAILOVER_MAX_ATTEMPTS, 1)
  assert.equal(parseFailoverMaxAttempts(undefined), 1)
  assert.equal(parseFailoverMaxAttempts(''), 1)
  assert.equal(parseFailoverMaxAttempts('nope'), 1)
  assert.equal(parseFailoverMaxAttempts('0'), 1)
  assert.equal(parseFailoverMaxAttempts('-3'), 1)
  assert.equal(parseFailoverMaxAttempts('2'), 2)
  assert.equal(parseFailoverMaxAttempts('3'), 3)
  assert.equal(parseFailoverMaxAttempts('99'), 3)
  assert.equal(parseFailoverMaxAttempts('99', AGENT_FAILOVER_MAX_ATTEMPTS), 1)
  assert.equal(normalizeMaxFailoverAttempts(99, 2), 2)
})

test('A: Primary success → no Failover', async () => {
  const h = await prepare({ maxAttempts: '3' })
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        return {
          provider: 'openai',
          model: 'm',
          content: 'ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'r1',
          metadata: {}
        }
      }
    })
  )
  h.registerProvider(mockAdapter('claude'))
  h.registerProvider(mockAdapter('gemini'))
  h.registerProvider(mockAdapter('workers'))
  const res = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(res.content, 'ok')
  assert.deepEqual(calls, ['openai'])
  assert.equal(h.listUsageEvents().length, 1)
  assert.equal(h.listUsageEvents()[0].failover, null)
})

test('B: Primary fail → Fallback1 success', async () => {
  const h = await prepare({ maxAttempts: '1' })
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        calls.push('claude')
        return {
          provider: 'claude',
          model: 'm',
          content: 'fb1',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'r2',
          metadata: {}
        }
      }
    })
  )
  h.registerProvider(mockAdapter('gemini'))
  h.registerProvider(mockAdapter('workers'))
  const res = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(res.content, 'fb1')
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('C: Primary + F1 fail → F2 success (max_attempts=2)', async () => {
  const h = await prepare({ maxAttempts: '2' })
  const calls = []
  const fail = (id, code) =>
    mockAdapter(id, {
      generate: async () => {
        calls.push(id)
        throw new h.AIError(code, code, { providerId: id, httpStatus: 429 })
      }
    })
  h.registerProvider(fail('openai', 'RATE_LIMIT'))
  h.registerProvider(fail('claude', 'NETWORK_ERROR'))
  h.registerProvider(
    mockAdapter('gemini', {
      generate: async () => {
        calls.push('gemini')
        return {
          provider: 'gemini',
          model: 'm',
          content: 'fb2',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'r3',
          metadata: {}
        }
      }
    })
  )
  h.registerProvider(mockAdapter('workers'))
  const res = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(res.content, 'fb2')
  assert.deepEqual(calls, ['openai', 'claude', 'gemini'])
  const events = h.listUsageEvents()
  assert.equal(events.length, 3)
  assert.equal(events[0].status, 'error')
  assert.equal(events[1].status, 'error')
  assert.equal(events[2].status, 'ok')
  assert.equal(events[2].provider, 'gemini')
  assert.equal(events[2].credentialId, 'byok_gemini_2c4')
  assert.equal(events[2].billingMode, 'BYOK')
})

test('D: all providers fail → final error', async () => {
  const h = await prepare({ maxAttempts: '3' })
  const calls = []
  for (const id of ['openai', 'claude', 'gemini', 'workers']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          calls.push(id)
          throw new h.AIError('PROVIDER_ERROR', 'down', { providerId: id, httpStatus: 503 })
        }
      })
    )
  }
  await assert.rejects(
    () =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (err) => err instanceof h.AIError && err.code === 'PROVIDER_ERROR'
  )
  assert.deepEqual(calls, ['openai', 'claude', 'gemini', 'workers'])
})

test('E/F/G: max_attempts 1/2/3 limit switches', async () => {
  for (const [max, expectedCalls] of [
    ['1', ['openai', 'claude']],
    ['2', ['openai', 'claude', 'gemini']],
    ['3', ['openai', 'claude', 'gemini', 'workers']]
  ]) {
    const h = await prepare({ maxAttempts: max })
    const calls = []
    for (const id of ['openai', 'claude', 'gemini', 'workers']) {
      h.registerProvider(
        mockAdapter(id, {
          generate: async () => {
            calls.push(id)
            throw new h.AIError('TIMEOUT', 't', { providerId: id })
          }
        })
      )
    }
    await assert.rejects(() =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      })
    )
    assert.deepEqual(calls, expectedCalls, `max_attempts=${max}`)
  }
})

test('H: max_attempts unset → 1', async () => {
  const h = await prepare({ maxAttempts: '' })
  const calls = []
  for (const id of ['openai', 'claude', 'gemini']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          calls.push(id)
          throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: id })
        }
      })
    )
  }
  await assert.rejects(() =>
    h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
  )
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('I: oversized max_attempts clamps to 3', async () => {
  const h = await prepare({ maxAttempts: '99' })
  const calls = []
  for (const id of ['openai', 'claude', 'gemini', 'workers']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          calls.push(id)
          throw new h.AIError('AUTH_ERROR', 'auth', { httpStatus: 401, providerId: id })
        }
      })
    )
  }
  await assert.rejects(() =>
    h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
  )
  assert.deepEqual(calls, ['openai', 'claude', 'gemini', 'workers'])
})

test('J: enabled=false → no Failover even if max_attempts=3', async () => {
  const h = await prepare({ enabled: 'false', maxAttempts: '3' })
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude'))
  await assert.rejects(() =>
    h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
  )
  assert.deepEqual(calls, ['openai'])
})

test('K/L/M: RATE_LIMIT / NETWORK_ERROR / TIMEOUT failover', async () => {
  for (const code of ['RATE_LIMIT', 'NETWORK_ERROR', 'TIMEOUT']) {
    const h = await prepare({ maxAttempts: '1' })
    const calls = []
    h.registerProvider(
      mockAdapter('openai', {
        generate: async () => {
          calls.push('openai')
          throw new h.AIError(code, code, {
            providerId: 'openai',
            httpStatus: code === 'RATE_LIMIT' ? 429 : undefined
          })
        }
      })
    )
    h.registerProvider(
      mockAdapter('claude', {
        generate: async () => {
          calls.push('claude')
          return {
            provider: 'claude',
            model: 'm',
            content: `ok-${code}`,
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            requestId: `r-${code}`,
            metadata: {}
          }
        }
      })
    )
    const res = await h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
    assert.equal(res.content, `ok-${code}`)
    assert.deepEqual(calls, ['openai', 'claude'])
  }
})

test('N: MODEL_NOT_FOUND → no Failover', async () => {
  const h = await prepare({ maxAttempts: '3' })
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('MODEL_NOT_FOUND', 'missing', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude'))
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

test('O: INSUFFICIENT_CREDIT → Router Failover none', async () => {
  const h = await prepare({ maxAttempts: '3' })
  assert.equal(h.isFailoverCandidate('INSUFFICIENT_CREDIT'), false)
  assert.equal(h.failoverReasonFromError(new h.AIError('INSUFFICIENT_CREDIT', 'x')), null)
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('INSUFFICIENT_CREDIT', 'credit', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude'))
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

test('P/Q/R: BYOK ↔ Development credentials not mixed', async () => {
  const h = await prepare({ maxAttempts: '2' })
  const seen = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async (_req, cred) => {
        seen.push({ provider: 'openai', id: cred.id, secret: cred.secret, mode: cred.billingMode })
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async (_req, cred) => {
        seen.push({ provider: 'claude', id: cred.id, secret: cred.secret, mode: cred.billingMode })
        throw new h.AIError('NETWORK_ERROR', 'net', { providerId: 'claude' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('gemini', {
      generate: async (_req, cred) => {
        seen.push({ provider: 'gemini', id: cred.id, secret: cred.secret, mode: cred.billingMode })
        return {
          provider: 'gemini',
          model: 'm',
          content: 'ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'rg',
          metadata: {}
        }
      }
    })
  )
  h.registerProvider(mockAdapter('workers'))
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(seen[0].id, 'byok_openai_2c4')
  assert.equal(seen[0].mode, 'BYOK')
  assert.equal(seen[1].id, 'dev:claude')
  assert.equal(seen[1].mode, 'DEVELOPMENT')
  assert.equal(seen[2].id, 'byok_gemini_2c4')
  assert.equal(seen[2].mode, 'BYOK')
  assert.notEqual(seen[0].secret, seen[1].secret)
  assert.notEqual(seen[1].secret, seen[2].secret)
  const events = h.listUsageEvents()
  assertNoSecretLeak(events, Object.values(FULL_RESOLVE).map((r) => r.secret))
  assert.equal(events[0].credentialId, 'byok_openai_2c4')
  assert.equal(events[1].credentialId, 'dev:claude')
  assert.equal(events[2].credentialId, 'byok_gemini_2c4')
})

test('S: same provider never revisited', async () => {
  const h = await harness()
  const { createFailoverContext, shouldFailover, AIError } = h
  const config = {
    enabled: true,
    primaryProvider: 'openai',
    fallbackProviders: ['claude', 'openai', 'gemini', 'workers'],
    maxFailoverAttempts: 3,
    resolve: makeResolve(FULL_RESOLVE)
  }
  const context = {
    ...createFailoverContext(config),
    visitedProviders: ['openai', 'claude'],
    currentProvider: 'claude',
    attempt: 2
  }
  const decision = shouldFailover(
    new AIError('RATE_LIMIT', 'rl', { httpStatus: 429 }),
    context,
    config
  )
  assert.equal(decision.shouldFailover, true)
  assert.equal(decision.nextProvider, 'gemini')
  assert.notEqual(decision.nextProvider, 'openai')
  assert.notEqual(decision.nextProvider, 'claude')
})

test('T: Secret / Authorization absent from context trail / settings / usage UI sources', async () => {
  const failover = await read('electron/main/ai/failover.ts')
  const usageUi = await read('electron/main/ai/usageBillingUi.ts')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(failover, /FailoverContext/)
  assert.doesNotMatch(failover, /FailoverContext[\s\S]{0,200}secret:/)
  assert.doesNotMatch(usageUi, /Authorization/i)
  assert.doesNotMatch(panel, /\.secret\b/)
  assert.doesNotMatch(panel, /api_key/)
})

test('U: Agent fallbacks openai/claude only; Agent max clamp 1', async () => {
  const h = await prepare({ maxAttempts: '3' })
  assert.deepEqual(h.fallbacksForAgent('openai'), ['claude'])
  assert.equal(h.fallbacksForAgent('openai').includes('gemini'), false)
  assert.equal(h.fallbacksForAgent('openai').includes('workers'), false)
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generateWithTools: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generateWithTools: async () => {
        calls.push('claude')
        return {
          model: 'm',
          requestId: 'tools',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          completion: {
            id: 'c',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'agent-ok' }
              }
            ]
          }
        }
      }
    })
  )
  h.registerProvider(
    mockAdapter('gemini', {
      generateWithTools: async () => {
        calls.push('gemini')
        throw new Error('should not run')
      }
    })
  )
  const completion = await h.executeAiWithTools({
    provider: 'openai',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(completion.choices[0].message.content, 'agent-ok')
  assert.deepEqual(calls, ['openai', 'claude'])
})

test('V: Cursor path unchanged', async () => {
  const cursor = await read('electron/main/cursorAgent.ts')
  assert.doesNotMatch(cursor, /executeWithFailover/)
  assert.doesNotMatch(cursor, /failover\.max_attempts/)
  assert.match(cursor, /@cursor\/sdk/)
})

test('W: Credit fallback regression (source + unit)', async () => {
  const api = await read('electron/main/api.ts')
  assert.match(api, /autoRuntimeFallbackEngines/)
  assert.doesNotMatch(api, /executeWithFailover/)
  const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import(
    '../electron/main/lib/providerErrors.ts'
  )
  assert.equal(isCreditOrQuotaError('insufficient_quota'), true)
  assert.deepEqual(autoRuntimeFallbackEngines('claude', 'ask'), ['openai', 'gemini'])
})

test('X: Settings stores failover.max_attempts; router reads it', async () => {
  const settings = await read('src/components/SettingsPanel.tsx')
  const router = await read('electron/main/ai/router.ts')
  assert.match(settings, /failover\.max_attempts/)
  assert.match(settings, /failoverMaxAttempts/)
  assert.match(router, /failover\.max_attempts/)
  assert.match(router, /routerMaxFailoverAttempts\('ask'\)/)
  assert.match(router, /routerMaxFailoverAttempts\('agent'\)/)
})

test('Credential missing provider is skipped', async () => {
  const h = await prepare({
    maxAttempts: '2',
    resolveMap: {
      openai: FULL_RESOLVE.openai,
      gemini: FULL_RESOLVE.gemini
      // claude missing
    }
  })
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        calls.push('claude')
        throw new Error('should skip — no credential')
      }
    })
  )
  h.registerProvider(
    mockAdapter('gemini', {
      generate: async () => {
        calls.push('gemini')
        return {
          provider: 'gemini',
          model: 'm',
          content: 'skip-ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'rs',
          metadata: {}
        }
      }
    })
  )
  const res = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(res.content, 'skip-ok')
  assert.deepEqual(calls, ['openai', 'gemini'])
})

test('teardown harness', async () => {
  if (shared?.dir) {
    await rm(shared.dir, { recursive: true, force: true })
    shared = null
  }
})
