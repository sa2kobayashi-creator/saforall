import { join } from 'path'
import { estimateCostUsd } from './cost'
import { newRequestId, type BillingMode, type ProviderId } from './types'
import {
  RAW_MAX_EVENTS,
  RAW_RETENTION_DAYS,
  pruneUsageEventsForRetention,
  reconcileDailyAggregateWithRaw,
  emptyUsageDailyAggregateFile,
  summarizeDailyAggregateRetained,
  type UsageDailyAggregateFile,
  type UsageEventProviderDailyRetained
} from './usageRetention'
export {
  RAW_MAX_EVENTS,
  RAW_RETENTION_DAYS,
  MAX_EVENTS,
  pruneUsageEventsForRetention,
  reconcileDailyAggregateWithRaw,
  applyUsageEventToDailyAggregate,
  summarizeDailyAggregateRetained,
  emptyUsageDailyAggregateFile,
  type UsageDailyAggregateRow,
  type UsageDailyAggregateFile,
  type UsageEventProviderDailyRetained
} from './usageRetention'
export {
  billingModeForUi,
  credentialIdForUi,
  formatCredentialIdShort,
  failoverForUi,
  formatRouterFailoverLabel,
  chainFailoverId,
  countFailoverChains,
  groupUsageEventsByFailoverId,
  formatFailoverChainProviders,
  formatFailoverChainReasons,
  formatFailoverChainLabel,
  analyzeFailoverChains,
  resolveFinalSuccessProvider,
  resolveFinalFailedProvider,
  analyzeUsageEventProviderStatus,
  analyzeUsageEventProviderDailyStatus,
  analyzeUsageEventCompleteness,
  analyzeUsageEventProviderHourlyStatus,
  analyzeUsageEventRolling,
  analyzeUsageEventProviderRolling,
  analyzeUsageEventProviderModelStatus,
  analyzeUsageEventUsageMetrics,
  ROLLING_WINDOW_1H_MS,
  ROLLING_WINDOW_24H_MS,
  usageEventsToRecentRows,
  enrichRecentWithBillingMode,
  type UsageRecentRow,
  type UsageFailoverUi,
  type FailoverChainHop,
  type FailoverChainSummary,
  type FailoverChainAnalysis,
  type FailoverChainFinalSuccessProviderCount,
  type FailoverChainFinalFailedProviderCount,
  type FailoverChainReasonTransition,
  type FailoverChainDailyBucket,
  type UsageEventProviderStatus,
  type UsageEventProviderDailyStatus,
  type UsageEventProviderDailyAnalysis,
  type UsageEventCompleteness,
  type UsageEventProviderHourlyStatus,
  type UsageEventProviderHourlyAnalysis,
  type UsageEventRollingProviderStatus,
  type UsageEventRollingWindow,
  type UsageEventProviderRolling,
  type UsageEventProviderModelStatus,
  type UsageEventProviderModelAnalysis,
  type UsageEventUsageMetricsProvider,
  type UsageEventUsageMetrics
} from './usageBillingUi'
import { analyzeUsageEventProviderDailyStatus } from './usageBillingUi'

export type UsageEventStatus = 'ok' | 'error'

/** Optional Phase 2-C-1+ failover trail (ids / providers only). Mirrors FailoverUsageMeta. */
export type UsageFailoverMeta = {
  primaryProvider: string
  fallbackProvider?: string | null
  reason?: string | null
  attempt?: number
  /** Phase 2-C-5: shared chain id (providers / ids only). */
  failoverId?: string | null
  /** Phase 2-C-5: providers that actually ran, in order. */
  path?: string[] | null
  /** Phase 2-C-5: ask vs agent. */
  mode?: 'ask' | 'agent' | null
}

export type UsageEvent = {
  requestId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  timestamp: string
  status: UsageEventStatus
  sessionId?: number | null
  billingMode?: BillingMode | null
  credentialId?: string | null
  userId?: string | null
  failover?: UsageFailoverMeta | null
}

type UsageFile = {
  events: UsageEvent[]
}

const memoryEvents: UsageEvent[] = []

function isoNow(): string {
  return new Date().toISOString()
}

function usageEventsPath(getLocalDbRoot: () => string): string {
  return join(getLocalDbRoot(), 'usage-events.json')
}

function usageDailyPath(getLocalDbRoot: () => string): string {
  return join(getLocalDbRoot(), 'usage-daily.json')
}

async function loadLocalDb() {
  const { ensureLocalDbReady, getLocalDbRoot, readJsonFile, writeJsonFile } = await import(
    '../localDb'
  )
  await ensureLocalDbReady()
  return { getLocalDbRoot, readJsonFile, writeJsonFile }
}

/**
 * Reconcile Daily Aggregate for UTC dates present in Raw; preserve older Aggregate rows.
 * processedRequestIds tracks Raw requestIds (bounded by Raw retention).
 */
async function syncDailyAggregateFromRaw(rawEvents: UsageEvent[]): Promise<void> {
  try {
    const { getLocalDbRoot, readJsonFile, writeJsonFile } = await loadLocalDb()
    const path = usageDailyPath(getLocalDbRoot)
    const existing = await readJsonFile<UsageDailyAggregateFile>(
      path,
      emptyUsageDailyAggregateFile()
    )
    const next = reconcileDailyAggregateWithRaw(existing, rawEvents, (events) =>
      analyzeUsageEventProviderDailyStatus(events as Parameters<
        typeof analyzeUsageEventProviderDailyStatus
      >[0])
    )
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      await writeJsonFile(path, next)
    }
  } catch {
    // localDb 未初期化（単体テスト）ではスキップ
  }
}

