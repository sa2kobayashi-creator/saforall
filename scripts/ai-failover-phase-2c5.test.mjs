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
  assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9_\-\.]+/)
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
        completion: {
          id: 'c',
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
}

const FULL_RESOLVE = {
  openai: {
    id: 'byok_openai_2c5',
    secret: 'sk-settings-openai-2c5-SECRET',
    billingMode: 'BYOK',
    ownerType: 'user',
    source: 'byok',
    reason: 'byok'
  },
  claude: {
    id: 'dev:claude',
    secret: 'sk-settings-claude-2c5-SECRET',
    billingMode: 'DEVELOPMENT'
  },
  gemini: {
    id: 'byok_gemini_2c5',
    secret: 'sk-settings-gemini-2c5-SECRET',
    billingMode: 'BYOK',
    ownerType: 'user',
    source: 'byok',
    reason: 'byok'
  },
  workers: {
    id: 'dev:workers',
    secret: 'sk-settings-workers-2c5-SECRET',
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
  const dir = await mkdtemp(join(tmpdir(), 'saforall-failover-2c5-'))
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
  fallbacksForAgent,
  parseFailoverMaxAttempts,
  failoverReasonFromError,
  isFailoverEligibleError,
  newFailoverId
} from ${spec('electron/main/ai/failover.ts')}
export { isFailoverCandidate } from ${spec('electron/main/ai/errors.ts')}
export { resetUsageForTests, listUsageEvents } from ${spec('electron/main/ai/usage.ts')}
export {
  usageEventsToRecentRows,
  formatRouterFailoverLabel,
  countFailoverChains,
  failoverForUi
} from ${spec('electron/main/ai/usageBillingUi.ts')}
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
let failoverMaxAttempts = '3'
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
  failoverMaxAttempts = '3'
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
    if (!shared) throw new Error('esbuild required for Phase 2-C-5 harness')
  }
  return shared.mod
}

async function prepare({ enabled = 'true', maxAttempts = '3', resolveMap = FULL_RESOLVE } = {}) {
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

function registerAllFailing(h, code = 'RATE_LIMIT') {
  for (const id of ['openai', 'claude', 'gemini', 'workers']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          throw new h.AIError(code, code, {
            providerId: id,
            httpStatus: code === 'RATE_LIMIT' ? 429 : undefined
          })
        }
      })
    )
  }
}

test('A: primary success → no failoverId / no chain meta', async () => {
  const h = await prepare()
  h.registerProvider(mockAdapter('openai'))
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const events = h.listUsageEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].failover, null)
  assert.equal(h.countFailoverChains(events), 0)
})

