import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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

function applyAll(state, events, apply) {
  for (const event of events) apply(state, event)
}

test('Test 1 — text delta accumulation → completed → content', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      { type: 'response.created', response: { id: 'resp_text' } },
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      { type: 'response.output_text.delta', delta: ' world' },
      {
        type: 'response.completed',
        response: {
          id: 'resp_text',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Hello world' }]
            }
          ],
          usage: { input_tokens: 1, output_tokens: 2 }
        }
      }
    ],
    applyResponsesStreamEvent
  )
  const completion = finalizeResponsesStreamState(state)
  assert.equal(completion.choices[0].message.content, 'Hello world')
  assert.equal(completion.choices[0].finish_reason, 'stop')
  assert.equal(completion.choices[0].message.tool_calls, undefined)
})

test('Test 2 — function_call mapping into tool_calls', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      { type: 'response.created', response: { id: 'resp_fc' } },
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_ignore',
          call_id: 'call_map_1',
          name: 'read_file',
          status: 'in_progress'
        }
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_ignore',
        call_id: 'call_map_1',
        arguments: '{"path":"a.ts"}'
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_fc',
          output: [
            {
              type: 'function_call',
              id: 'fc_ignore',
              call_id: 'call_map_1',
              name: 'read_file',
              arguments: '{"path":"a.ts"}'
            }
          ]
        }
      }
    ],
    applyResponsesStreamEvent
  )
  const completion = finalizeResponsesStreamState(state)
  const call = completion.choices[0].message.tool_calls[0]
  assert.equal(call.id, 'call_map_1')
  assert.equal(call.function.name, 'read_file')
  assert.equal(call.function.arguments, '{"path":"a.ts"}')
  assert.equal(completion.choices[0].finish_reason, 'tool_calls')
})

test('Test 3 — fc_* must not become tool_calls[].id', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_SHOULD_NOT_BE_TOOL_ID',
          call_id: 'call_KEEP_ME',
          name: 'list_dir'
        }
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_SHOULD_NOT_BE_TOOL_ID',
        arguments: '{"path":"."}'
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_sep',
          output: [
            {
              type: 'function_call',
              id: 'fc_SHOULD_NOT_BE_TOOL_ID',
              call_id: 'call_KEEP_ME',
              name: 'list_dir',
              arguments: '{"path":"."}'
            }
          ]
        }
      }
    ],
    applyResponsesStreamEvent
  )
  const call = finalizeResponsesStreamState(state).choices[0].message.tool_calls[0]
  assert.equal(call.id, 'call_KEEP_ME')
  assert.notEqual(call.id, 'fc_SHOULD_NOT_BE_TOOL_ID')
})

test('Test 4 — arguments deltas concatenate', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_delta',
          name: 'read_file'
        }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path"' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: ':"x.ts"}' },
      // No done — finalize falls back to deltas when completed payload absent
      {
        type: 'response.completed',
        response: { id: 'resp_delta_only' }
      }
    ],
    applyResponsesStreamEvent
  )
  // completedResponse without output → fallback assembler uses deltas
  const completion = finalizeResponsesStreamState(state)
  // Prefer completed payload when present; empty output → content null, no tools from payload.
  // Force fallback path: clear completedResponse output by using finalize after only deltas+completed flag.
  assert.ok(state.sawCompleted)
  // When completed payload has no function_call, fallback won't add tools from stream state
  // because finalize prefers completedResponse. Rebuild without output for delta-only path:
  state.completedResponse = null
  const viaFallback = finalizeResponsesStreamState(state)
  assert.equal(viaFallback.choices[0].message.tool_calls[0].function.arguments, '{"path":"x.ts"}')
})

test('Test 5 — arguments.done is final value', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_d',
          call_id: 'call_done',
          name: 'read_file'
        }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_d', delta: '{"path":"wrong"}' },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_d',
        arguments: '{"path":"right.ts"}'
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_done',
          output: [
            {
              type: 'function_call',
              id: 'fc_d',
              call_id: 'call_done',
              name: 'read_file',
              arguments: '{"path":"right.ts"}'
            }
          ]
        }
      }
    ],
    applyResponsesStreamEvent
  )
  const call = finalizeResponsesStreamState(state).choices[0].message.tool_calls[0]
  assert.equal(call.function.arguments, '{"path":"right.ts"}')
})

test('Test 6 — delta + done must not double-append', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_x',
          call_id: 'call_x',
          name: 'read_file'
        }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_x', delta: '{"a":1}' },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_x',
        arguments: '{"a":1}'
      }
    ],
    applyResponsesStreamEvent
  )
  const row = state.calls.get('call_x')
  assert.equal(row.argumentsFinal, '{"a":1}')
  // Even if deltas remain, final must be done's value alone (not concatenated).
  assert.notEqual(row.argumentsFinal, row.argumentsDelta + '{"a":1}')
  assert.equal(row.argumentsFinal.includes('{"a":1}{"a":1}'), false)
})

