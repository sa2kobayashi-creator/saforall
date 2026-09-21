import {
  aiErrorFromCaught,
  aiErrorFromLlmHttp,
  flattenMessageContent,
  isRateLimitError,
  modelAllowsRequiredToolChoice,
  modelOmitsTemperature,
  parseExtraHeaders,
  parseRetryAfterMs
} from '../agentMessages'
import type {
  AgentChatCompletion,
  AgentProviderMessage,
  AgentToolCall,
  AgentToolSpec
} from '../toolTypes'

export type OpenAiResponsesToolsCallParams = {
  secret: string
  baseUrl: string
  model: string
  extraHeaders?: string[]
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
}

/** Phase 1/3: only this model uses Responses tools. Catalog is unchanged. */
export function isOpenAiResponsesToolsModel(model: string): boolean {
  return model.trim().toLowerCase() === 'gpt-5.3-codex'
}

/** call_id → response.id for previous_response_id (adapter-local only). */
const responseIdByCallId = new Map<string, string>()

/** Soft upper bound so process-lifetime Map cannot grow without limit. */
const RESPONSE_ID_MAP_MAX = 256

export function resetOpenAiResponsesToolsStateForTests(): void {
  responseIdByCallId.clear()
}

export function getOpenAiResponsesToolsStateSizeForTests(): number {
  return responseIdByCallId.size
}

function rememberResponseId(callId: string, responseId: string): void {
  if (!callId || !responseId) return
  if (responseIdByCallId.has(callId)) responseIdByCallId.delete(callId)
  responseIdByCallId.set(callId, responseId)
  while (responseIdByCallId.size > RESPONSE_ID_MAP_MAX) {
    const oldest = responseIdByCallId.keys().next().value
    if (oldest === undefined) break
    responseIdByCallId.delete(oldest)
  }
}

function forgetCallIds(callIds: string[]): void {
  for (const id of callIds) {
    if (id) responseIdByCallId.delete(id)
  }
}

export function mapAgentToolsToResponsesTools(
  tools: AgentToolSpec[] | undefined
): Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) return []
  return tools.map((row) => ({
    type: 'function',
    name: row.function.name,
    description: row.function.description,
    parameters: row.function.parameters
  }))
}

export function mapToolChoiceForResponses(
  toolChoice: 'auto' | 'required' | undefined,
  model: string
): 'auto' | 'required' {
  if (toolChoice === 'required' && modelAllowsRequiredToolChoice(model)) return 'required'
  return 'auto'
}

function extractMessageText(item: Record<string, unknown>): string {
  const content = item.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const row = part as Record<string, unknown>
    if (typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('')
}

/**
 * Responses output[] → AgentChatCompletion.
 * Tool correlation uses function_call.call_id (never function_call.id / fc_…).
 */
export function normalizeResponsesOutputToAgentChatCompletion(
  json: Record<string, unknown>
): AgentChatCompletion {
  const output = Array.isArray(json.output) ? json.output : []
  const toolCalls: AgentToolCall[] = []
  const textParts: string[] = []
  const responseId = typeof json.id === 'string' ? json.id : ''

  for (const raw of output) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const type = typeof item.type === 'string' ? item.type : ''
    if (type === 'message') {
      const text = extractMessageText(item)
      if (text) textParts.push(text)
      continue
    }
    if (type === 'function_call') {
      // Correlation ID must be call_id — never function_call.id (fc_…).
      const callId =
        typeof item.call_id === 'string' && item.call_id.trim() !== ''
          ? item.call_id.trim()
          : `call_${toolCalls.length + 1}`
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) continue
      const args =
        typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments ?? {})
      toolCalls.push({
        id: callId,
        type: 'function',
        function: { name, arguments: args }
      })
      if (responseId) rememberResponseId(callId, responseId)
    }
  }

  const content = textParts.length > 0 ? textParts.join('\n') : null
  const usageRaw =
    json.usage && typeof json.usage === 'object'
      ? (json.usage as Record<string, unknown>)
      : null
  const inputTokens = Number(usageRaw?.input_tokens) || 0
  const outputTokens = Number(usageRaw?.output_tokens) || 0

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
      }
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens
    }
  }
}