test('B: one-step failover shares failoverId and path', async () => {
  const h = await prepare({ maxAttempts: '1' })
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => ({
        provider: 'claude',
        model: 'm',
        content: 'ok',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: 'r2',
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
  assert.ok(events[0].failover?.failoverId)
  assert.equal(events[0].failover.failoverId, events[1].failover.failoverId)
  assert.deepEqual(events[0].failover.path, ['openai'])
  assert.deepEqual(events[1].failover.path, ['openai', 'claude'])
  assert.equal(events[0].failover.reason, 'rate_limit')
  assert.equal(events[1].failover.reason, 'success')
  assert.equal(events[0].failover.mode, 'ask')
  assert.equal(h.countFailoverChains(events), 1)
})

test('C: two-step failover path openai→claude→gemini', async () => {
  const h = await prepare({ maxAttempts: '2' })
  const calls = []
  for (const id of ['openai', 'claude']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          calls.push(id)
          throw new h.AIError('NETWORK_ERROR', 'net', { providerId: id })
        }
      })
    )
  }
  h.registerProvider(
    mockAdapter('gemini', {
      generate: async () => {
        calls.push('gemini')
        return {
          provider: 'gemini',
          model: 'm',
          content: 'ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'r3',
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
  const events = h.listUsageEvents()
  assert.equal(events.length, 3)
  assert.deepEqual(calls, ['openai', 'claude', 'gemini'])
  const id = events[0].failover.failoverId
  assert.ok(id)
  assert.ok(events.every((e) => e.failover?.failoverId === id))
  assert.deepEqual(events[2].failover.path, ['openai', 'claude', 'gemini'])
  assert.equal(h.countFailoverChains(events), 1)
  const label = h.formatRouterFailoverLabel(events[2].failover, 'gemini')
  assert.match(label, /openai→claude→gemini/)
})

test('D: all providers fail — one chain, shared id, no secrets', async () => {
  const h = await prepare({ maxAttempts: '3' })
  registerAllFailing(h, 'PROVIDER_ERROR')
  await assert.rejects(() =>
    h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
  )
  const events = h.listUsageEvents()
  assert.equal(events.length, 4)
  const id = events[0].failover.failoverId
  assert.ok(events.every((e) => e.failover?.failoverId === id))
  assert.deepEqual(events[3].failover.path, ['openai', 'claude', 'gemini', 'workers'])
  assert.equal(h.countFailoverChains(events), 1)
  assertNoSecretLeak(events, Object.values(FULL_RESOLVE).map((r) => r.secret))
})

test('E: missing credential skipped — not in path', async () => {
  const h = await prepare({
    maxAttempts: '2',
    resolveMap: {
      openai: FULL_RESOLVE.openai,
      gemini: FULL_RESOLVE.gemini
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
        throw new Error('should not run')
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
          content: 'ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: 'rg',
          metadata: {}
        }
      }
    })
  )
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.deepEqual(calls, ['openai', 'gemini'])
  const events = h.listUsageEvents()
  assert.deepEqual(events[events.length - 1].failover.path, ['openai', 'gemini'])
  assert.equal(events[events.length - 1].failover.path.includes('claude'), false)
})

test('F: same provider not revisited (source + helper)', async () => {
  const failover = await read('electron/main/ai/failover.ts')
  assert.match(failover, /visitedProviders/)
  assert.match(failover, /already_visited|visited\.has/)
})

test('G: eligible reasons recorded on failure events', async () => {
  for (const [code, reason] of [
    ['RATE_LIMIT', 'rate_limit'],
    ['NETWORK_ERROR', 'network_error'],
    ['TIMEOUT', 'timeout'],
    ['AUTH_ERROR', 'auth_error'],
    ['PROVIDER_ERROR', 'provider_unavailable']
  ]) {
    const h = await prepare({ maxAttempts: '1' })
    h.registerProvider(
      mockAdapter('openai', {
        generate: async () => {
          throw new h.AIError(code, code, {
            providerId: 'openai',
            httpStatus: code === 'RATE_LIMIT' ? 429 : undefined
          })
        }
      })
    )
    h.registerProvider(
      mockAdapter('claude', {
        generate: async () => ({
          provider: 'claude',
          model: 'm',
          content: 'ok',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: `r-${code}`,
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
    assert.equal(events[0].failover.reason, reason, code)
  }
})

test('H: INSUFFICIENT_CREDIT → no Router Failover', async () => {
  const h = await prepare()
  assert.equal(h.isFailoverCandidate('INSUFFICIENT_CREDIT'), false)
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('INSUFFICIENT_CREDIT', 'credit', { providerId: 'openai' })
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
  const events = h.listUsageEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].provider, 'openai')
  assert.equal(events[0].failover, null)
  assert.equal(h.countFailoverChains(events), 0)
})

test('review-1: success metadata keeps credentialSource', async () => {
  const h = await prepare()
  h.registerProvider(mockAdapter('openai'))
  const res = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(res.metadata?.credentialSource, 'byok')
  assert.equal(h.listUsageEvents()[0].failover, null)
})

test('review-2: onAttempt hook type has no Credential/secret surface', async () => {
  const failover = await read('electron/main/ai/failover.ts')
  const hookBlock = failover.slice(
    failover.indexOf('export type FailoverAttemptHook'),
    failover.indexOf('export type FailoverRunHooks')
  )
  assert.doesNotMatch(hookBlock, /\bcredential\s*:/)
  assert.doesNotMatch(hookBlock, /\bsecret\b/)
  assert.doesNotMatch(hookBlock, /\berror\?\s*:/)
  assert.match(hookBlock, /credentialId/)
  assert.match(hookBlock, /billingMode/)
  assert.match(hookBlock, /errorCode/)
})

test('review-3: single-shot failure has no failoverId; chain has shared id', async () => {
  const h = await prepare({ maxAttempts: '1' })
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('MODEL_NOT_FOUND', 'missing', { providerId: 'openai' })
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
  const single = h.listUsageEvents()
  assert.equal(single.length, 1)
  assert.equal(single[0].failover, null)
  assert.equal(h.countFailoverChains(single), 0)

  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('RATE_LIMIT', 'rl', { httpStatus: 429, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => ({
        provider: 'claude',
        model: 'm',
        content: 'ok',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: 'r-chain',
        metadata: {}
      })
    })
  )
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const chain = h.listUsageEvents()
  assert.equal(chain.length, 2)
  assert.ok(chain[0].failover?.failoverId)
  assert.equal(chain[0].failover.failoverId, chain[1].failover.failoverId)
  assert.equal(h.countFailoverChains(chain), 1)
})

test('I: Agent openai→claude only; mode=agent', async () => {
  const h = await prepare({ maxAttempts: '3' })
  assert.deepEqual(h.fallbacksForAgent('openai'), ['claude'])
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
        throw new Error('no')
      }
    })
  )
  await h.executeAiWithTools({
    provider: 'openai',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.deepEqual(calls, ['openai', 'claude'])
  const events = h.listUsageEvents()
  assert.ok(events.every((e) => e.failover?.mode === 'agent'))
})

test('J: Cursor path unchanged', async () => {
  const cursor = await read('electron/main/cursorAgent.ts')
  assert.doesNotMatch(cursor, /executeWithFailover/)
  assert.doesNotMatch(cursor, /failoverId/)
  assert.match(cursor, /@cursor\/sdk/)
})

test('K: Secret leakage checks on meta / UI helpers', async () => {
  const h = await prepare({ maxAttempts: '1' })
  const secret = FULL_RESOLVE.openai.secret
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('AUTH_ERROR', 'bad', { httpStatus: 401, providerId: 'openai' })
      }
    })
  )
  h.registerProvider(mockAdapter('claude'))
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const events = h.listUsageEvents()
  const rows = h.usageEventsToRecentRows(events, 10)
  assertNoSecretLeak(events, [secret, FULL_RESOLVE.claude.secret])
  assertNoSecretLeak(rows, [secret, FULL_RESOLVE.claude.secret])
  for (const key of ['apiKey', 'Authorization', 'Bearer', 'password', 'credential.secret']) {
    assert.equal(JSON.stringify(events).includes(key), false)
  }
})

