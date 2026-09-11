/** Minimal event shape for Usage UI mapping (no secrets). */
export type UsageFailoverUi = {
  primaryProvider: string
  fallbackProvider?: string | null
  reason?: string | null
  attempt?: number
  failoverId?: string | null
  path?: string[] | null
  mode?: 'ask' | 'agent' | null
}

export type UsageEventLike = {
  provider: string
  model: string
  estimatedCost: number
  timestamp: string
  status?: string
  billingMode?: string | null
  credentialId?: string | null
  /** Router Failover trail only (providers / reason / attempt). Never secrets. */
  failover?: UsageFailoverUi | null
}

/** BYOK / DEVELOPMENT only for Usage UI. Never expose credentials. */
export function billingModeForUi(
  mode: string | null | undefined
): 'BYOK' | 'DEVELOPMENT' | null {
  if (mode === 'BYOK' || mode === 'DEVELOPMENT') return mode
  return null
}

/** Pass through non-empty credentialId only (never invent; never secret). */
export function credentialIdForUi(id: string | null | undefined): string | null {
  const raw = String(id || '').trim()
  return raw || null
}

/** Short label for Credential column. Full id stays in title attribute. */
export function formatCredentialIdShort(id: string | null | undefined): string {
  const raw = credentialIdForUi(id)
  if (!raw) return '—'
  if (raw.startsWith('dev:')) return raw
  if (raw.length <= 18) return raw
  return `${raw.slice(0, 10)}…${raw.slice(-4)}`
}

function sanitizePath(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const path = raw
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
  return path.length > 0 ? path : null
}

/** Sanitize failover meta for UI (providers / reason / attempt / id / path only). */
export function failoverForUi(
  raw: UsageEventLike['failover'] | null | undefined
): UsageFailoverUi | null {
  if (!raw || typeof raw !== 'object') return null
  const primaryProvider = String(raw.primaryProvider || '').trim()
  if (!primaryProvider) return null
  const fallbackRaw = raw.fallbackProvider != null ? String(raw.fallbackProvider).trim() : ''
  const reasonRaw = raw.reason != null ? String(raw.reason).trim() : ''
  const failoverIdRaw = raw.failoverId != null ? String(raw.failoverId).trim() : ''
  const mode =
    raw.mode === 'ask' || raw.mode === 'agent' ? raw.mode : null
  return {
    primaryProvider,
    fallbackProvider: fallbackRaw || null,
    reason: reasonRaw || null,
    attempt: typeof raw.attempt === 'number' && Number.isFinite(raw.attempt) ? raw.attempt : undefined,
    failoverId: failoverIdRaw || null,
    path: sanitizePath(raw.path),
    mode
  }
}

/**
 * Compact Router Failover label. Distinct from PHP route-log fallback_from.
 * Prefers full path when present. Old events without path still work.
 */
export function formatRouterFailoverLabel(
  failover: UsageFailoverUi | null | undefined,
  engine?: string
): string {
  const meta = failoverForUi(failover)
  if (!meta) return ''
  const path = meta.path && meta.path.length > 1 ? meta.path : null
  const switched =
    Boolean(path) ||
    Boolean(meta.fallbackProvider) ||
    (typeof meta.attempt === 'number' && meta.attempt > 1)
  if (!switched) return ''
  const base = path
    ? path.join('→')
    : `${meta.primaryProvider}→${meta.fallbackProvider || String(engine || '').trim() || '?'}`
  const modeTag = meta.mode === 'agent' ? ' [agent]' : meta.mode === 'ask' ? '' : ''
  return meta.reason ? `${base} (${meta.reason})${modeTag}` : `${base}${modeTag}`
}

/**
 * Count unique Router Failover chains (by failoverId), not UsageEvent rows.
 * Events without failoverId are ignored.
 */
export function countFailoverChains(
  events: Array<{ failover?: UsageFailoverUi | null } | null | undefined>
): number {
  const ids = new Set<string>()
  for (const event of events) {
    const id = String(event?.failover?.failoverId || '').trim()
    if (id) ids.add(id)
  }
  return ids.size
}

