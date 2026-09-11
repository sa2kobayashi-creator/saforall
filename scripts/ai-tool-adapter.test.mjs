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

function createRegistry(adapters) {
  const map = new Map(Object.entries(adapters))
  return {
    getProvider(id) {
      const adapter = map.get(id)
      if (!adapter) throw new Error(`missing adapter ${id}`)
      return adapter
    }
  }
}

async function executeWithTools(registry, input) {
  const adapter = registry.getProvider(input.provider)
  if (typeof adapter.generateWithTools !== 'function') {
    throw new Error('AGENT_UNSUPPORTED')
  }
  return adapter.generateWithTools(
    { provider: input.provider, model: input.model, messages: [] },
    { secret: 'resolver-owned-secret' },
    {
      messages: input.messages,
      tools: input.tools,
      toolChoice: input.toolChoice
    }
  )
}

async function runOpenAiAgentLoop(adapter) {
  const registry = createRegistry({ openai: adapter })
  const tools = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } }
      }
    }
  ]
  const messages = [{ role: 'user', content: 'read a.ts' }]
  const first = await executeWithTools(registry, {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    messages,
    tools,
    toolChoice: 'required'
  })
  const call = first.completion.choices?.[0]?.message?.tool_calls?.[0]
  assert.equal(call?.function?.name, 'read_file')
  const toolResult = '{"ok":true,"text":"export {}"}'
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [call]
  })
  messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult })
  const second = await executeWithTools(registry, {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    messages
  })
  assert.equal(second.completion.choices?.[0]?.message?.content, 'done reading')
  return adapter.calls
}

async function runClaudeAgentLoop(adapter) {
  const registry = createRegistry({ claude: adapter })
  const tools = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } }
      }
    }
  ]
  const messages = [{ role: 'user', content: 'read a.ts' }]
  const first = await executeWithTools(registry, {
    provider: 'claude',
    model: 'claude-sonnet-5',
    messages,
    tools,
    toolChoice: 'required'
  })
  const call = first.completion.choices?.[0]?.message?.tool_calls?.[0]
  assert.equal(call?.id, 'toolu_1')
  assert.equal(call?.function?.name, 'read_file')
  messages.push({
    role: 'assistant',
    content: 'reading',
    tool_calls: [call]
  })
  messages.push({ role: 'tool', tool_call_id: 'toolu_1', content: '{"ok":true}' })
  const second = await executeWithTools(registry, {
    provider: 'claude',
    model: 'claude-sonnet-5',
    messages
  })
  assert.equal(second.completion.choices?.[0]?.message?.content, 'claude done')
  return adapter.calls
}

test('toolAgent no longer performs Provider HTTP itself', async () => {
  const src = await read('electron/main/toolAgent.ts')
  assert.doesNotMatch(src, /fetch\(/)
  assert.doesNotMatch(src, /https:\/\/api\.anthropic\.com/)
  assert.doesNotMatch(src, /\/chat\/completions/)
  assert.match(src, /executeAiWithTools/)
  assert.doesNotMatch(src, /apiKey/)
})

test('Router selects Adapter via ProviderRegistry and Resolver', async () => {
  const router = await read('electron/main/ai/router.ts')
  assert.match(router, /export async function executeAiWithTools/)
  assert.match(router, /getProvider\(providerId\)/)
  assert.match(router, /executeWithFailover/)
  assert.match(router, /fallbacksForAgent/)
  const withTools = router.slice(router.indexOf('export async function executeAiWithTools'))
  assert.doesNotMatch(withTools, /credentialOverride/)
})

test('OpenAI Agent tool call → tool execution → tool result → next LLM call', async () => {
  const adapter = {
    calls: [],
    async generateWithTools(_request, credential, options) {
      assert.equal(credential.secret, 'resolver-owned-secret')
      this.calls.push(options)
      if (this.calls.length === 1) {
        assert.ok(Array.isArray(options.tools))
        assert.equal(options.toolChoice, 'required')
        return {
          completion: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          },
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          requestId: 'req_1',
          model: 'gpt-4.1-mini'
        }
      }
      const hasTool = (options.messages ?? []).some(
        (row) => row.role === 'tool' && row.tool_call_id === 'call_1'
      )
      assert.equal(hasTool, true)
      return {
        completion: {
          choices: [{ message: { role: 'assistant', content: 'done reading' }, finish_reason: 'stop' }]
        },
        usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
        requestId: 'req_2',
        model: 'gpt-4.1-mini'
      }
    }
  }
  const calls = await runOpenAiAgentLoop(adapter)
  assert.equal(calls.length, 2)
  const openaiTools = await read('electron/main/ai/adapters/openaiTools.ts')
  assert.match(openaiTools, /\/chat\/completions/)
  assert.match(openaiTools, /body\.tools = params\.tools/)
  assert.match(openaiTools, /body\.tool_choice = toolChoice/)
  assert.match(openaiTools, /Authorization: `Bearer \$\{params\.secret\}`/)
})