async function persist(event: UsageEvent, nowMs: number = Date.now()): Promise<void> {
  try {
    const { getLocalDbRoot, readJsonFile, writeJsonFile } = await loadLocalDb()
    const path = usageEventsPath(getLocalDbRoot)
    const file = await readJsonFile<UsageFile>(path, { events: [] })
    const merged = [...(file.events ?? []), event]
    const pruned = pruneUsageEventsForRetention(merged, nowMs, {
      days: RAW_RETENTION_DAYS,
      maxEvents: RAW_MAX_EVENTS
    })
    file.events = pruned
    await writeJsonFile(path, file)
    await syncDailyAggregateFromRaw(pruned)
  } catch {
    // localDb 未初期化（単体テスト）ではメモリのみ
  }
}

export async function recordUsage(input: {
  provider: ProviderId | string
  model: string
  inputTokens?: number
  outputTokens?: number
  status?: UsageEventStatus
  requestId?: string
  sessionId?: number | null
  estimatedCost?: number
  billingMode?: BillingMode | null
  credentialId?: string | null
  userId?: string | null
  failover?: UsageFailoverMeta | null
  /** Test-only clock; production omits (Date.now). */
  nowMs?: number
}): Promise<UsageEvent> {
  const inputTokens = Math.max(0, Number(input.inputTokens) || 0)
  const outputTokens = Math.max(0, Number(input.outputTokens) || 0)
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
  const event: UsageEvent = {
    requestId: input.requestId || newRequestId(),
    provider: String(input.provider),
    model: input.model || '',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost:
      input.estimatedCost ?? estimateCostUsd(String(input.provider), inputTokens, outputTokens),
    timestamp: Number.isFinite(input.nowMs)
      ? new Date(nowMs).toISOString()
      : isoNow(),
    status: input.status ?? 'ok',
    sessionId: input.sessionId ?? null,
    billingMode: input.billingMode ?? null,
    credentialId: input.credentialId ?? null,
    userId: input.userId ?? null,
    failover: input.failover ?? null
  }
  memoryEvents.push(event)
  const prunedMemory = pruneUsageEventsForRetention(memoryEvents, nowMs, {
    days: RAW_RETENTION_DAYS,
    maxEvents: RAW_MAX_EVENTS
  })
  memoryEvents.length = 0
  memoryEvents.push(...prunedMemory)
  await persist(event, nowMs)
  return event
}

export function listUsageEvents(): UsageEvent[] {
  return [...memoryEvents]
}

/** Disk + in-memory events, newest first. Safe for Usage UI (credentials excluded). */
export async function listPersistedUsageEvents(
  nowMs: number = Date.now()
): Promise<UsageEvent[]> {
  const byId = new Map<string, UsageEvent>()
  let diskChanged = false
  try {
    const { getLocalDbRoot, readJsonFile, writeJsonFile } = await loadLocalDb()
    const path = usageEventsPath(getLocalDbRoot)
    const file = await readJsonFile<UsageFile>(path, { events: [] })
    const rawList = Array.isArray(file.events) ? file.events : []
    const pruned = pruneUsageEventsForRetention(rawList, nowMs, {
      days: RAW_RETENTION_DAYS,
      maxEvents: RAW_MAX_EVENTS
    })
    if (pruned.length !== rawList.length) {
      file.events = pruned
      await writeJsonFile(path, file)
      diskChanged = true
    } else {
      // Detect reorder-equivalent identity set change (same length but pruned different ids)
      const before = new Set(
        rawList.map((e) => (e && typeof e.requestId === 'string' ? e.requestId : '')).filter(Boolean)
      )
      const after = new Set(
        pruned.map((e) => (e && typeof e.requestId === 'string' ? e.requestId : '')).filter(Boolean)
      )
      if (before.size !== after.size || Array.from(before).some((id) => !after.has(id))) {
        file.events = pruned
        await writeJsonFile(path, file)
        diskChanged = true
      }
    }
    for (const row of pruned) {
      if (row && typeof row.requestId === 'string') byId.set(row.requestId, row)
    }
    if (diskChanged) {
      await syncDailyAggregateFromRaw(pruned)
    } else {
      // Ensure Aggregate exists / Raw-window reconciled at least once on read.
      await syncDailyAggregateFromRaw(pruned)
    }
  } catch {
    // localDb 未初期化時はメモリのみ
  }
  for (const row of memoryEvents) {
    byId.set(row.requestId, row)
  }
  return Array.from(byId.values()).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

/** Read persisted Daily Aggregate (long-term facts). Does not mix Failover analysis. */
export async function listPersistedUsageDailyAggregate(): Promise<UsageEventProviderDailyRetained> {
  try {
    const { getLocalDbRoot, readJsonFile } = await loadLocalDb()
    const file = await readJsonFile<UsageDailyAggregateFile>(
      usageDailyPath(getLocalDbRoot),
      emptyUsageDailyAggregateFile()
    )
    return summarizeDailyAggregateRetained(file)
  } catch {
    return summarizeDailyAggregateRetained(emptyUsageDailyAggregateFile())
  }
}

export function resetUsageForTests(): void {
  memoryEvents.length = 0
}
