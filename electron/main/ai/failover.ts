/**
 * Phase 2-C-1 Failover foundation (leaf module — no local relative imports).
 * Ask/Agent/Router are not auto-wired yet.
 * Credential resolution is injected via configureFailoverResolve / config.resolve
 * so CredentialResolver stays the source of truth without secret plumbing here.
 */

export type LlmProviderId = 'openai' | 'gemini' | 'claude' | 'workers'

export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [
  'openai',
  'gemini',
  'claude',
  'workers'
]

export const DEFAULT_FAILOVER_ORDER: readonly LlmProviderId[] = [
  'openai',
  'claude',
  'gemini',
  'workers'
]

export type BillingMode = 'DEVELOPMENT' | 'BYOK' | 'ORGANIZATION' | 'MANAGED'

export type FailoverReason =
  | 'auth_error'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'network_error'
  | 'timeout'
  | 'insufficient_credit'
  | 'disabled'
  | 'not_eligible'
  | 'no_fallback'
  | 'already_visited'
  | 'max_attempts'
  | 'success'
  | 'exhausted'

export type FailoverErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'MODEL_NOT_FOUND'
  | 'INSUFFICIENT_CREDIT'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'AGENT_UNSUPPORTED'
  | 'UNKNOWN'

/** Minimal credential surface used by Failover (secret stays on this object only). */
export type FailoverCredential = {
  id: string
  providerId: LlmProviderId
  billingMode: BillingMode
  secret: string
  ownerType?: string
  source?: string
  baseUrl?: string
  extra?: Record<string, string>
}

/** Must wrap CredentialResolver — never accept raw API keys here. */
export type FailoverCredentialResolve = (input: {
  providerId: LlmProviderId
  userId?: string | null
}) => {
  credential: FailoverCredential | null
  available: boolean
  billingMode: BillingMode
  reason: string
}

export type FailoverConfig = {
  enabled: boolean
  primaryProvider: LlmProviderId
  fallbackProviders?: LlmProviderId[]
  maxFailoverAttempts?: number
  userId?: string | null
  resolve?: FailoverCredentialResolve
}

export type FailoverAttemptRecord = {
  attempt: number
  providerId: LlmProviderId
  credentialId: string | null
  billingMode: BillingMode | null
  errorCode?: FailoverErrorCode | null
  reason?: FailoverReason | null
}

export type FailoverContext = {
  enabled: boolean
  primaryProvider: LlmProviderId
  currentProvider: LlmProviderId
  attempt: number
  visitedProviders: LlmProviderId[]
  attempts: FailoverAttemptRecord[]
  lastReason: FailoverReason | null
}

export type FailoverDecision = {
  shouldFailover: boolean
  reason: FailoverReason
  nextProvider: LlmProviderId | null
}

export type FailoverResult<T> = {
  ok: boolean
  value?: T
  error?: unknown
  context: FailoverContext
  providerId: LlmProviderId | null
  credentialId: string | null
  billingMode: BillingMode | null
}

/** Optional UsageEvent extension (backward compatible). */
export type FailoverUsageMeta = {
  primaryProvider: LlmProviderId
  fallbackProvider?: LlmProviderId | null
  reason?: FailoverReason | null
  attempt?: number
}

let defaultResolve: FailoverCredentialResolve | null = null

export function configureFailoverResolve(fn: FailoverCredentialResolve | null): void {
  defaultResolve = fn
}

export function resetFailoverResolveForTests(): void {
  defaultResolve = null
}

function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value)
}

function activeResolve(config: FailoverConfig): FailoverCredentialResolve {
  if (config.resolve) return config.resolve
  if (defaultResolve) return defaultResolve
  const error = new Error(
    'Failover Credential resolve が未配線です。CredentialResolver 経由で configureFailoverResolve してください。'
  ) as Error & { code: FailoverErrorCode }
  error.code = 'PROVIDER_ERROR'
  throw error
}

export function errorCodeFromUnknown(error: unknown): FailoverErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code)
    if (
      code === 'AUTH_ERROR' ||
      code === 'RATE_LIMIT' ||
      code === 'MODEL_NOT_FOUND' ||
      code === 'INSUFFICIENT_CREDIT' ||
      code === 'TIMEOUT' ||
      code === 'PROVIDER_ERROR' ||
      code === 'NETWORK_ERROR' ||
      code === 'AGENT_UNSUPPORTED' ||
      code === 'UNKNOWN'
    ) {
      return code
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()
  if (/HTTP\s+401|HTTP\s+403|invalid api key|unauthorized/i.test(message)) return 'AUTH_ERROR'
  if (/HTTP\s+429|rate limit/i.test(message)) return 'RATE_LIMIT'
  if (/HTTP\s+408|timeout|timed out/i.test(message)) return 'TIMEOUT'
  if (/fetch failed|network|econnrefused/i.test(lower)) return 'NETWORK_ERROR'
  if (/HTTP\s+5\d\d/.test(message)) return 'PROVIDER_ERROR'
  return 'UNKNOWN'
}

