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
        completion: {
          id: 'chatcmpl_test',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: `tools-ok:${providerId}` }
            }
          ]
        }
      }
    },
    healthCheck: async () => ({ ok: true, message: 'ok' })
  }
}

async function loadHarness() {
  const esbuild = require('esbuild')
  const dir = await mkdtemp(join(tmpdir(), 'saforall-failover-2c2-'))
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
  fallbacksForAgent
} from ${spec('electron/main/ai/failover.ts')}
export { resetUsageForTests, listUsageEvents } from ${spec('electron/main/ai/usage.ts')}
export {
  resetProviderRegistryForTests,
  registerProvider
} from ${spec('electron/main/ai/registry.ts')}
export { AIError } from ${spec('electron/main/ai/errors.ts')}
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
                contents:
                  'export function getLocalSetting(){return ""}\nexport async function ensureSettingsLoaded(){}',
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
  if (!shared) shared = await loadHarness()
  return shared.mod
}

test('Q helpers: Agent fallbacks exclude gemini/workers', async () => {
  const { fallbacksForAsk, fallbacksForAgent } = await import(
    '../electron/main/ai/failover.ts'
  )
  assert.deepEqual(fallbacksForAsk('openai'), ['claude', 'gemini', 'workers'])
  assert.deepEqual(fallbacksForAgent('openai'), ['claude'])
  assert.equal(fallbacksForAgent('openai').includes('gemini'), false)
  assert.equal(fallbacksForAgent('openai').includes('workers'), false)
})

test('A: Primary success → no Failover', async () => {
  const h = await harness()
  const openaiSecret = 'sk-test-openai-primary-success-xx'
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'dev:openai',
        secret: openaiSecret,
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-test-claude-unused-xxxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  let claudeCalls = 0
  h.registerProvider(
    mockAdapter('openai', {
      generate: async (_req, cred) => {
        assert.equal(cred.secret, openaiSecret)
        return {
          provider: 'openai',
          model: 'openai-test-model',
          content: 'primary-ok',
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          requestId: 'req_primary_ok',
          metadata: {}
        }
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        claudeCalls += 1
        throw new Error('should not run')
      }
    })
  )
  const response = await h.executeAi({
    provider: 'openai',
    routingMode: 'manual',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(response.content, 'primary-ok')
  assert.equal(claudeCalls, 0)
  const events = h.listUsageEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].status, 'ok')
  assert.equal(events[0].provider, 'openai')
  assert.equal(events[0].failover, null)
  assertNoSecretLeak(events, [openaiSecret])
})

test('B/C/D: eligible errors failover to Claude', async () => {
  const h = await harness()
  for (const code of ['RATE_LIMIT', 'AUTH_ERROR', 'NETWORK_ERROR']) {
    h.resetUsageForTests()
    h.resetProviderRegistryForTests()
    h.resetFailoverResolveForTests()
    h.configureFailoverResolve(
      makeResolve({
        openai: {
          id: 'dev:openai',
          secret: 'sk-test-openai-fail-xxxxxx',
          billingMode: 'DEVELOPMENT'
        },
        claude: {
          id: 'dev:claude',
          secret: 'sk-test-claude-ok-xxxxxxx',
          billingMode: 'DEVELOPMENT'
        }
      })
    )
    h.registerProvider(
      mockAdapter('openai', {
        generate: async () => {
          throw new h.AIError(code, `${code} boom`, { providerId: 'openai' })
        }
      })
    )
    h.registerProvider(
      mockAdapter('claude', {
        generate: async () => ({
          provider: 'claude',
          model: 'claude-test-model',
          content: `recovered:${code}`,
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: `req_claude_${code}`,
          metadata: {}
        })
      })
    )
    const response = await h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
    assert.equal(response.content, `recovered:${code}`)
    const events = h.listUsageEvents()
    assert.equal(events.length, 2)
    assert.equal(events[0].status, 'error')
    assert.equal(events[0].provider, 'openai')
    assert.equal(events[1].status, 'ok')
    assert.equal(events[1].provider, 'claude')
  }
})

