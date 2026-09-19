import { AsyncLocalStorage } from 'node:async_hooks'
import {
  aiErrorFromCaught,
  aiErrorFromLlmHttp,
  flattenMessageContent,
  normalizeToolCalls,
  repairToolArguments
} from '../agentMessages'
import { AIError } from '../errors'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolCall, AgentToolSpec } from '../toolTypes'

export type GeminiToolsCallParams = {
  secret: string
  model: string
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
}

type GeminiPart = Record<string, unknown>
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

type GeminiCandidate = {
  content?: { parts?: GeminiPart[]; role?: string }
  finishReason?: string
  finish_reason?: string
}

const GEMINI_GENERATE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const BLOCKING_FINISH = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'MALFORMED_FUNCTION_CALL',
  'IMAGE_SAFETY'
])

type GeminiThoughtState = {
  callNames: Map<string, string>
  thoughtByCallId: Map<string, string>
  extraThoughtPartsByTurn: Map<string, GeminiPart[]>
}

/** Agent-run scoped. Not persisted. Not process-global. */
const geminiThoughtAls = new AsyncLocalStorage<GeminiThoughtState>()

function createGeminiThoughtState(): GeminiThoughtState {
  return {
    callNames: new Map(),
    thoughtByCallId: new Map(),
    extraThoughtPartsByTurn: new Map()
  }
}

function geminiThoughtState(): GeminiThoughtState {
  return geminiThoughtAls.getStore() ?? createGeminiThoughtState()
}

/**
 * Bind thought/signature maps to one Agent run. Clears on success, error, or cancel.
 */
export async function runWithGeminiThoughtState<T>(fn: () => Promise<T> | T): Promise<T> {
  const state = createGeminiThoughtState()
  return geminiThoughtAls.run(state, async () => {
    try {
      return await fn()
    } finally {
      state.callNames.clear()
      state.thoughtByCallId.clear()
      state.extraThoughtPartsByTurn.clear()
    }
  })
}

function rememberCall(id: string, name: string, signature?: string): void {
  const state = geminiThoughtState()
  state.callNames.set(id, name)
  if (signature) state.thoughtByCallId.set(id, signature)
}

function turnKey(ids: string[]): string {
  return ids.join('\0')
}

function assistantToolTurnIndex(messages: AgentProviderMessage[]): number {
  let count = 0
  for (const row of messages) {
    if (row.role === 'assistant' && Array.isArray(row.tool_calls) && row.tool_calls.length > 0) {
      count += 1
    }
  }
  return count
}

function assistantMessageIndex(messages: AgentProviderMessage[]): number {
  return messages.filter((row) => row.role === 'assistant').length
}

function asstThoughtKey(index: number): string {
  return `asst:${index}`
}

function parseArgsObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(repairToolArguments(raw)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
  }
  return {}
}

function signatureOfPart(part: GeminiPart): string | undefined {
  if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.trim()) {
    return part.thoughtSignature
  }
  if (typeof part.thought_signature === 'string' && part.thought_signature.trim()) {
    return part.thought_signature
  }
  return undefined
}

function isThoughtOnlyPart(part: GeminiPart): boolean {
  if (part.functionCall || part.functionResponse) return false
  return part.thought === true || Boolean(signatureOfPart(part) && part.text)
}

/** Gemini Schema proto rejects JSON Schema fields such as additionalProperties. */
const GEMINI_SCHEMA_DROP = new Set([
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'unevaluatedProperties',
  'patternProperties',
  'propertyNames',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
  'not',
  'oneOf',
  'allOf',
  'uniqueItems',
  'const',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'prefixItems'
])

export function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((row) => sanitizeGeminiSchema(row))
  }
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (GEMINI_SCHEMA_DROP.has(key)) continue
    out[key] = sanitizeGeminiSchema(nested)
  }
  return out
}

export function toGeminiFunctionDeclarations(
  tools: AgentToolSpec[]
): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return tools.map((row) => {
    const raw =
      row.function.parameters && typeof row.function.parameters === 'object'
        ? row.function.parameters
        : { type: 'object', properties: {} }
    const parameters = sanitizeGeminiSchema(raw) as Record<string, unknown>
    if (!parameters.type) parameters.type = 'object'
    if (!parameters.properties || typeof parameters.properties !== 'object') {
      parameters.properties = {}
    }
    return {
      name: row.function.name,
      description: row.function.description,
      parameters
    }
  })
}

export function toGeminiTools(tools: AgentToolSpec[]): Array<{ functionDeclarations: ReturnType<typeof toGeminiFunctionDeclarations> }> {
  return [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }]
}

