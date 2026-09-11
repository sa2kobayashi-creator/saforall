import { extraHeadersFor, resolveCredential } from './credentials'
import { AIError, throwAgentUnsupported } from './errors'
import {
  configureFailoverResolve,
  executeWithFailover,
  fallbacksForAgent,
  fallbacksForAsk,
  failoverUsageMetaFromContext,
  type FailoverCredential,
  type FailoverContext
} from './failover'
import { getProvider } from './registry'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolSpec } from './toolTypes'
import {
  isLlmProviderId,
  parseProviderId,
  type AIRequest,
  type AIResponse,
  type Credential,
  type LlmProviderId,
  type RoutingMode
} from './types'
import { recordUsage, type UsageFailoverMeta } from './usage'

const LLM_AUTO_ORDER: LlmProviderId[] = ['openai', 'claude', 'gemini', 'workers']

/** Ensure Failover uses CredentialResolver even when router is imported without ai/index. */
configureFailoverResolve((input) => {
  if (!isLlmProviderId(input.providerId)) {
    return {
      credential: null,
      available: false,
      billingMode: 'DEVELOPMENT',
      reason: 'unsupported provider'
    }
  }
  const resolved = resolveCredential({
    providerId: input.providerId,
    userId: input.userId ?? null
  })
  if (!resolved.credential || !isLlmProviderId(resolved.credential.providerId)) {
    return {
      credential: null,
      available: false,
      billingMode: resolved.billingMode,
      reason: resolved.reason
    }
  }
  return {
    credential: {
      id: resolved.credential.id,
      providerId: resolved.credential.providerId,
      billingMode: resolved.credential.billingMode,
      secret: resolved.credential.secret,
      ownerType: resolved.credential.ownerType,
      source: resolved.credential.source,
      baseUrl: resolved.credential.baseUrl,
      extra: resolved.credential.extra
    },
    available: resolved.available,
    billingMode: resolved.billingMode,
    reason: resolved.reason
  }
})

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

function asCredential(credential: FailoverCredential): Credential {
  return {
    id: credential.id,
    providerId: credential.providerId,
    ownerType:
      credential.ownerType === 'user' ||
      credential.ownerType === 'organization' ||
      credential.ownerType === 'platform'
        ? credential.ownerType
        : 'development',
    billingMode: credential.billingMode,
    source:
      credential.source === 'settings' ||
      credential.source === 'env' ||
      credential.source === 'byok'
        ? credential.source
        : '',
    secret: credential.secret,
    baseUrl: credential.baseUrl || '',
    extra: credential.extra ?? {}
  }
}

function userIdFor(credential: FailoverCredential): string | null {
  return credential.ownerType === 'user' ? 'local-user' : null
}

function usageMetaForAttempt(
  context: FailoverContext,
  attempt: number,
  status: 'ok' | 'error'
): UsageFailoverMeta | null {
  if (attempt <= 1 && status === 'ok' && context.visitedProviders.length <= 1) {
    return null
  }
  const meta = failoverUsageMetaFromContext({
    ...context,
    attempt,
    lastReason: status === 'ok' ? 'success' : context.lastReason
  })
  return {
    primaryProvider: meta.primaryProvider,
    fallbackProvider: meta.fallbackProvider ?? null,
    reason: meta.reason,
    attempt
  }
}

