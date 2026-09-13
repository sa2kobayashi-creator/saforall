/**
 * Phase 12-B: Raw retention prune + Daily Aggregate helpers (facts only).
 * All UsageEvent population — never Chain / Hop / Final* aggregation.
 */

export const RAW_RETENTION_DAYS = 7
export const RAW_MAX_EVENTS = 10000

/** Count-cap alias used by Completeness / API (replaces former 500-only ring). */
export const MAX_EVENTS = RAW_MAX_EVENTS

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type UsageEventLike = {
  requestId?: unknown
  provider?: unknown
  status?: unknown
  timestamp?: unknown
  [key: string]: unknown
}

export type UsageDailyAggregateRow = {
  date: string
  provider: string
  ok: number
  error: number
  total: number
}

export type UsageDailyAggregateFile = {
  version: 1
  processedRequestIds: string[]
  rows: UsageDailyAggregateRow[]
}

export type UsageEventProviderDailyRetained = {
  rows: UsageDailyAggregateRow[]
  oldestDate: string | null
  newestDate: string | null
  dayCount: number
}

function normalizeTimestamp(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return raw
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) {
    return raw.replace(' ', 'T')
  }
  return raw
}

/** UTC calendar YYYY-MM-DD; invalid → null (no local TZ, no correction). */
export function parseUtcCalendarDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (!match) return null
  if (!Number.isFinite(Date.parse(s))) return null
  const [y, mo, d] = match[1].split('-').map((part) => Number(part))
  if (![y, mo, d].every((n) => Number.isFinite(n))) return null
  const utc = Date.UTC(y, mo - 1, d)
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== mo ||
    check.getUTCDate() !== d
  ) {
    return null
  }
  return match[1]
}

function eventTimestampMs(event: UsageEventLike): number | null {
  const rawTs = String(event.timestamp ?? '').trim()
  if (!rawTs) return null
  const ms = Date.parse(normalizeTimestamp(rawTs))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Keep events within [nowMs - days, ∞) by timestamp when parseable.
 * Invalid timestamps: kept through day filter (cannot prove age), then
 * treated as oldest during count cap so they drop first when over max.
 */
export function pruneUsageEventsForRetention<T extends UsageEventLike>(
  events: T[] | null | undefined,
  nowMs: number = Date.now(),
  options?: { days?: number; maxEvents?: number }
): T[] {
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : []
  const days = options?.days ?? RAW_RETENTION_DAYS
  const maxEvents = options?.maxEvents ?? RAW_MAX_EVENTS
  const dayCap = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : RAW_RETENTION_DAYS
  const countCap = Number.isFinite(maxEvents)
    ? Math.max(0, Math.floor(maxEvents))
    : RAW_MAX_EVENTS
  const cutoff = nowMs - dayCap * MS_PER_DAY

  const withinDays = list.filter((event) => {
    const ms = eventTimestampMs(event)
    if (ms === null) return true
    return ms >= cutoff
  })

  if (withinDays.length <= countCap) return withinDays

  const ranked = withinDays
    .map((event, index) => ({
      event,
      index,
      ms: eventTimestampMs(event)
    }))
    .sort((a, b) => {
      const aMs = a.ms === null ? Number.NEGATIVE_INFINITY : a.ms
      const bMs = b.ms === null ? Number.NEGATIVE_INFINITY : b.ms
      if (aMs !== bMs) return aMs - bMs
      return a.index - b.index
    })

  return ranked.slice(-countCap).map((row) => row.event)
}

export function emptyUsageDailyAggregateFile(): UsageDailyAggregateFile {
  return { version: 1, processedRequestIds: [], rows: [] }
}

/**
 * Rebuild Aggregate rows for UTC dates present in Raw; keep older Aggregate rows.
 * Does not call Failover / Chain helpers.
 */
export function reconcileDailyAggregateWithRaw(
  existing: UsageDailyAggregateFile | null | undefined,
  rawEvents: UsageEventLike[] | null | undefined,
  analyzeDaily: (events: UsageEventLike[] | null | undefined) => {
    rows: UsageDailyAggregateRow[]
  }
): UsageDailyAggregateFile {
  const base = existing && existing.version === 1 ? existing : emptyUsageDailyAggregateFile()
  const raw = Array.isArray(rawEvents)
    ? rawEvents.filter((e) => e && typeof e === 'object')
    : []
  const daily = analyzeDaily(raw)
  const rawDates = new Set(daily.rows.map((row) => row.date))
  const kept = (Array.isArray(base.rows) ? base.rows : []).filter(
    (row) => row && typeof row === 'object' && !rawDates.has(String(row.date))
  )
  const rows = [...kept, ...daily.rows].sort((a, b) => {
    const dateCmp = String(a.date).localeCompare(String(b.date))
    if (dateCmp !== 0) return dateCmp
    return String(a.provider).localeCompare(String(b.provider))
  })
  const processedRequestIds = raw
    .map((event) => String(event.requestId ?? '').trim())
    .filter((id) => id.length > 0)

  return {
    version: 1,
    processedRequestIds,
    rows
  }
}

/**
 * Idempotent single-event upsert (skipped when requestId already processed).
 * Late events update the UTC date from event.timestamp.
 */
export function applyUsageEventToDailyAggregate(
  existing: UsageDailyAggregateFile | null | undefined,
  event: UsageEventLike | null | undefined
): UsageDailyAggregateFile {
  const state = existing && existing.version === 1 ? existing : emptyUsageDailyAggregateFile()
  if (!event || typeof event !== 'object') return state

  const requestId = String(event.requestId ?? '').trim()
  if (!requestId) return state
  const processed = new Set(
    (Array.isArray(state.processedRequestIds) ? state.processedRequestIds : []).map((id) =>
      String(id)
    )
  )
  if (processed.has(requestId)) return state

  const date = parseUtcCalendarDate(event.timestamp)
  if (!date) {
    return {
      ...state,
      processedRequestIds: Array.from(processed).concat(requestId)
    }
  }

  const provider = String(event.provider ?? '').trim() || '?'
  const rows = Array.isArray(state.rows) ? [...state.rows] : []
  const idx = rows.findIndex((row) => row.date === date && row.provider === provider)
  const cur =
    idx >= 0
      ? { ...rows[idx] }
      : { date, provider, ok: 0, error: 0, total: 0 }
  cur.total += 1
  const status = String(event.status ?? '').trim()
  if (status === 'ok') cur.ok += 1
  else if (status === 'error') cur.error += 1
  if (idx >= 0) rows[idx] = cur
  else rows.push(cur)

  rows.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return a.provider.localeCompare(b.provider)
  })

  return {
    version: 1,
    processedRequestIds: Array.from(processed).concat(requestId),
    rows
  }
}

export function summarizeDailyAggregateRetained(
  file: UsageDailyAggregateFile | null | undefined
): UsageEventProviderDailyRetained {
  const rows = Array.isArray(file?.rows)
    ? [...file!.rows].sort((a, b) => {
        const dateCmp = String(a.date).localeCompare(String(b.date))
        if (dateCmp !== 0) return dateCmp
        return String(a.provider).localeCompare(String(b.provider))
      })
    : []
  const dates = Array.from(new Set(rows.map((row) => String(row.date)))).sort((a, b) =>
    a.localeCompare(b)
  )
  return {
    rows,
    oldestDate: dates.length > 0 ? dates[0] : null,
    newestDate: dates.length > 0 ? dates[dates.length - 1] : null,
    dayCount: dates.length
  }
}
