import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function geminiCredential() {
  return {
    id: 'test:gemini',
    providerId: 'gemini',
    ownerType: 'development',
    billingMode: 'DEVELOPMENT',
    source: 'settings',
    secret: 'test-gemini-secret',
    baseUrl: 'gemini-native',
    extra: {}
  }
}

function openaiCredential() {
  return {
    id: 'test:openai',
    providerId: 'openai',
    ownerType: 'development',
    billingMode: 'DEVELOPMENT',
    source: 'settings',
    secret: 'test-openai-secret',
    baseUrl: 'https://api.openai.com/v1',
    extra: {}
  }
}

function workersCredential() {
  return {
    id: 'test:workers',
    providerId: 'workers',
    ownerType: 'development',
    billingMode: 'DEVELOPMENT',
    source: 'settings',
    secret: 'test-workers-secret',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/acct-1/ai/v1',
    extra: { accountId: 'acct-1', gatewayId: 'default' }
  }
}

test('mapGeminiListRow drops image/embed and keeps generateContent chat models', async () => {
  const { mapGeminiListRow, isNonChatGeminiModel } = await import(
    '../electron/main/ai/modelCatalogFetch.ts'
  )
  assert.equal(isNonChatGeminiModel('gemini-2.0-flash-preview-image-generation'), true)
  assert.equal(isNonChatGeminiModel('gemini-embedding-001'), true)
  assert.equal(isNonChatGeminiModel('gemini-2.5-flash'), false)
  assert.equal(
    mapGeminiListRow({
      name: 'models/gemini-2.0-flash-preview-image-generation',
      supportedGenerationMethods: ['generateContent']
    }),
    null
  )
  assert.equal(
    mapGeminiListRow({
      name: 'models/text-embedding-004',
      supportedGenerationMethods: ['embedContent']
    }),
    null
  )
  assert.equal(
    mapGeminiListRow({
      name: 'models/gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      supportedGenerationMethods: ['countTokens']
    }),
    null
  )
  assert.deepEqual(
    mapGeminiListRow({
      name: 'models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      supportedGenerationMethods: ['generateContent']
    }),
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'strong' }
  )
})

test('Gemini live list paginates, filters non-chat, never puts the key in the URL', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const urls = []
  const catalog = await listProviderModels('gemini', {
    credentialFor: () => geminiCredential(),
    fetchImpl: async (input, init) => {
      const url = String(input)
      urls.push(url)
      assert.equal(url.includes('test-gemini-secret'), false)
      assert.doesNotMatch(url, /[?&]key=/)
      assert.equal(init?.headers?.['x-goog-api-key'], 'test-gemini-secret')
      const parsed = new URL(url)
      assert.equal(parsed.searchParams.get('pageSize'), '100')
      if (!parsed.searchParams.get('pageToken')) {
        return jsonResponse(200, {
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/gemini-2.0-flash-preview-image-generation',
              supportedGenerationMethods: ['generateContent']
            }
          ],
          nextPageToken: 'page-2'
        })
      }
      assert.equal(parsed.searchParams.get('pageToken'), 'page-2')
      return jsonResponse(200, {
        models: [
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      })
    }
  })
  assert.equal(catalog.source, 'live')
  assert.equal(catalog.engine, 'gemini')
  assert.equal(urls.length, 2)
  assert.deepEqual(
    catalog.models.map((row) => row.id),
    ['gemini-2.5-flash', 'gemini-2.5-pro']
  )
})

test('Gemini pagination stops at 10 pages', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  let calls = 0
  await listProviderModels('gemini', {
    credentialFor: () => geminiCredential(),
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(200, {
        models: [
          {
            name: `models/gemini-page-${calls}`,
            supportedGenerationMethods: ['generateContent']
          }
        ],
        nextPageToken: `next-${calls}`
      })
    }
  })
  assert.equal(calls, 10)
})