export function mapToolResultsToFunctionCallOutputs(
  messages: AgentProviderMessage[]
): Array<{ type: 'function_call_output'; call_id: string; output: string }> {
  const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i]
    if (!row || row.role !== 'tool') break
    outputs.unshift({
      type: 'function_call_output',
      call_id: row.tool_call_id,
      output: flattenMessageContent(row.content)
    })
  }
  return outputs
}

function findPreviousResponseIdForOutputs(
  outputs: Array<{ call_id: string }>
): string | null {
  for (const row of outputs) {
    const id = responseIdByCallId.get(row.call_id)
    if (id) return id
  }
  return null
}

function extractInstructions(messages: AgentProviderMessage[]): string | undefined {
  const parts: string[] = []
  for (const row of messages) {
    if (row.role !== 'system') continue
    const text = flattenMessageContent(row.content).trim()
    if (text) parts.push(text)
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function messagesToResponsesInput(messages: AgentProviderMessage[]): unknown[] {
  const input: unknown[] = []
  for (const row of messages) {
    if (row.role === 'system') continue
    if (row.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: row.tool_call_id,
        output: flattenMessageContent(row.content)
      })
      continue
    }
    if (row.role === 'assistant' && row.tool_calls && row.tool_calls.length > 0) {
      const text = flattenMessageContent(row.content)
      if (text.trim()) {
        input.push({ role: 'assistant', content: text })
      }
      for (const call of row.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments
        })
      }
      continue
    }
    input.push({
      role: row.role,
      content: flattenMessageContent(row.content)
    })
  }
  return input
}

async function sleepAbortable(ms: number, signal?: AbortSignal | null): Promise<void> {
  const { throwIfChatAborted } = await import('../../chatAbort')
  throwIfChatAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      const err = new Error('Chat cancelled by user')
      err.name = 'AbortError'
      reject(err)
    }
    if (!signal) return
    if (signal.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  throwIfChatAborted(signal)
}

/** Streaming accumulation state (Adapter-local; never forwarded mid-stream). */
export type ResponsesStreamState = {
  textDeltas: string[]
  /** call_id → pending function call */
  calls: Map<
    string,
    {
      name: string
      argumentsDelta: string
      argumentsFinal: string | null
      fcId: string | null
    }
  >
  /** Preserve first-seen order of call_ids */
  callOrder: string[]
  responseId: string | null
  completedResponse: Record<string, unknown> | null
  sawCompleted: boolean
  errorMessage: string | null
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    textDeltas: [],
    calls: new Map(),
    callOrder: [],
    responseId: null,
    completedResponse: null,
    sawCompleted: false,
    errorMessage: null
  }
}

function ensureCall(
  state: ResponsesStreamState,
  callId: string,
  patch?: Partial<{ name: string; fcId: string | null }>
): void {
  if (!callId) return
  let row = state.calls.get(callId)
  if (!row) {
    row = { name: '', argumentsDelta: '', argumentsFinal: null, fcId: null }
    state.calls.set(callId, row)
    state.callOrder.push(callId)
  }
  if (patch?.name && !row.name) row.name = patch.name
  if (patch?.fcId && !row.fcId) row.fcId = patch.fcId
}

/**
 * Apply one Responses SSE event (Phase 2 measured type names).
 * Does not emit UI deltas — buffers only.
 */
