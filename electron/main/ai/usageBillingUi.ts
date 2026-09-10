/** Minimal event shape for Usage UI mapping (no secrets). */
export type UsageEventLike = {
  provider: string
  model: string
  estimatedCost: number
  timestamp: string
  status?: string
  billingMode?: string | null
  credentialId?: string | null
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
}

export function usageEventsToRecentRows(events: UsageEventLike[], limit = 30): UsageRecentRow[] {
  return events.slice(0, limit).map((event, index) => ({
    id: index + 1,
    engine: event.provider,
    task_type: event.status === 'error' ? 'error' : 'llm',
    mode: 'ask',
    model: event.model || null,
    estimated_usd: Math.round((Number(event.estimatedCost) || 0) * 10000) / 10000,
    fallback_from: null,
    fallback_reason: null,
    created_at: event.timestamp,
    billingMode: billingModeForUi(event.billingMode),
    credentialId: credentialIdForUi(event.credentialId)
  }))
}

/** Attach billingMode (+ credentialId from matched events) onto route-log recent rows. */
export function enrichRecentWithBillingMode<T extends { engine: string; created_at: string }>(
  recent: T[],
  events: UsageEventLike[],
  fallbackForEngine?: (engine: string) => 'BYOK' | 'DEVELOPMENT' | null
): Array<T & { billingMode: 'BYOK' | 'DEVELOPMENT' | null; credentialId: string | null }> {
  return recent.map((row) => {
    const existingMode = billingModeForUi(
      'billingMode' in row ? String((row as { billingMode?: string | null }).billingMode ?? '') : null
    )
    const existingCred = credentialIdForUi(
      'credentialId' in row
        ? String((row as { credentialId?: string | null }).credentialId ?? '')
        : null
    )
    if (existingMode) {
      return { ...row, billingMode: existingMode, credentialId: existingCred }
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
    if (fromEvent) {
      return {
        ...row,
        billingMode: fromEvent,
        credentialId: credentialIdForUi(best?.credentialId) ?? existingCred
      }
    }

    const fromResolver = fallbackForEngine ? billingModeForUi(fallbackForEngine(row.engine)) : null
    // Do not invent credentialId from current resolver / vault state.
    return { ...row, billingMode: fromResolver, credentialId: existingCred }
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
