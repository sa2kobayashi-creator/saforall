/** Auto-save preference helpers (localStorage). */
const KEY = 'saforall-auto-save'
const DELAY_KEY = 'saforall-auto-save-delay-ms'

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
    if (!Number.isFinite(raw)) return 1500
    return Math.min(10_000, Math.max(400, Math.round(raw)))
  } catch {
    return 1500
  }
}

export function saveAutoSaveDelayMs(ms: number): void {
  try {
    window.localStorage.setItem(
      DELAY_KEY,
      String(Math.min(10_000, Math.max(400, Math.round(ms))))
    )
  } catch {
    // ignore
  }
}