export type UsageRecentRow = {
  id: number
  engine: string
  task_type: string
  mode: string
  model: string | null
  estimated_usd: number
  fallback_from: string | null
  fallback_reason: string | null
  created_at: string
  billingMode: 'BYOK' | 'DEVELOPMENT' | null
  credentialId: string | null
  /** Router Failover (Electron UsageEvent). Not PHP ai_route_log fallback. */
  routerFailover: UsageFailoverUi | null
}

export function usageEventsToRecentRows(events: UsageEventLike[], limit = 30): UsageRecentRow[] {
  return events.slice(0, limit).map((event, index) => {
    const failover = failoverForUi(event.failover)
    return {
      id: index + 1,
      engine: event.provider,
      task_type: event.status === 'error' ? 'error' : 'llm',
      mode: failover?.mode === 'agent' ? 'agent' : 'ask',
      model: event.model || null,
      estimated_usd: Math.round((Number(event.estimatedCost) || 0) * 10000) / 10000,
      fallback_from: null,
      fallback_reason: null,
      created_at: event.timestamp,
      billingMode: billingModeForUi(event.billingMode),
      credentialId: credentialIdForUi(event.credentialId),
      routerFailover: failover
    }
  })
}

/** Attach billingMode (+ credentialId / routerFailover from matched events) onto route-log recent rows. */
export function enrichRecentWithBillingMode<T extends { engine: string; created_at: string }>(
  recent: T[],
  events: UsageEventLike[],
  fallbackForEngine?: (engine: string) => 'BYOK' | 'DEVELOPMENT' | null
): Array<
  T & {
    billingMode: 'BYOK' | 'DEVELOPMENT' | null
    credentialId: string | null
    routerFailover: UsageFailoverUi | null
  }
> {
  return recent.map((row) => {
    const existingMode = billingModeForUi(
      'billingMode' in row ? String((row as { billingMode?: string | null }).billingMode ?? '') : null
    )
    const existingCred = credentialIdForUi(
      'credentialId' in row
        ? String((row as { credentialId?: string | null }).credentialId ?? '')
        : null
    )
    const existingFailover = failoverForUi(
      'routerFailover' in row
        ? ((row as { routerFailover?: UsageFailoverUi | null }).routerFailover ?? null)
        : 'failover' in row
          ? ((row as { failover?: UsageFailoverUi | null }).failover ?? null)
          : null
    )
    if (existingMode) {
      return {
        ...row,
        billingMode: existingMode,
        credentialId: existingCred,
        routerFailover: existingFailover
      }
    }

    const rowTs = Date.parse(normalizeTimestamp(row.created_at))
    let best: UsageEventLike | null = null
    let bestDiff = Number.POSITIVE_INFINITY
    for (const event of events) {
      if (!engineMatches(event.provider, row.engine)) continue
      const mode = billingModeForUi(event.billingMode)
      if (!mode) continue
      const eventTs = Date.parse(normalizeTimestamp(event.timestamp))
      const diff =
        Number.isFinite(rowTs) && Number.isFinite(eventTs)
          ? Math.abs(eventTs - rowTs)
          : Number.POSITIVE_INFINITY
      // Prefer near-in-time matches; allow same-day engine match as fallback.
      if (diff < bestDiff && diff <= 24 * 60 * 60 * 1000) {
        best = event
        bestDiff = diff
      }
    }
    const fromEvent = billingModeForUi(best?.billingMode)
    if (fromEvent && best) {
      return {
        ...row,
        billingMode: fromEvent,
        credentialId: credentialIdForUi(best.credentialId) ?? existingCred,
        routerFailover: failoverForUi(best.failover) ?? existingFailover
      }
    }

    const fromResolver = fallbackForEngine ? billingModeForUi(fallbackForEngine(row.engine)) : null
    // Do not invent credentialId from current resolver / vault state.
    return {
      ...row,
      billingMode: fromResolver,
      credentialId: existingCred,
      routerFailover: existingFailover
    }
  })
}

function engineMatches(provider: string, engine: string): boolean {
  return provider.trim().toLowerCase() === engine.trim().toLowerCase()
}

/** MySQL "YYYY-MM-DD HH:mm:ss" and ISO both parse reliably. */
function normalizeTimestamp(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return raw
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) {
    return raw.replace(' ', 'T')
  }
  return raw
}