export function failoverReasonFromError(error: unknown): FailoverReason | null {
  const code = errorCodeFromUnknown(error)
  switch (code) {
    case 'AUTH_ERROR':
      return 'auth_error'
    case 'RATE_LIMIT':
      return 'rate_limit'
    case 'PROVIDER_ERROR':
      return 'provider_unavailable'
    case 'NETWORK_ERROR':
      return 'network_error'
    case 'TIMEOUT':
      return 'timeout'
    case 'INSUFFICIENT_CREDIT':
      return 'insufficient_credit'
    default:
      return null
  }
}

export function isFailoverEligibleError(error: unknown): boolean {
  return failoverReasonFromError(error) !== null
}

export function createFailoverContext(config: FailoverConfig): FailoverContext {
  const primary = config.primaryProvider
  if (!isLlmProviderId(primary)) {
    const error = new Error(`Failover primary が不正です: ${String(primary)}`) as Error & {
      code: FailoverErrorCode
    }
    error.code = 'PROVIDER_ERROR'
    throw error
  }
  return {
    enabled: Boolean(config.enabled),
    primaryProvider: primary,
    currentProvider: primary,
    attempt: 1,
    visitedProviders: [primary],
    attempts: [],
    lastReason: null
  }
}

function fallbackCandidates(config: FailoverConfig): LlmProviderId[] {
  const listed = (config.fallbackProviders ?? []).filter(isLlmProviderId)
  if (listed.length > 0) return listed
  return DEFAULT_FAILOVER_ORDER.filter((id) => id !== config.primaryProvider)
}

function failoversUsed(context: FailoverContext): number {
  return Math.max(0, context.visitedProviders.length - 1)
}

export function selectNextFallbackProvider(
  context: FailoverContext,
  config: FailoverConfig
): LlmProviderId | null {
  const resolve = activeResolve(config)
  const visited = new Set(context.visitedProviders)
  for (const id of fallbackCandidates(config)) {
    if (visited.has(id)) continue
    if (id === context.currentProvider) continue
    const resolved = resolve({
      providerId: id,
      userId: config.userId ?? null
    })
    if (resolved.available && resolved.credential) return id
  }
  return null
}

export function selectFallbackCredential(
  context: FailoverContext,
  config: FailoverConfig
): {
  providerId: LlmProviderId
  credential: FailoverCredential
  billingMode: BillingMode
  resolveReason: string
} | null {
  const providerId = selectNextFallbackProvider(context, config)
  if (!providerId) return null
  const resolved = activeResolve(config)({
    providerId,
    userId: config.userId ?? null
  })
  if (!resolved.credential) return null
  return {
    providerId,
    credential: resolved.credential,
    billingMode: resolved.billingMode,
    resolveReason: resolved.reason
  }
}

export function shouldFailover(
  error: unknown,
  context: FailoverContext,
  config: FailoverConfig
): FailoverDecision {
  if (!config.enabled || !context.enabled) {
    return { shouldFailover: false, reason: 'disabled', nextProvider: null }
  }

  const eligibleReason = failoverReasonFromError(error)
  if (!eligibleReason) {
    return { shouldFailover: false, reason: 'not_eligible', nextProvider: null }
  }

  const maxSwitches = Math.max(0, config.maxFailoverAttempts ?? 1)
  if (failoversUsed(context) >= maxSwitches) {
    return { shouldFailover: false, reason: 'max_attempts', nextProvider: null }
  }

  if (context.visitedProviders.length >= LLM_PROVIDER_IDS.length) {
    return { shouldFailover: false, reason: 'exhausted', nextProvider: null }
  }

  let nextProvider: LlmProviderId | null = null
  try {
    nextProvider = selectNextFallbackProvider(context, config)
  } catch {
    nextProvider = null
  }
  if (!nextProvider) {
    return { shouldFailover: false, reason: 'no_fallback', nextProvider: null }
  }
  if (context.visitedProviders.includes(nextProvider)) {
    return { shouldFailover: false, reason: 'already_visited', nextProvider: null }
  }

  return { shouldFailover: true, reason: eligibleReason, nextProvider }
}