function toAiError(error: unknown, providerId: string): AIError {
  if (error instanceof AIError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AIError('UNKNOWN', message, { providerId })
}

/**
 * Phase 1 + 2-C-2 Router: provider select → Failover → adapter + per-attempt usage.
 * Adapter generate runs inside executeWithFailover (not wrapping the whole function).
 */
export async function executeAi(request: AIRequest): Promise<AIResponse> {
  const primaryProvider = selectProvider(request)
  const started = Date.now()
  const sessionId = sessionIdFromMeta(request.metadata)
  const requestIdHint = request.metadata?.requestId
    ? String(request.metadata.requestId)
    : undefined

  const result = await executeWithFailover(
    {
      enabled: true,
      primaryProvider,
      fallbackProviders: fallbacksForAsk(primaryProvider),
      maxFailoverAttempts: 1
    },
    async ({ providerId, credential, attempt, context }) => {
      const adapter = getProvider(providerId)
      const model = request.model || adapter.availableModels()[0] || ''
      const cred = asCredential(credential)
      try {
        const response = await adapter.generate(
          {
            ...request,
            provider: providerId,
            model,
            extraHeaders: request.extraHeaders ?? extraHeadersFor(cred),
            baseUrl: request.baseUrl || cred.baseUrl
          },
          cred
        )
        await recordUsage({
          provider: providerId,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          requestId: response.requestId,
          status: 'ok',
          sessionId,
          billingMode: credential.billingMode,
          credentialId: credential.id,
          userId: userIdFor(credential),
          failover: usageMetaForAttempt(context, attempt, 'ok')
        })
        return {
          ...response,
          metadata: {
            ...response.metadata,
            routingMode: request.routingMode ?? 'manual',
            elapsedMs: Date.now() - started,
            credentialSource: credential.source,
            failoverAttempt: attempt,
            primaryProvider: context.primaryProvider
          }
        }
      } catch (error) {
        await recordUsage({
          provider: providerId,
          model,
          status: 'error',
          requestId: requestIdHint,
          sessionId,
          billingMode: credential.billingMode,
          credentialId: credential.id,
          userId: userIdFor(credential),
          failover: usageMetaForAttempt(context, attempt, 'error')
        })
        throw error
      }
    }
  )

  if (result.ok && result.value) return result.value
  throw toAiError(result.error, primaryProvider)
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
 * Agent tool_use path with Phase 2-C-2 Failover (openai/claude fallbacks only).
 */
export async function executeAiWithTools(
  input: ExecuteAiWithToolsInput
): Promise<AgentChatCompletion> {
  const parsed = parseProviderId(input.provider)
  if (!parsed || !isLlmProviderId(parsed)) {
    throw new AIError('PROVIDER_ERROR', `未知の LLM Provider: ${input.provider}`)
  }
  if (parsed === 'gemini' || parsed === 'workers') {
    throwAgentUnsupported(parsed)
  }

  const primaryProvider = parsed
  const result = await executeWithFailover(
    {
      enabled: true,
      primaryProvider,
      fallbackProviders: fallbacksForAgent(primaryProvider),
      maxFailoverAttempts: 1
    },
    async ({ providerId, credential, attempt, context }) => {
      if (providerId === 'gemini' || providerId === 'workers') {
        throwAgentUnsupported(providerId)
      }
      const adapter = getProvider(providerId)
      const model = input.model || adapter.availableModels()[0] || ''
      const cred = asCredential(credential)
      try {
        const generated = await adapter.generateWithTools(
          {
            provider: providerId,
            model,
            messages: [],
            extraHeaders: input.extraHeaders ?? extraHeadersFor(cred),
            baseUrl: input.baseUrl || cred.baseUrl
          },
          cred,
          {
            messages: input.messages,
            tools: input.tools,
            toolChoice: input.toolChoice,
            timeoutMs: input.timeoutMs,
            signal: input.signal
          }
        )
        await recordUsage({
          provider: providerId,
          model: generated.model,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          requestId: generated.requestId,
          status: 'ok',
          sessionId: input.sessionId ?? null,
          billingMode: credential.billingMode,
          credentialId: credential.id,
          userId: userIdFor(credential),
          failover: usageMetaForAttempt(context, attempt, 'ok')
        })
        return generated.completion
      } catch (error) {
        await recordUsage({
          provider: providerId,
          model,
          status: 'error',
          sessionId: input.sessionId ?? null,
          billingMode: credential.billingMode,
          credentialId: credential.id,
          userId: userIdFor(credential),
          failover: usageMetaForAttempt(context, attempt, 'error')
        })
        throw error
      }
    }
  )

  if (result.ok && result.value) return result.value
  throw toAiError(result.error, primaryProvider)
}
