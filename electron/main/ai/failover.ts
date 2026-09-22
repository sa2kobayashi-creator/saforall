/**
 * Phase 2-C-1 Failover foundation (leaf module — no local relative imports).
 * Ask/Agent/Router are not auto-wired yet.
 * Credential resolution is injected via configureFailoverResolve / config.resolve
 * so CredentialResolver stays the source of truth without secret plumbing here.
 */

export type LlmProviderId = 'openai' | 'gemini' | 'claude' | 'workers' | 'grok'

export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [
  'openai',
  'gemini',
  'claude',
  'workers',
  'grok'
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
  /** Providers that actually ran (credential present). Never secrets. */
  path: LlmProviderId[]
  attempts: FailoverAttemptRecord[]
  lastReason: FailoverReason | null
  /** Chain id for this executeWithFailover invocation. */
  failoverId: string
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

/** Optional UsageEvent extension (backward compatible). Phase 2-C-5 adds id/path/mode. */
export type FailoverUsageMeta = {
  primaryProvider: LlmProviderId
  fallbackProvider?: LlmProviderId | null
  reason?: FailoverReason | null
  attempt?: number
  failoverId?: string | null
  path?: LlmProviderId[] | null
  mode?: 'ask' | 'agent' | null
}

export type FailoverAttemptHook = (input: {
  providerId: LlmProviderId
  credentialId: string
  billingMode: BillingMode
  attempt: number
  /** Context has no secrets (providers / ids / reasons only). */
  context: FailoverContext
  status: 'ok' | 'error'
  errorCode?: FailoverErrorCode | null
  /** Snapshot path of providers that have actually run (includes this attempt). */
  path: LlmProviderId[]
  reason: FailoverReason | null
  /** True when this attempt belongs to (or starts) a real Failover Chain. */
  chainActive: boolean
}) => void | Promise<void>

export type FailoverRunHooks = {
  mode?: 'ask' | 'agent'
  onAttempt?: FailoverAttemptHook
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
      // Phase 2-C-3: credit/quota is owned by api.ts autoRuntimeFallbackEngines.
      return null
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
    path: [],
    attempts: [],
    lastReason: null,
    failoverId: newFailoverId()
  }
}