function nameForCallId(messages: AgentProviderMessage[], id: string): string | null {
  const remembered = geminiThoughtState().callNames.get(id)
  if (remembered) return remembered
  for (const row of messages) {
    if (row.role !== 'assistant' || !row.tool_calls) continue
    for (const call of normalizeToolCalls(row.tool_calls)) {
      if (call.id === id) return call.function.name
    }
  }
  return null
}

function functionResponsePayload(content: unknown): Record<string, unknown> {
  const text = flattenMessageContent(content)
  if (!text.trim()) return { result: '' }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { result: parsed as unknown }
  } catch {
    return { result: text }
  }
}

function pushContent(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]): void {
  if (parts.length === 0) return
  const last = contents[contents.length - 1]
  if (last && last.role === role) {
    last.parts.push(...parts)
    return
  }
  contents.push({ role, parts })
}

export function toGeminiContents(messages: AgentProviderMessage[]): {
  systemParts: Array<{ text: string }>
  contents: GeminiContent[]
} {
  const systemParts: Array<{ text: string }> = []
  const contents: GeminiContent[] = []
  const pendingResponses: GeminiPart[] = []
  let assistantSeen = 0

  const flushResponses = (): void => {
    if (pendingResponses.length === 0) return
    pushContent(contents, 'user', pendingResponses.splice(0, pendingResponses.length))
  }

  for (const row of messages) {
    if (row.role === 'system') {
      const text = flattenMessageContent(row.content).trim()
      if (text) systemParts.push({ text })
      continue
    }
    if (row.role === 'tool') {
      const name = nameForCallId(messages, row.tool_call_id) || 'unknown_tool'
      const response: Record<string, unknown> = {
        name,
        response: functionResponsePayload(row.content)
      }
      if (row.tool_call_id) response.id = row.tool_call_id
      pendingResponses.push({ functionResponse: response })
      continue
    }
    if (row.role === 'user') {
      flushResponses()
      const text = flattenMessageContent(row.content)
      if (text.trim()) pushContent(contents, 'user', [{ text }])
      continue
    }

    flushResponses()
    const calls = normalizeToolCalls(row.tool_calls)
    const parts: GeminiPart[] = []
    const state = geminiThoughtState()
    const extraFromCalls =
      calls.length > 0 ? state.extraThoughtPartsByTurn.get(turnKey(calls.map((call) => call.id))) : null
    const extraFromAsst = state.extraThoughtPartsByTurn.get(asstThoughtKey(assistantSeen))
    assistantSeen += 1
    const extra = extraFromCalls && extraFromCalls.length > 0 ? extraFromCalls : extraFromAsst
    if (extra && extra.length > 0) parts.push(...extra)
    const text = flattenMessageContent(row.content).trim()
    if (text) parts.push({ text })
    for (const call of calls) {
      const args = parseArgsObject(call.function.arguments)
      const functionCall: Record<string, unknown> = { name: call.function.name, args }
      if (call.id) functionCall.id = call.id
      const part: GeminiPart = { functionCall }
      const signature = state.thoughtByCallId.get(call.id)
      if (signature) part.thoughtSignature = signature
      parts.push(part)
      rememberCall(call.id, call.function.name, signature)
    }
    if (parts.length > 0) pushContent(contents, 'model', parts)
  }
  flushResponses()

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '(continue)' }] })
  }
  if (contents[0]?.role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] })
  }
  return { systemParts, contents }
}

function finishReasonOf(candidate: GeminiCandidate | undefined): string {
  const raw = candidate?.finishReason || candidate?.finish_reason || ''
  return String(raw).toUpperCase()
}

export function mapGeminiFinishReason(finishReason: string, hasToolCalls: boolean): string {
  if (hasToolCalls) return 'tool_calls'
  if (finishReason === 'MAX_TOKENS') return 'length'
  if (finishReason === 'STOP' || finishReason === '' || finishReason === 'FINISH_REASON_UNSPECIFIED') {
    return 'stop'
  }
  return finishReason.toLowerCase() || 'stop'
}

