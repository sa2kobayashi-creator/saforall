/** Persist dismissed Router usage hints for the current calendar month. */

const STORAGE_KEY = 'saforall-router-hints-dismissed'

export function currentUsageMonth(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function loadDismissedRouterHintCodes(month: string): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { month?: string; codes?: unknown }
    if (parsed.month !== month || !Array.isArray(parsed.codes)) return []
    return parsed.codes.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
  } catch {
    return []
  }
}

export function dismissRouterHintCode(month: string, code: string): string[] {
  const id = code.trim()
  if (!id) return loadDismissedRouterHintCodes(month)
  const next = Array.from(new Set([...loadDismissedRouterHintCodes(month), id]))
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ month, codes: next }))
  } catch {
    // ignore quota
  }
  return next
}

export function filterVisibleRouterHints<T extends { code?: string }>(
  hints: T[],
  dismissedCodes: string[]
): T[] {
  if (dismissedCodes.length === 0) return hints
  const blocked = new Set(dismissedCodes)
  return hints.filter((hint) => {
    const code = typeof hint.code === 'string' ? hint.code : ''
    if (!code) return true
    return !blocked.has(code)
  })
}