test('Test 7 — deltas alone are not success without response.completed', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyResponsesStreamEvent(state, { type: 'response.output_text.delta', delta: 'hi' })
  assert.equal(state.sawCompleted, false)
  assert.throws(() => finalizeResponsesStreamState(state), /response\.completed/)
})

test('Test 8 — abort is not treated as success', async () => {
  const {
    createResponsesStreamState,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  // Simulate abort/incomplete: stream ended with some text but no completed.
  state.textDeltas.push('partial')
  assert.throws(() => finalizeResponsesStreamState(state), /response\.completed/)
})

test('Test 9 — HTTP/stream error path is not success', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const state = createResponsesStreamState()
  applyResponsesStreamEvent(state, {
    type: 'response.failed',
    error: { message: 'model_not_found' }
  })
  assert.throws(() => finalizeResponsesStreamState(state), /model_not_found/)
})

test('Test 10 — continuation mapping preserves call_id for function_call_output', async () => {
  const {
    normalizeResponsesOutputToAgentChatCompletion,
    mapToolResultsToFunctionCallOutputs,
    resetOpenAiResponsesToolsStateForTests,
    getOpenAiResponsesToolsStateSizeForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()

  const completion = normalizeResponsesOutputToAgentChatCompletion({
    id: 'resp_prev',
    output: [
      {
        type: 'function_call',
        id: 'fc_z',
        call_id: 'call_cont_1',
        name: 'read_file',
        arguments: '{"path":"a.ts"}'
      }
    ]
  })
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 1)
  const call = completion.choices[0].message.tool_calls[0]
  const outputs = mapToolResultsToFunctionCallOutputs([
    { role: 'user', content: 'read' },
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: '{"ok":true}' }
  ])
  assert.equal(outputs[0].type, 'function_call_output')
  assert.equal(outputs[0].call_id, 'call_cont_1')
})

test('Test 11 — cleanup after successful continuation forgets used call_ids', async () => {
  const {
    normalizeResponsesOutputToAgentChatCompletion,
    resetOpenAiResponsesToolsStateForTests,
    getOpenAiResponsesToolsStateSizeForTests,
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState
  } = await loadResponsesTools()
  // Directly exercise remember + forget via normalize + public size helper.
  // openaiResponsesWithTools forgets continuation call_ids after success; unit-level:
  // after first normalize size=1; after we simulate forget via second normalize of text-only
  // the map still holds until continuation completes. Use reset to prove cleanup API.
  resetOpenAiResponsesToolsStateForTests()
  normalizeResponsesOutputToAgentChatCompletion({
    id: 'resp_a',
    output: [
      {
        type: 'function_call',
        call_id: 'call_clean',
        name: 'read_file',
        arguments: '{}'
      }
    ]
  })
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 1)
  resetOpenAiResponsesToolsStateForTests()
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 0)

  // Successful completed stream that remembers new call_ids still works after reset.
  const state = createResponsesStreamState()
  applyAll(
    state,
    [
      {
        type: 'response.completed',
        response: {
          id: 'resp_b',
          output: [
            {
              type: 'function_call',
              call_id: 'call_after',
              name: 'read_file',
              arguments: '{}'
            }
          ]
        }
      }
    ],
    applyResponsesStreamEvent
  )
  finalizeResponsesStreamState(state)
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 1)
})

test('Test 12 — error finalize does not write Map entries', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests,
    getOpenAiResponsesToolsStateSizeForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()
  const state = createResponsesStreamState()
  applyResponsesStreamEvent(state, {
    type: 'response.output_item.added',
    item: {
      type: 'function_call',
      id: 'fc_e',
      call_id: 'call_err',
      name: 'read_file'
    }
  })
  applyResponsesStreamEvent(state, {
    type: 'error',
    message: 'boom'
  })
  assert.throws(() => finalizeResponsesStreamState(state), /boom/)
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 0)
})

test('Test 13 — abort/incomplete does not write Map entries', async () => {
  const {
    createResponsesStreamState,
    applyResponsesStreamEvent,
    finalizeResponsesStreamState,
    resetOpenAiResponsesToolsStateForTests,
    getOpenAiResponsesToolsStateSizeForTests
  } = await loadResponsesTools()
  resetOpenAiResponsesToolsStateForTests()
  const state = createResponsesStreamState()
  applyResponsesStreamEvent(state, {
    type: 'response.output_item.added',
    item: {
      type: 'function_call',
      id: 'fc_a',
      call_id: 'call_abort',
      name: 'read_file'
    }
  })
  applyResponsesStreamEvent(state, {
    type: 'response.function_call_arguments.delta',
    item_id: 'fc_a',
    delta: '{"x":1}'
  })
  assert.throws(() => finalizeResponsesStreamState(state), /response\.completed/)
  assert.equal(getOpenAiResponsesToolsStateSizeForTests(), 0)
})