test('no key / API fail / empty live list fall back to builtin Gemini catalog', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const noKey = await listProviderModels('gemini', { credentialFor: () => null })
  assert.equal(noKey.source, 'builtin')
  assert.ok(noKey.models.length >= 4)
  assert.ok(noKey.models.some((row) => row.id === 'gemini-flash-latest'))
  assert.ok(noKey.models.some((row) => row.id === 'gemini-2.5-pro'))

  const failed = await listProviderModels('gemini', {
    credentialFor: () => geminiCredential(),
    fetchImpl: async () => jsonResponse(503, { error: { message: 'unavailable' } })
  })
  assert.equal(failed.source, 'builtin')
  assert.ok(failed.models.some((row) => row.id === 'gemini-flash-latest'))

  const empty = await listProviderModels('gemini', {
    credentialFor: () => geminiCredential(),
    fetchImpl: async () => jsonResponse(200, { models: [] })
  })
  assert.equal(empty.source, 'builtin')
})

test('OpenAI live list keeps chat ids and drops image/audio', async () => {
  const { listProviderModels, isChatOpenAiModel } = await import(
    '../electron/main/ai/modelCatalogFetch.ts'
  )
  assert.equal(isChatOpenAiModel('gpt-4.1'), true)
  assert.equal(isChatOpenAiModel('o3-mini'), true)
  assert.equal(isChatOpenAiModel('dall-e-3'), false)
  const catalog = await listProviderModels('openai', {
    credentialFor: () => openaiCredential(),
    fetchImpl: async (input) => {
      assert.match(String(input), /\/models$/)
      return jsonResponse(200, {
        data: [{ id: 'gpt-4.1' }, { id: 'dall-e-3' }, { id: 'whisper-1' }, { id: 'o3-mini' }]
      })
    }
  })
  assert.equal(catalog.source, 'live')
  assert.deepEqual(
    catalog.models.map((row) => row.id),
    ['gpt-4.1', 'o3-mini']
  )
})

test('Workers live list filters tasks and caps at 80', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const catalog = await listProviderModels('workers', {
    credentialFor: () => workersCredential(),
    fetchImpl: async (input) => {
      assert.match(String(input), /accounts\/acct-1\/ai\/models\/search/)
      return jsonResponse(200, {
        result: [
          { name: '@cf/meta/llama-3.1-8b-instruct', task: { name: 'Text Generation' } },
          { name: 'no-slash', task: { name: 'text' } },
          { name: '@cf/cf/resnet', task: { name: 'Image Classification' } }
        ]
      })
    }
  })
  assert.equal(catalog.source, 'live')
  assert.deepEqual(
    catalog.models.map((row) => row.id),
    ['@cf/meta/llama-3.1-8b-instruct']
  )
})

test('Claude live list paginates Anthropic /v1/models', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const urls = []
  const catalog = await listProviderModels('claude', {
    credentialFor: () => ({
      id: 'test:claude',
      providerId: 'claude',
      ownerType: 'development',
      billingMode: 'DEVELOPMENT',
      source: 'settings',
      secret: 'test-claude-secret',
      baseUrl: 'https://api.anthropic.com',
      extra: {}
    }),
    fetchImpl: async (input, init) => {
      const url = String(input)
      urls.push(url)
      assert.match(url, /\/v1\/models/)
      assert.equal(init?.headers?.['x-api-key'], 'test-claude-secret')
      assert.equal(init?.headers?.['anthropic-version'], '2023-06-01')
      const parsed = new URL(url)
      if (!parsed.searchParams.get('after_id')) {
        return jsonResponse(200, {
          data: [
            { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' }
          ],
          has_more: true,
          last_id: 'claude-opus-4-20250514'
        })
      }
      assert.equal(parsed.searchParams.get('after_id'), 'claude-opus-4-20250514')
      return jsonResponse(200, {
        data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }],
        has_more: false,
        last_id: 'claude-haiku-4-5-20251001'
      })
    }
  })
  assert.equal(catalog.source, 'live')
  assert.equal(urls.length, 2)
  assert.deepEqual(
    catalog.models.map((row) => row.id),
    ['claude-haiku-4-5-20251001', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514']
  )
})