test('E: MODEL_NOT_FOUND does not failover', async () => {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-test-openai-model-nf-xx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-test-claude-model-nf-xx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  let claudeCalls = 0
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('MODEL_NOT_FOUND', 'missing model', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        claudeCalls += 1
        return {
          provider: 'claude',
          model: 'x',
          content: 'nope',
          finishReason: 'stop',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          requestId: 'x',
          metadata: {}
        }
      }
    })
  )
  await assert.rejects(
    () =>
      h.executeAi({
        provider: 'openai',
        routingMode: 'manual',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (err) => err instanceof h.AIError && err.code === 'MODEL_NOT_FOUND'
  )
  assert.equal(claudeCalls, 0)
  assert.equal(h.listUsageEvents().length, 1)
  assert.equal(h.listUsageEvents()[0].status, 'error')
})

test('F: Fallback Credential missing → do not run fallback provider', async () => {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-test-openai-only-xxxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  let claudeCalls = 0
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('RATE_LIMIT', 'rate', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generate: async () => {
        claudeCalls += 1
        throw new Error('should not run')
      }
    })
  )
  await assert.rejects(() =>
    h.executeAi({
      provider: 'openai',
      routingMode: 'manual',
      messages: [{ role: 'user', content: 'hi' }]
    })
  )
  assert.equal(claudeCalls, 0)
})