/** Phase 2-C-5: chain id (never a secret). */
export function newFailoverId(): string {
  return `fo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

const FAILOVER_LOG_KEYS = new Set([
  'failoverId',
  'primary',
  'provider',
  'from',
  'to',
  'attempt',
  'reason',
  'path',
  'mode'
])

/** Structured Failover log — allowlisted fields only (no secrets / raw errors). */
export function logFailoverEvent(
  event: 'start' | 'switch' | 'success' | 'exhausted' | 'attempt_error',
  fields: Record<string, string | number | null | undefined>
): void {
  const safe: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!FAILOVER_LOG_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string' || typeof value === 'number') safe[key] = value
  }
  try {
    console.info(`[AI Failover] ${event}`, safe)
  } catch {
    // ignore logging failures
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

  const maxSwitches = normalizeMaxFailoverAttempts(config.maxFailoverAttempts ?? 1)
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
  const path =
    context.path.length > 0 ? context.path : context.visitedProviders.slice(0, 1)
  const fallbackProvider =
    path.length > 1 ? path[path.length - 1] : null
  return {
    primaryProvider: context.primaryProvider,
    fallbackProvider:
      fallbackProvider && fallbackProvider !== context.primaryProvider
        ? fallbackProvider
        : null,
    reason: context.lastReason,
    attempt: context.attempt,
    failoverId: context.failoverId,
    path: [...path]
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

/** Ask: switches ≤ providerCount - 1. Agent: openai/claude only → max 1. */
export const ASK_FAILOVER_MAX_ATTEMPTS = LLM_PROVIDER_IDS.length - 1
export const AGENT_FAILOVER_MAX_ATTEMPTS = 1

/**
 * Clamp switch count to [1, maxAllowed] (and never above providerCount - 1).
 * Non-finite or less than 1 → 1 (when ceiling ≥ 1).
 */
export function normalizeMaxFailoverAttempts(
  raw: number | null | undefined,
  maxAllowed: number = ASK_FAILOVER_MAX_ATTEMPTS
): number {
  const ceiling = Math.max(
    1,
    Math.min(ASK_FAILOVER_MAX_ATTEMPTS, Math.floor(Number(maxAllowed)) || ASK_FAILOVER_MAX_ATTEMPTS)
  )
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return 1
  const n = Math.floor(Number(raw))
  if (n < 1) return 1
  return Math.min(n, ceiling)
}

/**
 * Phase 2-C-4: Settings `failover.max_attempts`.
 * Unset / empty / invalid → 1. Clamped to maxAllowed (Ask≤3, Agent≤1).
 */
export function parseFailoverMaxAttempts(
  raw: string | number | null | undefined,
  maxAllowed: number = ASK_FAILOVER_MAX_ATTEMPTS
): number {
  if (raw === null || raw === undefined) return normalizeMaxFailoverAttempts(1, maxAllowed)
  if (typeof raw === 'number') return normalizeMaxFailoverAttempts(raw, maxAllowed)
  const trimmed = String(raw).trim()
  if (!trimmed) return normalizeMaxFailoverAttempts(1, maxAllowed)
  return normalizeMaxFailoverAttempts(Number(trimmed), maxAllowed)
}

/**
 * Phase 2-C-3: Settings `failover.enabled`.
 * Unset / empty / unknown → false (OFF). Only explicit true/1/yes/on enables.
 */
export function parseFailoverEnabled(raw: string | null | undefined): boolean {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

export async function executeWithFailover<T>(
  config: FailoverConfig,
  run: (input: {
    providerId: LlmProviderId
    credential: FailoverCredential
    attempt: number
    context: FailoverContext
  }) => Promise<T>,
  hooks?: FailoverRunHooks
): Promise<FailoverResult<T>> {
  const resolve = activeResolve(config)
  let context = createFailoverContext(config)
  let lastError: unknown = null
  const maxSwitches = normalizeMaxFailoverAttempts(config.maxFailoverAttempts ?? 1)
  const hardCap = Math.min(LLM_PROVIDER_IDS.length, 1 + maxSwitches)
  let chainStarted = false

  logFailoverEvent('start', {
    failoverId: context.failoverId,
    primary: context.primaryProvider,
    mode: hooks?.mode ?? null
  })

  for (let guard = 0; guard < hardCap; guard += 1) {
    const resolved = resolve({
      providerId: context.currentProvider,
      userId: config.userId ?? null
    })
    if (!resolved.credential) {
      // Credential missing: skip execution (not in path), try next.
      lastError = Object.assign(new Error(`${context.currentProvider} の Credential がありません`), {
        code: 'AUTH_ERROR' as const
      })
      const decision = shouldFailover(lastError, context, config)
      const fromProvider = context.currentProvider
      context = advanceFailoverContext(context, decision, {
        credentialId: null,
        billingMode: resolved.billingMode,
        errorCode: 'AUTH_ERROR'
      })
      if (!decision.shouldFailover || !decision.nextProvider) {
        logFailoverEvent('exhausted', {
          failoverId: context.failoverId,
          attempt: context.attempt,
          reason: decision.reason,
          path: context.path.join('→') || null
        })
        return {
          ok: false,
          error: lastError,
          context,
          providerId: null,
          credentialId: null,
          billingMode: null
        }
      }
      chainStarted = true
      logFailoverEvent('switch', {
        failoverId: context.failoverId,
        attempt: context.attempt,
        from: fromProvider,
        to: decision.nextProvider,
        reason: decision.reason
      })
      continue
    }

    const credential = resolved.credential
    const credentialId = credential.id
    const billingMode = credential.billingMode
    const attemptNumber = context.attempt
    const providerId = context.currentProvider
    const pathAfterRun = context.path.includes(providerId)
      ? [...context.path]
      : [...context.path, providerId]
    context = { ...context, path: pathAfterRun }

    try {
      const value = await run({
        providerId,
        credential,
        attempt: attemptNumber,
        context
      })
      context = { ...context, lastReason: 'success' }
      const chainActive = chainStarted || pathAfterRun.length > 1
      if (hooks?.onAttempt) {
        await hooks.onAttempt({
          providerId,
          credentialId,
          billingMode,
          attempt: attemptNumber,
          context,
          status: 'ok',
          path: pathAfterRun,
          reason: 'success',
          chainActive
        })
      }
      logFailoverEvent('success', {
        failoverId: context.failoverId,
        attempt: attemptNumber,
        provider: providerId,
        path: pathAfterRun.join('→'),
        mode: hooks?.mode ?? null
      })
      return {
        ok: true,
        value,
        context,
        providerId,
        credentialId,
        billingMode
      }
    } catch (error) {
      lastError = error
      const decision = shouldFailover(error, context, config)
      const errorCode = errorCodeFromUnknown(error)
      const failureReason =
        failoverReasonFromError(error) ??
        (decision.reason !== 'disabled' && decision.reason !== 'not_eligible'
          ? decision.reason
          : 'not_eligible')
      // Record Usage AFTER reason is known; BEFORE advancing attempt/provider.
      // chainActive only when we already switched or will switch now.
      const chainActive =
        chainStarted || pathAfterRun.length > 1 || Boolean(decision.shouldFailover)
      context = { ...context, lastReason: failureReason }
      if (hooks?.onAttempt) {
        await hooks.onAttempt({
          providerId,
          credentialId,
          billingMode,
          attempt: attemptNumber,
          context,
          status: 'error',
          errorCode,
          path: pathAfterRun,
          reason: failureReason,
          chainActive
        })
      }
      logFailoverEvent('attempt_error', {
        failoverId: context.failoverId,
        attempt: attemptNumber,
        provider: providerId,
        reason: failureReason,
        path: pathAfterRun.join('→')
      })

      const fromProvider = providerId
      context = advanceFailoverContext(context, decision, {
        credentialId,
        billingMode,
        errorCode
      })
      if (!decision.shouldFailover || !decision.nextProvider) {
        logFailoverEvent('exhausted', {
          failoverId: context.failoverId,
          attempt: attemptNumber,
          reason: decision.reason,
          path: pathAfterRun.join('→')
        })
        return {
          ok: false,
          error,
          context,
          providerId: null,
          credentialId,
          billingMode
        }
      }
      chainStarted = true
      logFailoverEvent('switch', {
        failoverId: context.failoverId,
        attempt: context.attempt,
        from: fromProvider,
        to: decision.nextProvider,
        reason: decision.reason
      })
    }
  }

  logFailoverEvent('exhausted', {
    failoverId: context.failoverId,
    attempt: context.attempt,
    path: context.path.join('→') || null
  })
  return {
    ok: false,
    error: lastError ?? Object.assign(new Error('Failover exhausted'), { code: 'UNKNOWN' as const }),
    context: { ...context, lastReason: context.lastReason ?? 'exhausted' },
    providerId: null,
    credentialId: null,
    billingMode: null
  }
}