export function advanceFailoverContext(
  context: FailoverContext,
  decision: FailoverDecision,
  failed: {
    credentialId: string | null
    billingMode: BillingMode | null
    errorCode?: FailoverErrorCode | null
  }
): FailoverContext {
  const attemptRecord: FailoverAttemptRecord = {
    attempt: context.attempt,
    providerId: context.currentProvider,
    credentialId: failed.credentialId,
    billingMode: failed.billingMode,
    errorCode: failed.errorCode ?? null,
    reason: decision.reason
  }
  if (!decision.shouldFailover || !decision.nextProvider) {
    return {
      ...context,
      attempts: [...context.attempts, attemptRecord],
      lastReason: decision.reason
    }
  }
  return {
    ...context,
    currentProvider: decision.nextProvider,
    attempt: context.attempt + 1,
    visitedProviders: [...context.visitedProviders, decision.nextProvider],
    attempts: [...context.attempts, attemptRecord],
    lastReason: decision.reason
  }
}

export function failoverUsageMetaFromContext(context: FailoverContext): FailoverUsageMeta {
  const fallbackProvider =
    context.visitedProviders.length > 1
      ? context.visitedProviders[context.visitedProviders.length - 1]
      : null
  return {
    primaryProvider: context.primaryProvider,
    fallbackProvider:
      fallbackProvider && fallbackProvider !== context.primaryProvider
        ? fallbackProvider
        : null,
    reason: context.lastReason,
    attempt: context.attempt
  }
}

/** Ask / executeAi fallback order (all LLM providers except primary). */
export function fallbacksForAsk(primary: LlmProviderId): LlmProviderId[] {
  return DEFAULT_FAILOVER_ORDER.filter((id) => id !== primary)
}

/** Agent / executeAiWithTools — openai & claude only (tools support). */
export function fallbacksForAgent(primary: LlmProviderId): LlmProviderId[] {
  const agentOrder: LlmProviderId[] = ['openai', 'claude']
  return agentOrder.filter((id) => id !== primary)
}

export async function executeWithFailover<T>(
  config: FailoverConfig,
  run: (input: {
    providerId: LlmProviderId
    credential: FailoverCredential
    attempt: number
    context: FailoverContext
  }) => Promise<T>
): Promise<FailoverResult<T>> {
  const resolve = activeResolve(config)
  let context = createFailoverContext(config)
  let lastError: unknown = null
  const hardCap = Math.min(
    LLM_PROVIDER_IDS.length,
    1 + Math.max(0, config.maxFailoverAttempts ?? 1)
  )

  for (let guard = 0; guard < hardCap; guard += 1) {
    const resolved = resolve({
      providerId: context.currentProvider,
      userId: config.userId ?? null
    })
    if (!resolved.credential) {
      lastError = Object.assign(new Error(`${context.currentProvider} の Credential がありません`), {
        code: 'AUTH_ERROR' as const
      })
      const decision = shouldFailover(lastError, context, config)
      context = advanceFailoverContext(context, decision, {
        credentialId: null,
        billingMode: resolved.billingMode,
        errorCode: 'AUTH_ERROR'
      })
      if (!decision.shouldFailover || !decision.nextProvider) {
        return {
          ok: false,
          error: lastError,
          context,
          providerId: null,
          credentialId: null,
          billingMode: null
        }
      }
      continue
    }

    const credential = resolved.credential
    const credentialId = credential.id
    const billingMode = credential.billingMode
    try {
      const value = await run({
        providerId: context.currentProvider,
        credential,
        attempt: context.attempt,
        context
      })
      context = { ...context, lastReason: 'success' }
      return {
        ok: true,
        value,
        context,
        providerId: context.currentProvider,
        credentialId,
        billingMode
      }
    } catch (error) {
      lastError = error
      const decision = shouldFailover(error, context, config)
      context = advanceFailoverContext(context, decision, {
        credentialId,
        billingMode,
        errorCode: errorCodeFromUnknown(error)
      })
      if (!decision.shouldFailover || !decision.nextProvider) {
        return {
          ok: false,
          error,
          context,
          providerId: null,
          credentialId,
          billingMode
        }
      }
    }
  }

  return {
    ok: false,
    error: lastError ?? Object.assign(new Error('Failover exhausted'), { code: 'UNKNOWN' as const }),
    context: { ...context, lastReason: context.lastReason ?? 'exhausted' },
    providerId: null,
    credentialId: null,
    billingMode: null
  }
}