export function applyResponsesStreamEvent(
  state: ResponsesStreamState,
  event: Record<string, unknown>
): void {
  const type = typeof event.type === 'string' ? event.type : ''

  if (type === 'response.created' || type === 'response.in_progress') {
    const response =
      event.response && typeof event.response === 'object'
        ? (event.response as Record<string, unknown>)
        : null
    const id =
      (typeof response?.id === 'string' && response.id) ||
      (typeof event.response_id === 'string' && event.response_id) ||
      null
    if (id) state.responseId = id
    return
  }

  if (type === 'response.output_text.delta') {
    if (typeof event.delta === 'string') state.textDeltas.push(event.delta)
    return
  }

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item =
      event.item && typeof event.item === 'object'
        ? (event.item as Record<string, unknown>)
        : null
    if (!item || item.type !== 'function_call') return
    const callId = typeof item.call_id === 'string' ? item.call_id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const fcId = typeof item.id === 'string' ? item.id : null
    ensureCall(state, callId, { name, fcId })
    if (typeof item.arguments === 'string' && item.arguments && callId) {
      const row = state.calls.get(callId)
      if (row && row.argumentsFinal == null && !row.argumentsDelta) {
        // Prefer incomplete item.arguments only as seed; done/delta override.
        row.argumentsDelta = item.arguments
      }
    }
    return
  }

  if (type === 'response.function_call_arguments.delta') {
    const itemId = typeof event.item_id === 'string' ? event.item_id : ''
    const delta = typeof event.delta === 'string' ? event.delta : ''
    // Resolve call_id from item_id (fc_*) when needed.
    let callId = typeof event.call_id === 'string' ? event.call_id.trim() : ''
    if (!callId && itemId) {
      for (const [id, row] of Array.from(state.calls.entries())) {
        if (row.fcId === itemId) {
          callId = id
          break
        }
      }
    }
    if (!callId) {
      // Late delta before output_item.added — ignore until call_id is known.
      return
    }
    ensureCall(state, callId, itemId ? { fcId: itemId } : undefined)
    const row = state.calls.get(callId)
    if (row && row.argumentsFinal == null && delta) {
      row.argumentsDelta += delta
    }
    return
  }

  if (type === 'response.function_call_arguments.done') {
    const itemId = typeof event.item_id === 'string' ? event.item_id : ''
    const finalArgs = typeof event.arguments === 'string' ? event.arguments : ''
    let callId = typeof event.call_id === 'string' ? event.call_id.trim() : ''
    if (!callId && itemId) {
      for (const [id, row] of Array.from(state.calls.entries())) {
        if (row.fcId === itemId) {
          callId = id
          break
        }
      }
    }
    if (!callId) return
    ensureCall(state, callId, itemId ? { fcId: itemId } : undefined)
    const row = state.calls.get(callId)
    if (row) {
      // done wins — never append done onto deltas.
      row.argumentsFinal = finalArgs
    }
    return
  }

  if (type === 'response.completed') {
    state.sawCompleted = true
    const response =
      event.response && typeof event.response === 'object'
        ? (event.response as Record<string, unknown>)
        : null
    if (response) {
      state.completedResponse = response
      if (typeof response.id === 'string') state.responseId = response.id
    }
    return
  }

  if (type === 'response.failed' || type === 'error') {
    const err =
      event.error && typeof event.error === 'object'
        ? (event.error as Record<string, unknown>)
        : null
    const message =
      (typeof err?.message === 'string' && err.message) ||
      (typeof event.message === 'string' && event.message) ||
      'Responses stream failed'
    state.errorMessage = message
  }
}

/**
 * Build AgentChatCompletion from stream state.
 * Prefers response.completed payload when present (Phase 1 normalize path).
 */
export function finalizeResponsesStreamState(
  state: ResponsesStreamState
): AgentChatCompletion {
  if (state.errorMessage) {
    throw new Error(state.errorMessage)
  }
  if (!state.sawCompleted) {
    throw new Error('Responses stream ended without response.completed')
  }
  if (state.completedResponse) {
    return normalizeResponsesOutputToAgentChatCompletion(state.completedResponse)
  }

  // Fallback: assemble from buffered deltas (should be rare if completed payload exists).
  const toolCalls: AgentToolCall[] = []
  for (const callId of state.callOrder) {
    const row = state.calls.get(callId)
    if (!row || !row.name) continue
    const args = row.argumentsFinal != null ? row.argumentsFinal : row.argumentsDelta
    toolCalls.push({
      id: callId,
      type: 'function',
      function: { name: row.name, arguments: args || '{}' }
    })
    if (state.responseId) rememberResponseId(callId, state.responseId)
  }
  const contentJoined = state.textDeltas.join('')
  const content = contentJoined.length > 0 ? contentJoined : null
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      input_tokens: 0,
      output_tokens: 0
    }
  }
}

