/** Auto-save preference helpers (localStorage). */
const KEY = 'saforall-auto-save'
const DELAY_KEY = 'saforall-auto-save-delay-ms'

/** Clamp delay to a safe range (exported for unit tests). */
export function clampAutoSaveDelayMs(ms: number): number {
  if (!Number.isFinite(ms)) return 1500
  return Math.min(10_000, Math.max(400, Math.round(ms)))
}

export function loadAutoSaveEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function saveAutoSaveEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
}

export function loadAutoSaveDelayMs(): number {
  try {
    const raw = Number(window.localStorage.getItem(DELAY_KEY))
    return clampAutoSaveDelayMs(Number.isFinite(raw) ? raw : 1500)
  } catch {
    return 1500
  }
}

export function saveAutoSaveDelayMs(ms: number): void {
  try {
    window.localStorage.setItem(DELAY_KEY, String(clampAutoSaveDelayMs(ms)))
  } catch {
    // ignore
  }
}