test('G/H/I: BYOK↔Development credential isolation', async () => {
  const h = await harness()
  const cases = [
    {
      name: 'BYOK→BYOK',
      openai: {
        id: 'byok_openai_g',
        secret: 'sk-byok-openai-G-secretxxxx',
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      },
      claude: {
        id: 'byok_claude_g',
        secret: 'sk-byok-claude-G-secretxxxx',
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      }
    },
    {
      name: 'BYOK→Development',
      openai: {
        id: 'byok_openai_h',
        secret: 'sk-byok-openai-H-secretxxxx',
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-dev-claude-H-secretxxxxx',
        billingMode: 'DEVELOPMENT'
      }
    },
    {
      name: 'Development→BYOK',
      openai: {
        id: 'dev:openai',
        secret: 'sk-dev-openai-I-secretxxxxx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'byok_claude_i',
        secret: 'sk-byok-claude-I-secretxxxx',
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      }
    }
  ]
  for (const row of cases) {
    h.resetUsageForTests()
    h.resetProviderRegistryForTests()
    h.resetFailoverResolveForTests()
    h.configureFailoverResolve(makeResolve({ openai: row.openai, claude: row.claude }))
    const seen = []
    h.registerProvider(
      mockAdapter('openai', {
        generate: async (_req, cred) => {
          seen.push({ providerId: 'openai', id: cred.id, secret: cred.secret })
          throw new h.AIError('RATE_LIMIT', 'rate', { providerId: 'openai' })
        }
      })
    )
    h.registerProvider(
      mockAdapter('claude', {
        generate: async (_req, cred) => {
          seen.push({ providerId: 'claude', id: cred.id, secret: cred.secret })
          return {
            provider: 'claude',
            model: 'claude-test-model',
            content: `ok:${row.name}`,
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            requestId: `req_${row.name}`,
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
    assert.equal(response.content, `ok:${row.name}`)
    assert.equal(seen[0].secret, row.openai.secret)
    assert.equal(seen[1].secret, row.claude.secret)
    assert.notEqual(seen[0].secret, seen[1].secret)
    const events = h.listUsageEvents()
    assert.equal(events[0].billingMode, row.openai.billingMode)
    assert.equal(events[0].credentialId, row.openai.id)
    assert.equal(events[1].billingMode, row.claude.billingMode)
    assert.equal(events[1].credentialId, row.claude.id)
    assertNoSecretLeak(events, [row.openai.secret, row.claude.secret])
  }
})

test('J/K/L: both fail, max one switch, no same-provider reuse', async () => {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-test-openai-bothfail-xx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-test-claude-bothfail-xx',
        billingMode: 'DEVELOPMENT'
      },
      gemini: {
        id: 'dev:gemini',
        secret: 'sk-test-gemini-bothfail-xx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  const calls = []
  for (const id of ['openai', 'claude', 'gemini']) {
    h.registerProvider(
      mockAdapter(id, {
        generate: async () => {
          calls.push(id)
          throw new h.AIError('PROVIDER_ERROR', `down-${id}`, { providerId: id })
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
  assert.equal(calls.filter((x) => x === 'openai').length, 1)
  assert.equal(h.listUsageEvents().length, 2)
  assert.ok(h.listUsageEvents().every((e) => e.status === 'error'))
})

test('M/N/O: Usage + secret safety', async () => {
  const h = await harness()
  const secret = 'sk-byok-MUST-NOT-APPEAR-123456'
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'byok_openai_m',
        secret,
        billingMode: 'BYOK',
        ownerType: 'user',
        source: 'byok',
        reason: 'byok'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-dev-claude-M-secretxxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  h.registerProvider(
    mockAdapter('openai', {
      generate: async () => {
        throw new h.AIError('RATE_LIMIT', 'rate', { providerId: 'openai' })
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
  assert.equal(events[0].status, 'error')
  assert.equal(events[0].credentialId, 'byok_openai_m')
  assert.equal(events[0].billingMode, 'BYOK')
  assert.equal(events[1].status, 'ok')
  assert.equal(events[1].credentialId, 'dev:claude')
  assert.equal(events[1].billingMode, 'DEVELOPMENT')
  assert.ok(events[1].failover)
  assert.equal(events[1].failover.primaryProvider, 'openai')
  assertNoSecretLeak(events, [secret, 'sk-dev-claude-M-secretxxxxx'])
})

test('P/Q: executeAiWithTools failover; gemini/workers not agent fallbacks', async () => {
  const h = await harness()
  h.resetUsageForTests()
  h.resetProviderRegistryForTests()
  h.resetFailoverResolveForTests()
  h.configureFailoverResolve(
    makeResolve({
      openai: {
        id: 'dev:openai',
        secret: 'sk-test-openai-tools-xxxxx',
        billingMode: 'DEVELOPMENT'
      },
      claude: {
        id: 'dev:claude',
        secret: 'sk-test-claude-tools-xxxxx',
        billingMode: 'DEVELOPMENT'
      },
      gemini: {
        id: 'dev:gemini',
        secret: 'sk-test-gemini-tools-xxxxx',
        billingMode: 'DEVELOPMENT'
      }
    })
  )
  const calls = []
  h.registerProvider(
    mockAdapter('openai', {
      generateWithTools: async () => {
        calls.push('openai')
        throw new h.AIError('RATE_LIMIT', 'rate', { providerId: 'openai' })
      }
    })
  )
  h.registerProvider(
    mockAdapter('claude', {
      generateWithTools: async () => {
        calls.push('claude')
        return {
          model: 'claude-test-model',
          requestId: 'req_tools_ok',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          completion: {
            id: 'c',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'tools-recovered' }
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
        throw new Error('gemini should not be agent fallback')
      }
    })
  )
  const completion = await h.executeAiWithTools({
    provider: 'openai',
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(completion.choices[0].message.content, 'tools-recovered')
  assert.deepEqual(calls, ['openai', 'claude'])
  assert.equal(h.fallbacksForAgent('openai').includes('gemini'), false)
})

test('R/S source: Cursor untouched; credit auto-fallback stays outside router Failover', async () => {
  const router = await read('electron/main/ai/router.ts')
  const cursor = await read('electron/main/cursorAgent.ts')
  const api = await read('electron/main/api.ts')
  const toolAgent = await read('electron/main/toolAgent.ts')
  assert.match(router, /executeWithFailover/)
  assert.match(router, /fallbacksForAsk/)
  assert.match(router, /fallbacksForAgent/)
  assert.match(router, /enabled:\s*true/)
  assert.match(router, /maxFailoverAttempts:\s*1/)
  assert.doesNotMatch(router, /credentialOverride/)
  assert.doesNotMatch(router, /provider\.api_key/)
  assert.doesNotMatch(router, /\bapiKey\s*:/)
  assert.doesNotMatch(router, /requireCredential/)
  assert.doesNotMatch(cursor, /executeWithFailover/)
  assert.doesNotMatch(cursor, /fallbacksForAsk/)
  assert.match(cursor, /@cursor\/sdk/)
  assert.match(api, /autoRuntimeFallbackEngines/)
  assert.doesNotMatch(api, /executeWithFailover/)
  assert.match(toolAgent, /executeAiWithTools/)
  assert.doesNotMatch(toolAgent, /executeWithFailover/)
})

test('teardown harness', async () => {
  if (shared?.dir) {
    await rm(shared.dir, { recursive: true, force: true })
    shared = null
  }
})