async function consumeResponsesSse(
  response: Response,
  signal?: AbortSignal | null
): Promise<ResponsesStreamState> {
  const { throwIfChatAborted } = await import('../../chatAbort')
  if (!response.body) {
    throw new Error('Responses stream body is empty')
  }
  const state = createResponsesStreamState()
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      throwIfChatAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep = buffer.indexOf('\n\n')
      while (sep !== -1) {
        const chunk = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const lines = chunk.split('\n')
        let dataStr = ''
        for (const line of lines) {
          const trimmed = line.trimEnd()
          if (trimmed.startsWith('data:')) {
            const part = trimmed.slice(5).trim()
            dataStr = dataStr ? `${dataStr}\n${part}` : part
          }
        }
        if (!dataStr || dataStr === '[DONE]') {
          sep = buffer.indexOf('\n\n')
          continue
        }
        try {
          const event = JSON.parse(dataStr) as Record<string, unknown>
          applyResponsesStreamEvent(state, event)
        } catch {
          // ignore malformed SSE data lines
        }
        sep = buffer.indexOf('\n\n')
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
  return state
}

/**
 * OpenAI Responses API tool calling (SSE) → AgentChatCompletion.
 * Streaming stays inside this adapter; toolAgent still sees a completed completion.
 */
export async function openaiResponsesWithTools(
  params: OpenAiResponsesToolsCallParams
): Promise<AgentChatCompletion> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/responses`
  let lastError: Error | null = null
  const toolChoice = mapToolChoiceForResponses(params.toolChoice, params.model)
  const responsesTools = mapAgentToolsToResponsesTools(params.tools)
  const timeoutMs = params.timeoutMs ?? 45_000
  const { linkedAbortSignal, throwIfChatAborted, isChatAbortError } =
    await import('../../chatAbort')

  const trailingOutputs = mapToolResultsToFunctionCallOutputs(params.messages)
  const previousResponseId = findPreviousResponseIdForOutputs(trailingOutputs)
  const useContinuation = Boolean(previousResponseId && trailingOutputs.length > 0)
  const continuationCallIds = trailingOutputs.map((row) => row.call_id)

  for (let attempt = 0; attempt < 6; attempt += 1) {
    throwIfChatAborted(params.signal)
    const body: Record<string, unknown> = {
      model: params.model,
      stream: true
    }
    if (!modelOmitsTemperature(params.model)) {
      body.temperature = 0.2
    }
    if (responsesTools.length > 0) {
      body.tools = responsesTools
      body.tool_choice = toolChoice
    }

    if (useContinuation && previousResponseId) {
      body.previous_response_id = previousResponseId
      body.input = trailingOutputs
    } else {
      const instructions = extractInstructions(params.messages)
      if (instructions) body.instructions = instructions
      body.input = messagesToResponsesInput(params.messages)
    }

    const linked = linkedAbortSignal(timeoutMs, params.signal)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.secret}`,
          Accept: 'text/event-stream',
          ...parseExtraHeaders(params.extraHeaders ?? [])
        },
        body: JSON.stringify(body),
        signal: linked.signal
      })

      // Non-2xx: JSON error body (not SSE) — confirmed in Phase 2.
      if (!response.ok) {
        const bodyText = await response.text()
        const err = aiErrorFromLlmHttp('openai', response.status, bodyText)
        if (response.status === 429 && attempt < 5) {
          lastError = err
          await sleepAbortable(parseRetryAfterMs(err.message, attempt), params.signal)
          continue
        }
        throw err
      }

      const state = await consumeResponsesSse(response, params.signal)
      const completion = finalizeResponsesStreamState(state)
      // Continuation call_ids are no longer needed after the next response succeeds.
      if (useContinuation) forgetCallIds(continuationCallIds)
      return completion
    } catch (error) {
      if (isChatAbortError(error) || params.signal?.aborted) {
        // Abort is not success — do not treat as completed. No new Map writes without
        // response.completed normalize; still drop consumed continuation keys on abort
        // only if we never need retry of the same tool outputs in this process turn.
        // Keep continuation keys so a user retry can still continue; no extra writes.
        throw error
      }
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 5 && isRateLimitError(lastError.message)) {
        await sleepAbortable(parseRetryAfterMs(lastError.message, attempt), params.signal)
        continue
      }
      if (attempt < 3 && /abort|network|fetch failed|ECONNRESET/i.test(lastError.message)) {
        await sleepAbortable(500 * (attempt + 1), params.signal)
        continue
      }
      if (!/LLM HTTP 400/i.test(lastError.message) || attempt >= 3) {
        throw aiErrorFromCaught('openai', lastError)
      }
      await sleepAbortable(400 * (attempt + 1), params.signal)
    } finally {
      linked.dispose()
    }
  }

  throw aiErrorFromCaught('openai', lastError ?? new Error('LLM request failed'))
}
