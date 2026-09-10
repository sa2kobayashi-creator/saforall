import { extraHeadersFor, requireCredential, resolveCredential } from './credentials'
import { AIError, throwAgentUnsupported } from './errors'
import { getProvider } from './registry'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolSpec } from './toolTypes'
import {
  isLlmProviderId,
  parseProviderId,
  type AIRequest,
  type AIResponse,
  type LlmProviderId,
  type RoutingMode
} from './types'
import { recordUsage } from './usage'

const LLM_AUTO_ORDER: LlmProviderId[] = ['openai', 'claude', 'gemini', 'workers']

function selectProvider(request: AIRequest): LlmProviderId {
  const mode: RoutingMode = request.routingMode ?? (request.provider === 'auto' ? 'auto' : 'manual')
  if (mode === 'manual' || (request.provider && request.provider !== 'auto')) {
    const id = parseProviderId(String(request.provider))
    if (!id) {
      throw new AIError('PROVIDER_ERROR', `未知の Provider: ${String(request.provider)}`)
    }
    if (!isLlmProviderId(id)) {
      throw new AIError(
        'PROVIDER_ERROR',
        'Cursor は LLM Provider ではありません。既存の Cursor Agent 経路を使ってください。',
        { providerId: id }
      )
    }
    return id
  }
  for (const id of LLM_AUTO_ORDER) {
    if (resolveCredential(id).available) return id
  }
  throw new AIError('AUTH_ERROR', '利用可能な Credential がありません')
}

function sessionIdFromMeta(metadata?: Record<string, unknown>): number | null {
  const value = metadata?.sessionId
  return typeof value === 'number' ? value : null
}

/**
 * Phase 1 Router: provider + credential + adapter + usage.
 * No billing / plan / credit checks live here.
 */
export async function executeAi(request: AIRequest): Promise<AIResponse> {
  const providerId = selectProvider(request)
  const credential = requireCredential(providerId)
  const adapter = getProvider(providerId)
  const model = request.model || adapter.availableModels()[0] || ''
  const started = Date.now()
  try {
    const response = await adapter.generate(
      {
        ...request,
        provider: providerId,
        model,
        extraHeaders: request.extraHeaders ?? extraHeadersFor(credential),
        baseUrl: request.baseUrl || credential.baseUrl
      },
      credential
    )
    await recordUsage({
      provider: providerId,
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      requestId: response.requestId,
      status: 'ok',
      sessionId: sessionIdFromMeta(request.metadata),
      estimatedCost: undefined,
      billingMode: credential.billingMode,
      credentialId: credential.id,
      userId: credential.ownerType === 'user' ? 'local-user' : null
    })
    return {
      ...response,
      metadata: {
        ...response.metadata,
        routingMode: request.routingMode ?? 'manual',
        elapsedMs: Date.now() - started,
        credentialSource: credential.source
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordUsage({
      provider: providerId,
      model,
      status: 'error',
      requestId: request.metadata?.requestId ? String(request.metadata.requestId) : undefined,
      sessionId: sessionIdFromMeta(request.metadata),
      billingMode: credential.billingMode,
      credentialId: credential.id,
      userId: credential.ownerType === 'user' ? 'local-user' : null
    })
    if (error instanceof AIError) throw error
    throw new AIError('UNKNOWN', message, { providerId })
  }
}

export type ExecuteAiWithToolsInput = {
  provider: string
  model: string
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  extraHeaders?: string[]
  baseUrl?: string
  timeoutMs?: number
  signal?: AbortSignal | null
  sessionId?: number | null
}

/**
 * Agent tool_use path. Credential is resolved immediately before the Adapter call.
 * Callers (toolAgent) must not pass secrets.
 */
export async function executeAiWithTools(input: ExecuteAiWithToolsInput): Promise<AgentChatCompletion> {
  const parsed = parseProviderId(input.provider)
  if (!parsed || !isLlmProviderId(parsed)) {
    throw new AIError('PROVIDER_ERROR', `未知の LLM Provider: ${input.provider}`)
  }
  if (parsed === 'gemini' || parsed === 'workers') {
    throwAgentUnsupported(parsed)
  }
  const adapter = getProvider(parsed)
  const credential = requireCredential(parsed)
  const model = input.model || adapter.availableModels()[0] || ''
  try {
    const result = await adapter.generateWithTools(
      {
        provider: parsed,
        model,
        messages: [],
        extraHeaders: input.extraHeaders ?? extraHeadersFor(credential),
        baseUrl: input.baseUrl || credential.baseUrl
      },
      credential,
      {
        messages: input.messages,
        tools: input.tools,
        toolChoice: input.toolChoice,
        timeoutMs: input.timeoutMs,
        signal: input.signal
      }
    )
    await recordUsage({
      provider: parsed,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      requestId: result.requestId,
      status: 'ok',
      sessionId: input.sessionId ?? null,
      billingMode: credential.billingMode,
      credentialId: credential.id,
      userId: credential.ownerType === 'user' ? 'local-user' : null
    })
    return result.completion
  } catch (error) {
    await recordUsage({
      provider: parsed,
      model,
      status: 'error',
      sessionId: input.sessionId ?? null,
      billingMode: credential.billingMode,
      credentialId: credential.id,
      userId: credential.ownerType === 'user' ? 'local-user' : null
    })
    if (error instanceof AIError) throw error
    throw new AIError('UNKNOWN', error instanceof Error ? error.message : String(error), {
      providerId: parsed
    })
  }
}