test('L: event count 3 / chain count 1', async () => {
  const h = await prepare({ maxAttempts: '2' })
  for (const id of ['openai', 'claude']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          throw new h.AIError('TIMEOUT', 't', { providerId: id })
        }
      })
    )
  }
  h.registerProvider(mockAdapter('gemini'))
  await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  const events = h.listUsageEvents()
  assert.equal(events.length, 3)
  assert.equal(h.countFailoverChains(events), 1)
})

test('M: legacy events without failoverId/path still render', async () => {
  const h = await harness()
  const legacy = {
    provider: 'openai',
    model: 'm',
    estimatedCost: 0.01,
    timestamp: '2026-01-01T00:00:00.000Z',
    status: 'ok',
    billingMode: 'DEVELOPMENT',
    credentialId: 'dev:openai',
    failover: {
      primaryProvider: 'openai',
      fallbackProvider: 'claude',
      reason: 'success',
      attempt: 2
    }
  }
  const rows = h.usageEventsToRecentRows([legacy], 5)
  assert.equal(rows[0].routerFailover?.failoverId ?? null, null)
  assert.equal(rows[0].routerFailover?.path ?? null, null)
  assert.match(h.formatRouterFailoverLabel(rows[0].routerFailover, 'claude'), /openai→claude/)
  assert.equal(h.countFailoverChains([legacy]), 0)
  assert.equal(h.failoverForUi(null), null)
  assert.equal(h.failoverForUi(undefined), null)
})

test('localApi exposes router_failover_chains; PHP fallback column stays separate', async () => {
  const local = await read('electron/main/localApi.ts')
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(local, /countFailoverChains/)
  assert.match(local, /router_failover_chains/)
  assert.match(panel, /router_failover_chains/)
  assert.match(panel, /フォールバック/)
  assert.match(panel, /Router Failover/)
})

test('Credit fallback + Settings unchanged (source)', async () => {
  const api = await read('electron/main/api.ts')
  const settings = await read('src/components/SettingsPanel.tsx')
  assert.match(api, /autoRuntimeFallbackEngines/)
  assert.doesNotMatch(api, /executeWithFailover/)
  assert.match(settings, /failover\.enabled/)
  assert.match(settings, /failover\.max_attempts/)
})

test('teardown harness', async () => {
  if (shared?.dir) {
    await rm(shared.dir, { recursive: true, force: true })
    shared = null
  }
})
