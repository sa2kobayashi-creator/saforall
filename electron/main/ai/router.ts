import { getLocalSetting } from '../settingsStore'
import { extraHeadersFor, resolveCredential } from './credentials'
import { AIError, throwAgentUnsupported } from './errors'
import {
  configureFailoverResolve,
  executeWithFailover,
  fallbacksForAgent,
  fallbacksForAsk,
  parseFailoverEnabled,
  parseFailoverMaxAttempts,
  ASK_FAILOVER_MAX_ATTEMPTS,
  AGENT_FAILOVER_MAX_ATTEMPTS,
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

function usageMetaFromAttempt(input: {
  context: FailoverContext
  attempt: number
  status: 'ok' | 'error'
  path: string[]
  reason: string | null
  chainActive: boolean
  mode: 'ask' | 'agent'
}): UsageFailoverMeta | null {
  const { context, attempt, path, reason, chainActive, mode, status } = input
  // Only emit Failover meta for real chains (switched or about to switch).
  // Normal success and single-shot failures stay without failoverId/meta.
  if (!chainActive && path.length <= 1) {
    return null
  }
  const fallbackProvider = path.length > 1 ? path[path.length - 1] : null
  return {
    primaryProvider: context.primaryProvider,
    fallbackProvider:
      fallbackProvider && fallbackProvider !== context.primaryProvider
        ? fallbackProvider
        : null,
    reason: (status === 'ok' ? 'success' : reason) as UsageFailoverMeta['reason'],
    attempt,
    failoverId: context.failoverId,
    path: path.length > 0 ? [...path] : null,
    mode
  }
}

function toAiError(error: unknown, providerId: string): AIError {
  if (error instanceof AIError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AIError('UNKNOWN', message, { providerId })
}

/** Phase 2-C-3: Settings `failover.enabled`; unset → OFF. */
function isRouterFailoverEnabled(): boolean {
  return parseFailoverEnabled(getLocalSetting('failover.enabled', ''))
}

/** Phase 2-C-4: Settings `failover.max_attempts`; unset → 1; Ask≤3 / Agent≤1. */
function routerMaxFailoverAttempts(kind: 'ask' | 'agent'): number {
  const maxAllowed = kind === 'agent' ? AGENT_FAILOVER_MAX_ATTEMPTS : ASK_FAILOVER_MAX_ATTEMPTS
  return parseFailoverMaxAttempts(getLocalSetting('failover.max_attempts', ''), maxAllowed)
}

/**
 * Phase 1 + 2-C-2 Router: provider select → Failover → adapter + per-attempt usage.
 * Phase 2-C-5: Usage recorded via onAttempt after reason is known (failoverId/path).
 */
export async function executeAi(request: AIRequest): Promise<AIResponse> {
  const primaryProvider = selectProvider(request)
  const started = Date.now()
  const sessionId = sessionIdFromMeta(request.metadata)
  const requestIdHint = request.metadata?.requestId
    ? String(request.metadata.requestId)
    : undefined

  let lastOkResponse: AIResponse | null = null
  let lastCredentialSource: string | undefined

  const result = await executeWithFailover(
    {
      enabled: isRouterFailoverEnabled(),
      primaryProvider,
      fallbackProviders: fallbacksForAsk(primaryProvider),
      maxFailoverAttempts: routerMaxFailoverAttempts('ask')
    },
    async ({ providerId, credential }) => {
      const adapter = getProvider(providerId)
      const model = request.model || adapter.availableModels()[0] || ''
      const cred = asCredential(credential)
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
      lastOkResponse = response
      lastCredentialSource = credential.source
      return response
    },
    {
      mode: 'ask',
      onAttempt: async ({
        providerId,
        credentialId,
        billingMode,
        attempt,
        context,
        status,
        path,
        reason,
        chainActive
      }) => {
        const model =
          status === 'ok' && lastOkResponse
            ? lastOkResponse.model
            : request.model || getProvider(providerId).availableModels()[0] || ''
        await recordUsage({
          provider: providerId,
          model,
          inputTokens: status === 'ok' && lastOkResponse ? lastOkResponse.usage.inputTokens : 0,
          outputTokens: status === 'ok' && lastOkResponse ? lastOkResponse.usage.outputTokens : 0,
          requestId:
            status === 'ok' && lastOkResponse
              ? lastOkResponse.requestId
              : requestIdHint,
          status,
          sessionId,
          billingMode: billingMode,
          credentialId: credentialId,
          userId: billingMode === 'BYOK' ? 'local-user' : null,
          failover: usageMetaFromAttempt({
            context,
            attempt,
            status,
            path,
            reason,
            chainActive,
            mode: 'ask'
          })
        })
      }
    }
  )

  if (result.ok && result.value) {
    const response = result.value
    return {
      ...response,
      metadata: {
        ...response.metadata,
        routingMode: request.routingMode ?? 'manual',
        elapsedMs: Date.now() - started,
        credentialSource: lastCredentialSource,
        failoverAttempt: result.context.attempt,
        primaryProvider: result.context.primaryProvider,
        failoverId: result.context.path.length > 1 ? result.context.failoverId : undefined
      }
    }
  }
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
 * Phase 2-C-5: Usage via onAttempt with failoverId/path/mode=agent.
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
  type ToolsOk = {
    model: string
    requestId: string
    usage: { inputTokens: number; outputTokens: number }
    completion: AgentChatCompletion
  }
  let lastOk: ToolsOk | null = null

  const result = await executeWithFailover(
    {
      enabled: isRouterFailoverEnabled(),
      primaryProvider,
      fallbackProviders: fallbacksForAgent(primaryProvider),
      maxFailoverAttempts: routerMaxFailoverAttempts('agent')
    },
    async ({ providerId, credential }) => {
      if (providerId === 'gemini' || providerId === 'workers') {
        throwAgentUnsupported(providerId)
      }
      const adapter = getProvider(providerId)
      const model = input.model || adapter.availableModels()[0] || ''
      const cred = asCredential(credential)
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
      lastOk = {
        model: generated.model,
        requestId: generated.requestId,
        usage: generated.usage,
        completion: generated.completion
      }
      return generated.completion
    },
    {
      mode: 'agent',
      onAttempt: async ({
        providerId,
        credentialId,
        billingMode,
        attempt,
        context,
        status,
        path,
        reason,
        chainActive
      }) => {
        const model =
          status === 'ok' && lastOk
            ? lastOk.model
            : input.model || getProvider(providerId).availableModels()[0] || ''
        await recordUsage({
          provider: providerId,
          model,
          inputTokens: status === 'ok' && lastOk ? lastOk.usage.inputTokens : 0,
          outputTokens: status === 'ok' && lastOk ? lastOk.usage.outputTokens : 0,
          requestId: status === 'ok' && lastOk ? lastOk.requestId : undefined,
          status,
          sessionId: input.sessionId ?? null,
          billingMode: billingMode,
          credentialId: credentialId,
          userId: billingMode === 'BYOK' ? 'local-user' : null,
          failover: usageMetaFromAttempt({
            context,
            attempt,
            status,
            path,
            reason,
            chainActive,
            mode: 'agent'
          })
        })
      }
    }
  )

  if (result.ok && result.value) return result.value
  throw toAiError(result.error, primaryProvider)
}
