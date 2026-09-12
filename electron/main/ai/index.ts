export type {
  AIChatMessage,
  AIRequest,
  AIResponse,
  AIUsage,
  BillingMode,
  Credential,
  LlmProviderId,
  ProviderId,
  ProviderKind,
  ResolveResult,
  RoutingMode
} from './types'
export { LLM_PROVIDER_IDS, PROVIDER_KIND, PROVIDER_NAMES, isLlmProviderId, parseProviderId } from './types'
export {
  AIError,
  classifyProviderError,
  isFailoverCandidate,
  isFailoverEligibleErrorCode,
  redactSecrets,
  throwAgentUnsupported
} from './errors'
export {
  DEFAULT_FAILOVER_ORDER,
  advanceFailoverContext,
  configureFailoverResolve,
  createFailoverContext,
  errorCodeFromUnknown,
  executeWithFailover,
  failoverReasonFromError,
  failoverUsageMetaFromContext,
  fallbacksForAgent,
  fallbacksForAsk,
  parseFailoverEnabled,
  parseFailoverMaxAttempts,
  normalizeMaxFailoverAttempts,
  ASK_FAILOVER_MAX_ATTEMPTS,
  AGENT_FAILOVER_MAX_ATTEMPTS,
  newFailoverId,
  logFailoverEvent,
  isFailoverEligibleError,
  resetFailoverResolveForTests,
  selectFallbackCredential,
  selectNextFallbackProvider,
  shouldFailover,
  type FailoverAttemptRecord,
  type FailoverConfig,
  type FailoverContext,
  type FailoverCredential,
  type FailoverCredentialResolve,
  type FailoverDecision,
  type FailoverReason,
  type FailoverResult,
  type FailoverUsageMeta
} from './failover'
import { resolveCredential } from './credentials'
import { configureFailoverResolve } from './failover'
import { isLlmProviderId } from './types'

/** Production wiring: Failover always goes through CredentialResolver. */
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
export {
  credentialStatus,
  loadDevelopmentCredential,
  requireCredential,
  resolveCredential,
  configureCredentialDeps,
  resetCredentialDepsForTests,
  hasUsableByokLlm,
  PROVIDER_ENV
} from './credentials'
export {
  ensureDefaultProviders,
  getProvider,
  listProviders,
  registerProvider,
  resetProviderRegistryForTests
} from './registry'
export { executeAi, executeAiWithTools } from './router'
export {
  recordUsage,
  listUsageEvents,
  listPersistedUsageEvents,
  billingModeForUi,
  credentialIdForUi,
  formatCredentialIdShort,
  failoverForUi,
  formatRouterFailoverLabel,
  countFailoverChains,
  groupUsageEventsByFailoverId,
  formatFailoverChainProviders,
  formatFailoverChainReasons,
  formatFailoverChainLabel,
  usageEventsToRecentRows,
  enrichRecentWithBillingMode,
  resetUsageForTests,
  type UsageEvent,
  type UsageRecentRow,
  type FailoverChainSummary
} from './usage'
export { estimateCostUsd } from './cost'
