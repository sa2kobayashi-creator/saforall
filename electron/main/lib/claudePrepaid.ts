import { getLocalSetting, mergeLocalSettings } from '../settingsStore'

export const CLAUDE_PREPAID_KEY = 'llm.claude.prepaid_remaining_usd'
export const CLAUDE_PREPAID_WARN_KEY = 'llm.claude.prepaid_warn_usd'
const DEFAULT_WARN = 1

export type ClaudePrepaidStatus = {
  /** false = user has not set a prepaid tracker (do not block Auto) */
  tracking: boolean
  remaining: number | null
  warnAt: number
  low: boolean
  depleted: boolean
}

function parseUsd(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export function getClaudePrepaidStatus(): ClaudePrepaidStatus {
  const remaining = parseUsd(getLocalSetting(CLAUDE_PREPAID_KEY, ''))
  const warnRaw = parseUsd(getLocalSetting(CLAUDE_PREPAID_WARN_KEY, ''))
  const warnAt = warnRaw ?? DEFAULT_WARN
  if (remaining === null) {
    return { tracking: false, remaining: null, warnAt, low: false, depleted: false }
  }
  return {
    tracking: true,
    remaining,
    warnAt,
    low: remaining > 0 && remaining <= warnAt,
    depleted: remaining <= 0
  }
}

/** Auto should skip Claude when prepaid tracker says depleted. */
export function isClaudePrepaidBlockingAuto(): boolean {
  return getClaudePrepaidStatus().depleted
}

export async function setClaudePrepaidRemaining(usd: number | null): Promise<void> {
  if (usd === null) {
    await mergeLocalSettings({ [CLAUDE_PREPAID_KEY]: '' })
    return
  }
  const next = Math.max(0, Math.round(usd * 10_000) / 10_000)
  await mergeLocalSettings({ [CLAUDE_PREPAID_KEY]: String(next) })
}

/** Deduct estimated Anthropic spend from the hand-tracked prepaid balance. */
export async function deductClaudePrepaid(estimatedUsd: number): Promise<ClaudePrepaidStatus> {
  const status = getClaudePrepaidStatus()
  if (!status.tracking || status.remaining === null) return status
  const add = Math.max(0, Number(estimatedUsd) || 0)
  if (add <= 0) return status
  const next = Math.max(0, status.remaining - add)
  await setClaudePrepaidRemaining(next)
  return getClaudePrepaidStatus()
}

/** After Anthropic billing errors, force remaining to 0 so Auto stops picking Claude. */
export async function markClaudePrepaidDepleted(): Promise<void> {
  const status = getClaudePrepaidStatus()
  if (!status.tracking) {
    // Still mark so user sees 0 until they enter a new top-up.
    await setClaudePrepaidRemaining(0)
    return
  }
  await setClaudePrepaidRemaining(0)
}
