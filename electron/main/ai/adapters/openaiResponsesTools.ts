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

/** Phase 1: only this model uses Responses tools. Catalog is unchanged. */
export function isOpenAiResponsesToolsModel(model: string): boolean {
  return model.trim().toLowerCase() === 'gpt-5.3-codex'
}

/** call_id → response.id for previous_response_id (adapter-local only). */
const responseIdByCallId = new Map<string, string>()

export function resetOpenAiResponsesToolsStateForTests(): void {
  responseIdByCallId.clear()
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
      if (responseId) responseIdByCallId.set(callId, responseId)
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

/**
 * OpenAI Responses API tool calling → AgentChatCompletion.
 * previous_response_id continuation stays inside this adapter.
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

  for (let attempt = 0; attempt < 6; attempt += 1) {
    throwIfChatAborted(params.signal)
    const body: Record<string, unknown> = {
      model: params.model
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
          ...parseExtraHeaders(params.extraHeaders ?? [])
        },
        body: JSON.stringify(body),
        signal: linked.signal
      })

      const bodyText = await response.text()
      let json: Record<string, unknown>
      try {
        json = JSON.parse(bodyText) as Record<string, unknown>
      } catch {
        throw aiErrorFromLlmHttp('openai', response.status, bodyText)
      }

      if (!response.ok) {
        const err = aiErrorFromLlmHttp('openai', response.status, bodyText)
        if (response.status === 429 && attempt < 5) {
          lastError = err
          await sleepAbortable(parseRetryAfterMs(err.message, attempt), params.signal)
          continue
        }
        throw err
      }

      return normalizeResponsesOutputToAgentChatCompletion(json)
    } catch (error) {
      if (isChatAbortError(error) || params.signal?.aborted) {
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