test('Cursor live list reads api.cursor.com /v1/models', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const catalog = await listProviderModels('cursor', {
    credentialFor: () => ({
      id: 'test:cursor',
      providerId: 'cursor',
      ownerType: 'development',
      billingMode: 'DEVELOPMENT',
      source: 'settings',
      secret: 'test-cursor-secret',
      baseUrl: 'cursor-sdk',
      extra: {}
    }),
    fetchImpl: async (input, init) => {
      assert.equal(String(input), 'https://api.cursor.com/v1/models')
      const auth = init?.headers?.Authorization || ''
      assert.match(auth, /^Basic /)
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
      assert.equal(decoded, 'test-cursor-secret:')
      return jsonResponse(200, {
        items: [
          { id: 'composer-2', display_name: 'Composer 2' },
          { id: 'claude-4.6-sonnet', display_name: 'Claude Sonnet 4.6' },
          { id: 'grok-4.6', name: 'Grok 4.6' }
        ]
      })
    }
  })
  assert.equal(catalog.source, 'live')
  assert.ok(catalog.models.length >= 3)
  assert.ok(catalog.models.some((row) => row.id === 'composer-2'))
  assert.ok(catalog.models.some((row) => row.id === 'grok-4.6'))
})

test('Claude / Cursor without key or on API failure fall back to builtin', async () => {
  const { listProviderModels } = await import('../electron/main/ai/modelCatalogFetch.ts')
  const noKeyClaude = await listProviderModels('claude', { credentialFor: () => null })
  const noKeyCursor = await listProviderModels('cursor', { credentialFor: () => null })
  assert.equal(noKeyClaude.source, 'builtin')
  assert.equal(noKeyCursor.source, 'builtin')
  assert.ok(noKeyClaude.models.some((row) => row.id.includes('claude')))
  assert.ok(noKeyCursor.models.some((row) => row.id === 'grok-4.6' || row.id === 'auto'))

  const failed = await listProviderModels('claude', {
    credentialFor: () => ({
      id: 'test:claude',
      providerId: 'claude',
      ownerType: 'development',
      billingMode: 'DEVELOPMENT',
      source: 'settings',
      secret: 'bad',
      baseUrl: 'https://api.anthropic.com',
      extra: {}
    }),
    fetchImpl: async () => jsonResponse(401, { error: { message: 'nope' } })
  })
  assert.equal(failed.source, 'builtin')
})

test('localApi GET /ai/models uses listProviderModels; stub DEFAULT_MODELS is gone', async () => {
  const local = await read('electron/main/localApi.ts')
  assert.match(local, /from '\.\/ai\/modelCatalogFetch'/)
  assert.match(local, /listProviderModels\(query\.get\('engine'\)\)/)
  assert.doesNotMatch(local, /DEFAULT_MODELS/)
  assert.doesNotMatch(local, /gemini-2\.0-flash/)
  assert.match(local, /source: catalog\.source/)
  const fetchSrc = await read('electron/main/ai/modelCatalogFetch.ts')
  assert.match(fetchSrc, /pageSize/)
  assert.match(fetchSrc, /nextPageToken/)
  assert.match(fetchSrc, /page < 10/)
  assert.match(fetchSrc, /x-goog-api-key/)
  assert.doesNotMatch(fetchSrc, /searchParams\.set\('key'/)
})

test('slice does not retouch Gemini generate / tools / PIPELINE', async () => {
  const gemini = await read('electron/main/ai/adapters/gemini.ts')
  assert.match(gemini, /const DEFAULT_MODEL = 'gemini-2\.0-flash'/)
  const tools = await read('electron/main/ai/adapters/geminiTools.ts')
  assert.match(tools, /thought/)
  const pipeline = await read('docs/PIPELINE.md')
  assert.doesNotMatch(pipeline, /listProviderModels/)
})

test('model-catalog-fetch is registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /scripts\/model-catalog-fetch\.test\.mjs/)
})
