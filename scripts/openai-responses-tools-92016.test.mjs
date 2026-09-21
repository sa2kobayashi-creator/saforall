import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

async function loadResponsesTools() {
  const esbuild = await import('esbuild')
  const bundled = await esbuild.build({
    entryPoints: [join(root, 'electron/main/ai/adapters/openaiResponsesTools.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external'
  })
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(bundled.outputFiles[0].text)}`
  return import(dataUrl)
}

test('Unit 1 — function_call → AgentChatCompletion.tool_calls uses call_id', async () => {
  const {
    normalizeResponsesOutputToAgentChatCompletion,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const completion = normalizeResponsesOutputToAgentChatCompletion({
    id: 'resp_1',
    output: [
      {
        type: 'function_call',
        id: 'fc_should_not_be_used',
        call_id: 'call_abc123',
        name: 'read_file',
        arguments: '{"path":"a.ts"}'
      }
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
  })

  const call = completion.choices[0].message.tool_calls[0]
  assert.equal(call.id, 'call_abc123')
  assert.notEqual(call.id, 'fc_should_not_be_used')
  assert.equal(call.type, 'function')
  assert.equal(call.function.name, 'read_file')
  assert.equal(call.function.arguments, '{"path":"a.ts"}')
  assert.equal(completion.choices[0].finish_reason, 'tool_calls')
  assert.equal(completion.choices[0].message.content, null)
  assert.equal(completion.usage.prompt_tokens, 10)
  assert.equal(completion.usage.completion_tokens, 5)
})

test('Unit 2 — message → AgentChatCompletion.content', async () => {
  const {
    normalizeResponsesOutputToAgentChatCompletion,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const completion = normalizeResponsesOutputToAgentChatCompletion({
    id: 'resp_text',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'hello from responses' }]
      }
    ],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }
  })

  assert.equal(completion.choices[0].message.content, 'hello from responses')
  assert.equal(completion.choices[0].message.tool_calls, undefined)
  assert.equal(completion.choices[0].finish_reason, 'stop')
})

test('Unit 3 — tool result → function_call_output', async () => {
  const { mapToolResultsToFunctionCallOutputs } = await loadResponsesTools()
  const outputs = mapToolResultsToFunctionCallOutputs([
    { role: 'user', content: 'read' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_xyz',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'call_xyz', content: '{"ok":true,"text":"export {}"}' }
  ])

  assert.equal(outputs.length, 1)
  assert.deepEqual(outputs[0], {
    type: 'function_call_output',
    call_id: 'call_xyz',
    output: '{"ok":true,"text":"export {}"}'
  })
})

test('Unit 4 — call_id preserved across normalize → function_call_output', async () => {
  const {
    normalizeResponsesOutputToAgentChatCompletion,
    mapToolResultsToFunctionCallOutputs,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const completion = normalizeResponsesOutputToAgentChatCompletion({
    id: 'resp_roundtrip',
    output: [
      {
        type: 'function_call',
        id: 'fc_ignored',
        call_id: 'call_roundtrip_1',
        name: 'list_dir',
        arguments: '{"path":"."}'
      }
    ]
  })
  const call = completion.choices[0].message.tool_calls[0]
  assert.equal(call.id, 'call_roundtrip_1')

  const outputs = mapToolResultsToFunctionCallOutputs([
    { role: 'user', content: 'list' },
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: '{"ok":true}' }
  ])
  assert.equal(outputs[0].call_id, 'call_roundtrip_1')
})

test('Unit 5 — gpt-5.3-codex routes to Responses; other OpenAI models stay Completions', async () => {
  const {
    isOpenAiResponsesToolsModel,
    mapAgentToolsToResponsesTools
  } = await loadResponsesTools()

  assert.equal(isOpenAiResponsesToolsModel('gpt-5.3-codex'), true)
  assert.equal(isOpenAiResponsesToolsModel('GPT-5.3-Codex'), true)
  assert.equal(isOpenAiResponsesToolsModel('gpt-4.1-mini'), false)
  assert.equal(isOpenAiResponsesToolsModel('gpt-5'), false)
  assert.equal(isOpenAiResponsesToolsModel('o3-mini'), false)
  assert.equal(isOpenAiResponsesToolsModel('gpt-5.3'), false)

  const tools = mapAgentToolsToResponsesTools([
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content']
        }
      }
    }
  ])
  assert.equal(tools[0].type, 'function')
  assert.equal(tools[0].name, 'edit_file')
  assert.equal(tools[0].description, 'Edit a file')
  assert.deepEqual(tools[0].parameters.required, ['path', 'content'])
  assert.ok(tools[0].parameters.properties.path)

  const openai = await read('electron/main/ai/adapters/openai.ts')
  assert.match(openai, /isOpenAiResponsesToolsModel/)
  assert.match(openai, /openaiResponsesWithTools/)
  assert.match(openai, /openaiChatCompletionsWithTools/)

  const responsesSrc = await read('electron/main/ai/adapters/openaiResponsesTools.ts')
  assert.match(responsesSrc, /\/responses/)
  assert.match(responsesSrc, /previous_response_id/)
  assert.match(responsesSrc, /function_call_output/)
  assert.match(responsesSrc, /call_id/)
  assert.doesNotMatch(responsesSrc, /stream:\s*true/)

  const toolAgent = await read('electron/main/toolAgent.ts')
  assert.doesNotMatch(toolAgent, /openaiResponses|previous_response_id|function_call_output/)

  const openaiTools = await read('electron/main/ai/adapters/openaiTools.ts')
  assert.match(openaiTools, /\/chat\/completions/)
  assert.doesNotMatch(openaiTools, /\/responses/)
})