export function geminiCandidateToCompletion(input: {
  candidate?: GeminiCandidate | null
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  messages: AgentProviderMessage[]
  promptBlockReason?: string | null
}): AgentChatCompletion {
  const block = (input.promptBlockReason || '').trim().toUpperCase()
  if (block) {
    throw new AIError('PROVIDER_ERROR', `Gemini SAFETY: ${block}`, { providerId: 'gemini' })
  }
  const finish = finishReasonOf(input.candidate ?? undefined)
  if (BLOCKING_FINISH.has(finish)) {
    throw new AIError('PROVIDER_ERROR', `Gemini ${finish}`, { providerId: 'gemini' })
  }

  const parts = Array.isArray(input.candidate?.content?.parts) ? input.candidate.content.parts : []
  const textParts: string[] = []
  const toolCalls: AgentToolCall[] = []
  const extraThought: GeminiPart[] = []
  const turn = assistantToolTurnIndex(input.messages)
  const asstIndex = assistantMessageIndex(input.messages)

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part || typeof part !== 'object') continue
    if (isThoughtOnlyPart(part)) {
      extraThought.push({ ...part })
      continue
    }
    if (typeof part.text === 'string' && part.text && !part.functionCall) {
      textParts.push(part.text)
    }
    const call = part.functionCall
    if (!call || typeof call !== 'object') continue
    const fn = call as Record<string, unknown>
    const name = typeof fn.name === 'string' ? fn.name.trim() : ''
    if (!name) continue
    const nativeId = typeof fn.id === 'string' && fn.id.trim() ? fn.id.trim() : ''
    const id = nativeId || `gemini-call-${turn}-${toolCalls.length}`
    const args = parseArgsObject(fn.args ?? fn.arguments)
    toolCalls.push({
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) }
    })
    rememberCall(id, name, signatureOfPart(part))
  }
  if (extraThought.length > 0) {
    const state = geminiThoughtState()
    state.extraThoughtPartsByTurn.set(asstThoughtKey(asstIndex), extraThought)
    if (toolCalls.length > 0) {
      state.extraThoughtPartsByTurn.set(
        turnKey(toolCalls.map((call) => call.id)),
        extraThought
      )
    }
  }

  const content = textParts.join('\n')
  // Thought-only / empty candidate: keep the Agent loop alive. Ask generate() still
  // rejects empty visible text. Do not throw PROVIDER_ERROR here.

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: content.trim() ? content : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: mapGeminiFinishReason(finish, toolCalls.length > 0)
      }
    ],
    usage: {
      input_tokens: Number(input.usageMetadata?.promptTokenCount) || 0,
      output_tokens: Number(input.usageMetadata?.candidatesTokenCount) || 0
    }
  }
}

export function geminiGenerateUrl(model: string): string {
  return `${GEMINI_GENERATE_BASE}/${encodeURIComponent(model)}:generateContent`
}

/**
 * Gemini generateContent function calling → AgentChatCompletion.
 * Does not record UsageEvent.
 */
export async function geminiGenerateContentWithTools(
  params: GeminiToolsCallParams
): Promise<AgentChatCompletion> {
  const { systemParts, contents } = toGeminiContents(params.messages)
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  }
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: systemParts }
  }
  if (params.tools && params.tools.length > 0) {
    body.tools = toGeminiTools(params.tools)
    body.toolConfig = {
      functionCallingConfig: {
        mode: params.toolChoice === 'required' ? 'ANY' : 'AUTO'
      }
    }
  }

  const { linkedAbortSignal, throwIfChatAborted, isChatAbortError } = await import('../../chatAbort')
  throwIfChatAborted(params.signal)
  const linked = linkedAbortSignal(params.timeoutMs ?? 90_000, params.signal)
  try {
    let response: Response
    try {
      response = await fetch(geminiGenerateUrl(params.model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': params.secret
        },
        body: JSON.stringify(body),
        signal: linked.signal
      })
    } catch (error) {
      if (isChatAbortError(error) || params.signal?.aborted) throw error
      throw aiErrorFromCaught('gemini', error)
    }
    const bodyText = await response.text()
    let json: {
      candidates?: GeminiCandidate[]
      promptFeedback?: { blockReason?: string; block_reason?: string }
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      error?: { message?: string; status?: string }
    }
    try {
      json = JSON.parse(bodyText) as typeof json
    } catch {
      throw aiErrorFromLlmHttp('gemini', response.status, bodyText)
    }
    if (!response.ok) {
      throw aiErrorFromLlmHttp('gemini', response.status, bodyText)
    }
    const promptBlock = json.promptFeedback?.blockReason || json.promptFeedback?.block_reason || null
    return geminiCandidateToCompletion({
      candidate: json.candidates?.[0] ?? null,
      usageMetadata: json.usageMetadata,
      messages: params.messages,
      promptBlockReason: promptBlock
    })
  } finally {
    linked.dispose()
  }
}
