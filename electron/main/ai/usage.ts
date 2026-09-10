import { join } from 'path'
import { estimateCostUsd } from './cost'
import { newRequestId, type BillingMode, type ProviderId } from './types'
export {
  billingModeForUi,
  credentialIdForUi,
  formatCredentialIdShort,
  usageEventsToRecentRows,
  enrichRecentWithBillingMode,
  type UsageRecentRow
} from './usageBillingUi'

export type UsageEventStatus = 'ok' | 'error'

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
}

type UsageFile = {
  events: UsageEvent[]
}

const MAX_EVENTS = 500
const memoryEvents: UsageEvent[] = []

function isoNow(): string {
  return new Date().toISOString()
}

async function persist(event: UsageEvent): Promise<void> {
  try {
    const { ensureLocalDbReady, getLocalDbRoot, readJsonFile, writeJsonFile } = await import(
      '../localDb'
    )
    await ensureLocalDbReady()
    const path = join(getLocalDbRoot(), 'usage-events.json')
    const file = await readJsonFile<UsageFile>(path, { events: [] })
    file.events = [...file.events, event].slice(-MAX_EVENTS)
    await writeJsonFile(path, file)
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
}): Promise<UsageEvent> {
  const inputTokens = Math.max(0, Number(input.inputTokens) || 0)
  const outputTokens = Math.max(0, Number(input.outputTokens) || 0)
  const event: UsageEvent = {
    requestId: input.requestId || newRequestId(),
    provider: String(input.provider),
    model: input.model || '',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost:
      input.estimatedCost ?? estimateCostUsd(String(input.provider), inputTokens, outputTokens),
    timestamp: isoNow(),
    status: input.status ?? 'ok',
    sessionId: input.sessionId ?? null,
    billingMode: input.billingMode ?? null,
    credentialId: input.credentialId ?? null,
    userId: input.userId ?? null
  }
  memoryEvents.push(event)
  if (memoryEvents.length > MAX_EVENTS) memoryEvents.shift()
  await persist(event)
  return event
}

export function listUsageEvents(): UsageEvent[] {
  return [...memoryEvents]
}

/** Disk + in-memory events, newest first. Safe for Usage UI (credentials excluded). */
export async function listPersistedUsageEvents(): Promise<UsageEvent[]> {
  const byId = new Map<string, UsageEvent>()
  try {
    const { ensureLocalDbReady, getLocalDbRoot, readJsonFile } = await import('../localDb')
    await ensureLocalDbReady()
    const path = join(getLocalDbRoot(), 'usage-events.json')
    const file = await readJsonFile<UsageFile>(path, { events: [] })
    for (const row of file.events ?? []) {
      if (row && typeof row.requestId === 'string') byId.set(row.requestId, row)
    }
  } catch {
    // localDb 未初期化時はメモリのみ
  }
  for (const row of memoryEvents) {
    byId.set(row.requestId, row)
  }
  return Array.from(byId.values()).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

export function resetUsageForTests(): void {
  memoryEvents.length = 0
}