test('Claude Agent tool_use → tool execution → tool_result', async () => {
  const adapter = {
    calls: [],
    async generateWithTools(_request, credential, options) {
      assert.equal(credential.secret, 'resolver-owned-secret')
      this.calls.push(options)
      if (this.calls.length === 1) {
        return {
          completion: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'reading',
                  tool_calls: [
                    {
                      id: 'toolu_1',
                      type: 'function',
                      function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          },
          usage: { inputTokens: 9, outputTokens: 6, totalTokens: 15 },
          requestId: 'req_1',
          model: 'claude-sonnet-5'
        }
      }
      const hasResult = (options.messages ?? []).some(
        (row) => row.role === 'tool' && row.tool_call_id === 'toolu_1'
      )
      assert.equal(hasResult, true)
      return {
        completion: {
          choices: [{ message: { role: 'assistant', content: 'claude done' }, finish_reason: 'end_turn' }]
        },
        usage: { inputTokens: 15, outputTokens: 3, totalTokens: 18 },
        requestId: 'req_2',
        model: 'claude-sonnet-5'
      }
    }
  }
  const calls = await runClaudeAgentLoop(adapter)
  assert.equal(calls.length, 2)
  const claudeTools = await read('electron/main/ai/adapters/claudeTools.ts')
  const messages = await read('electron/main/ai/agentMessages.ts')
  assert.match(claudeTools, /x-api-key/)
  assert.match(claudeTools, /anthropic-version/)
  assert.match(claudeTools, /tool_use/)
  assert.match(messages, /tool_result/)
})

test('Gemini / Workers Agent tool_use is AGENT_UNSUPPORTED', async () => {
  const { throwAgentUnsupported, AIError } = await import('../electron/main/ai/errors.ts')
  for (const id of ['gemini', 'workers']) {
    try {
      throwAgentUnsupported(id)
      assert.fail('expected throw')
    } catch (error) {
      assert.equal(error instanceof AIError, true)
      assert.equal(error.code, 'AGENT_UNSUPPORTED')
      assert.equal(error.providerId, id)
    }
  }
  const gemini = await read('electron/main/ai/adapters/gemini.ts')
  const workers = await read('electron/main/ai/adapters/workers.ts')
  assert.match(gemini, /throwAgentUnsupported\('gemini'\)/)
  assert.match(workers, /throwAgentUnsupported\('workers'\)/)
})

test('Cursor stays on @cursor/sdk; Ask still uses executeAi', async () => {
  const cursor = await read('electron/main/cursorAgent.ts')
  const direct = await read('electron/main/directLlm.ts')
  assert.match(cursor, /@cursor\/sdk/)
  assert.doesNotMatch(cursor, /executeAiWithTools/)
  assert.match(direct, /executeAi/)
  assert.match(direct, /runCursorAgent/)
  assert.match(direct, /runToolAgent/)
  assert.doesNotMatch(direct, /apiKey: resolved\.apiKey,\s*\n\s*baseUrl:/)
})

test('OpenAI Adapter maps 401 to AUTH_ERROR in source', async () => {
  const openaiTools = await read('electron/main/ai/adapters/openaiTools.ts')
  const errors = await read('electron/main/ai/errors.ts')
  assert.match(openaiTools, /aiErrorFromLlmHttp\('openai'/)
  assert.match(openaiTools, /response\.status === 429/)
  assert.match(errors, /status === 401 \|\| status === 403/)
  assert.match(errors, /status === 429/)
})
