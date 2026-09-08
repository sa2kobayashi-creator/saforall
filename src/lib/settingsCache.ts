export type AppSettings = Record<string, string | boolean>

/**
 * `GET /settings` is requested independently by App (for the locale) and by
 * ChatPanel (for model lists), both right after the backend connects. Sharing
 * the in-flight request turns that into one round trip.
 *
 * The TTL only exists to absorb the small timing skew between those two
 * callers; anything later goes to the backend so saved settings are never
 * served stale.
 */
const COALESCE_MS = 1_000

let inflight: Promise<AppSettings | null> | null = null
let cachedAt = 0
let cached: AppSettings | null = null

export function fetchAppSettings(): Promise<AppSettings | null> {
  if (cached && Date.now() - cachedAt < COALESCE_MS) {
    return Promise.resolve(cached)
  }
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const result = await window.saforall.request<{ settings: AppSettings }>(
        'GET',
        '/settings'
      )
      if (!result.ok || !result.data?.settings) return null
      cached = result.data.settings
      cachedAt = Date.now()
      return cached
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Call after writing settings so the next read is not served from the cache. */
export function invalidateAppSettings(): void {
  cached = null
  cachedAt = 0
}
