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
  estimatedCost?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
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
 * Formal Chain ID extractor (Phase 2-C-7).
 * Only failoverId — never requestId / sessionId / timestamp / provider / path.
 * Shared by countFailoverChains and groupUsageEventsByFailoverId.
 */
export function chainFailoverId(
  failover: { failoverId?: string | null } | null | undefined
): string | null {
  if (!failover || typeof failover !== 'object') return null
  const id = String(failover.failoverId || '').trim()
  return id || null
}

/**
 * Allowlisted failover fields for Chain hops.
 * Unlike failoverForUi, does not require primaryProvider (malformed-safe).
 * Never reads secrets / raw errors.
 */
function chainHopFields(failover: UsageEventLike['failover'] | null | undefined): {
  primaryProvider: string | null
  reason: string | null
  attempt: number | undefined
  path: string[] | null
  mode: 'ask' | 'agent' | null
} {
  const viaUi = failoverForUi(failover)
  if (viaUi) {
    return {
      primaryProvider: viaUi.primaryProvider,
      reason: viaUi.reason ?? null,
      attempt: viaUi.attempt,
      path: viaUi.path ?? null,
      mode: viaUi.mode ?? null
    }
  }
  if (!failover || typeof failover !== 'object') {
    return {
      primaryProvider: null,
      reason: null,
      attempt: undefined,
      path: null,
      mode: null
    }
  }
  const reasonRaw = failover.reason != null ? String(failover.reason).trim() : ''
  const mode =
    failover.mode === 'ask' || failover.mode === 'agent' ? failover.mode : null
  return {
    primaryProvider: null,
    reason: reasonRaw || null,
    attempt:
      typeof failover.attempt === 'number' && Number.isFinite(failover.attempt)
        ? failover.attempt
        : undefined,
    path: sanitizePath(failover.path),
    mode
  }
}

/**
 * Count unique Router Failover chains (by failoverId), not UsageEvent rows.
 * Same ID rule as groupUsageEventsByFailoverId (Phase 2-C-7).
 */
export function countFailoverChains(
  events: Array<{ failover?: UsageFailoverUi | null } | null | undefined>
): number {
  const ids = new Set<string>()
  for (const event of events) {
    const id = chainFailoverId(event?.failover)
    if (id) ids.add(id)
  }
  return ids.size
}

/** One hop in a Router Failover chain (non-secret fields only). */
export type FailoverChainHop = {
  provider: string
  status: string
  attempt: number
  reason: string | null
  mode: 'ask' | 'agent' | null
  timestamp: string
  credentialId: string | null
  billingMode: 'BYOK' | 'DEVELOPMENT' | null
}

/**
 * Reconstructed Router Failover chain from UsageEvents sharing one failoverId.
 * Not persisted — derived at read time. Never includes secrets / raw errors.
 */
export type FailoverChainSummary = {
  failoverId: string
  mode: 'ask' | 'agent' | null
  /** Final event path when present; else ordered hop providers. */
  path: string[]
  providers: string[]
  reasons: string[]
  statuses: string[]
  hops: FailoverChainHop[]
  finalStatus: string
  finalReason: string | null
  /**
   * Phase 6-B P0: provider that formally owns final success for this chain.
   * null when finalStatus !== 'ok' or no non-empty ok hop exists.
   * Core-generated only — UI must not infer from hops[].
   */
  finalSuccessProvider: string | null
  /**
   * Phase 7-B P0: provider that formally owns final failure for this chain.
   * null when finalStatus !== 'error' or no non-empty error hop exists.
   * Core-generated only — UI must not infer from hops[].
   */
  finalFailedProvider: string | null
}

/**
 * Phase 6-B P0: resolve finalSuccessProvider from finalStatus + hops (Core only).
 * Walk hops from the end; first status===ok with non-empty provider wins.
 */
export function resolveFinalSuccessProvider(
  finalStatus: string,
  hops: FailoverChainHop[] | null | undefined
): string | null {
  if (String(finalStatus || '').trim() !== 'ok') return null
  if (!Array.isArray(hops) || hops.length === 0) return null
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]
    if (!hop || typeof hop !== 'object') continue
    if (String(hop.status || '').trim() !== 'ok') continue
    const provider = String(hop.provider || '').trim()
    if (!provider) continue
    return provider
  }
  return null
}

/**
 * Phase 7-B P0: resolve finalFailedProvider from finalStatus + hops (Core only).
 * Walk hops from the end; first status===error with non-empty provider wins.
 */
export function resolveFinalFailedProvider(
  finalStatus: string,
  hops: FailoverChainHop[] | null | undefined
): string | null {
  if (String(finalStatus || '').trim() !== 'error') return null
  if (!Array.isArray(hops) || hops.length === 0) return null
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]
    if (!hop || typeof hop !== 'object') continue
    if (String(hop.status || '').trim() !== 'error') continue
    const provider = String(hop.provider || '').trim()
    if (!provider) continue
    return provider
  }
  return null
}

function hopReasonLabel(reason: string | null | undefined, status: string): string {
  const cleaned = String(reason || '').trim()
  if (cleaned) return cleaned
  if (status === 'ok') return 'success'
  return status || 'error'
}

/**
 * Group UsageEvents that share the same failover.failoverId into chains.
 * Events without failoverId are excluded (normal success / single failure).
 * Sort: attempt ascending, then timestamp as tie-break. Does not invent chains.
 * ID rule matches countFailoverChains (Phase 2-C-7).
 */
export function groupUsageEventsByFailoverId(
  events: UsageEventLike[]
): FailoverChainSummary[] {
  const buckets = new Map<string, UsageEventLike[]>()
  for (const event of events) {
    const id = chainFailoverId(event.failover)
    if (!id) continue
    const list = buckets.get(id)
    if (list) list.push(event)
    else buckets.set(id, [event])
  }

  const chains: FailoverChainSummary[] = []
  for (const [failoverId, group] of Array.from(buckets.entries())) {
    const sorted = [...group].sort((a, b) => {
      const fieldsA = chainHopFields(a.failover)
      const fieldsB = chainHopFields(b.failover)
      const attemptA =
        typeof fieldsA.attempt === 'number' && Number.isFinite(fieldsA.attempt)
          ? fieldsA.attempt
          : Number.POSITIVE_INFINITY
      const attemptB =
        typeof fieldsB.attempt === 'number' && Number.isFinite(fieldsB.attempt)
          ? fieldsB.attempt
          : Number.POSITIVE_INFINITY
      if (attemptA !== attemptB) return attemptA - attemptB
      const tsA = Date.parse(normalizeTimestamp(a.timestamp))
      const tsB = Date.parse(normalizeTimestamp(b.timestamp))
      const safeA = Number.isFinite(tsA) ? tsA : 0
      const safeB = Number.isFinite(tsB) ? tsB : 0
      return safeA - safeB
    })

    const hops: FailoverChainHop[] = sorted.map((event, index) => {
      const fields = chainHopFields(event.failover)
      const status = String(event.status || '').trim() || 'ok'
      const attempt =
        typeof fields.attempt === 'number' && Number.isFinite(fields.attempt)
          ? fields.attempt
          : index + 1
      return {
        provider:
          String(event.provider || '').trim() ||
          String(fields.primaryProvider || '').trim(),
        status,
        attempt,
        reason: fields.reason,
        mode: fields.mode,
        timestamp: String(event.timestamp || ''),
        credentialId: credentialIdForUi(event.credentialId),
        billingMode: billingModeForUi(event.billingMode)
      }
    })

    const last = sorted[sorted.length - 1]
    const lastFields = chainHopFields(last?.failover)
    const pathFromLast =
      lastFields.path && lastFields.path.length > 0 ? lastFields.path : null
    const providers = hops.map((hop) => hop.provider).filter((p) => p.length > 0)
    const path = pathFromLast && pathFromLast.length > 0 ? pathFromLast : providers
    const reasons = hops.map((hop) => hopReasonLabel(hop.reason, hop.status))
    const statuses = hops.map((hop) => hop.status)
    let mode: 'ask' | 'agent' | null = null
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      if (hops[i].mode === 'ask' || hops[i].mode === 'agent') {
        mode = hops[i].mode
        break
      }
    }

    const finalStatus = statuses[statuses.length - 1] || 'ok'
    const finalReason = reasons[reasons.length - 1] || null
    chains.push({
      failoverId,
      mode,
      path,
      providers,
      reasons,
      statuses,
      hops,
      finalStatus,
      finalReason,
      finalSuccessProvider: resolveFinalSuccessProvider(finalStatus, hops),
      finalFailedProvider: resolveFinalFailedProvider(finalStatus, hops)
    })
  }

  // Stable order: earliest hop timestamp first.
  chains.sort((a, b) => {
    const tsA = Date.parse(normalizeTimestamp(a.hops[0]?.timestamp || ''))
    const tsB = Date.parse(normalizeTimestamp(b.hops[0]?.timestamp || ''))
    const safeA = Number.isFinite(tsA) ? tsA : 0
    const safeB = Number.isFinite(tsB) ? tsB : 0
    return safeA - safeB
  })
  return chains
}

/** Provider path for chain UI: "openai → claude → gemini". */
export function formatFailoverChainProviders(chain: FailoverChainSummary): string {
  const path = chain.path.length > 0 ? chain.path : chain.providers
  return path.filter((p) => String(p || '').trim()).join(' → ')
}

/** Reason path for chain UI: "rate_limit → network_error → success". */
export function formatFailoverChainReasons(chain: FailoverChainSummary): string {
  return chain.reasons.filter((r) => String(r || '').trim()).join(' → ')
}

/**
 * Compact multi-line-friendly chain label (mode + providers + reasons).
 * Never includes secrets.
 */
export function formatFailoverChainLabel(chain: FailoverChainSummary): string {
  const modeTag = chain.mode === 'agent' ? '[agent]' : '[ask]'
  const providers = formatFailoverChainProviders(chain)
  const reasons = formatFailoverChainReasons(chain)
  if (!providers) return modeTag
  return reasons ? `${modeTag} ${providers} | ${reasons}` : `${modeTag} ${providers}`
}

/** Hop-count buckets for Phase 3-A analysis (read-time, non-secret). */
export type FailoverChainHopDistribution = {
  one: number
  two: number
  three: number
  fourPlus: number
}

export type FailoverChainModeBreakdown = {
  ask: number
  agent: number
  unknown: number
}

export type FailoverChainProviderStat = {
  provider: string
  hops: number
  errors: number
  oks: number
}

export type FailoverChainReasonStat = {
  reason: string
  count: number
}

export type FailoverChainFinalSuccessProviderCount = {
  provider: string
  count: number
}

export type FailoverChainFinalFailedProviderCount = {
  provider: string
  count: number
}

export type FailoverChainReasonTransition = {
  from: string
  to: string
  count: number
}

/** Phase 8-B P1: same-month daily chain facts (not Health/Risk). */
export type FailoverChainDailyBucket = {
  date: string
  chainCount: number
  successfulCount: number
  exhaustedCount: number
}

/**
 * Phase 3-A: read-time Router Failover Chain analysis.
 * Derived only from FailoverChainSummary[] — no secrets / credentialId / raw errors.
 */
export type FailoverChainAnalysis = {
  totalChains: number
  successfulChains: number
  exhaustedChains: number
  /** successfulChains / totalChains; null when totalChains === 0 */
  successRate: number | null
  rescuedChains: number
  /** rescuedChains / totalChains; null when totalChains === 0 */
  rescueRate: number | null
  hopDistribution: FailoverChainHopDistribution
  /** null when totalChains === 0 */
  averageHops: number | null
  maxHops: number
  byMode: FailoverChainModeBreakdown
  byProvider: FailoverChainProviderStat[]
  byReason: FailoverChainReasonStat[]
  /**
   * Phase 6-B P0: chain-level final success attribution counts.
   * Not the same as byProvider[].oks (hop-level).
   */
  finalSuccessProviderCounts: FailoverChainFinalSuccessProviderCount[]
  /**
   * Phase 7-B P0: chain-level final failure attribution counts.
   * Not the same as byProvider[].errors (hop-level).
   */
  finalFailedProviderCounts: FailoverChainFinalFailedProviderCount[]
  /**
   * Phase 7-B P1: adjacent reason transitions from summary.reasons[] only.
   * Do not regenerate from hops in analysis or UI.
   */
  reasonTransitions: FailoverChainReasonTransition[]
  /**
   * Phase 8-B P1: per-day chain facts from hop timestamps (YYYY-MM-DD).
   * Invalid timestamps excluded — no Health/Risk labeling.
   */
  dailyBuckets: FailoverChainDailyBucket[]
}

function hopCountOf(summary: FailoverChainSummary | null | undefined): number {
  const hops = summary?.hops
  if (!Array.isArray(hops)) return 0
  return hops.length
}

function isSuccessfulChain(summary: FailoverChainSummary): boolean {
  return String(summary.finalStatus || '').trim() === 'ok'
}

function isExhaustedChain(summary: FailoverChainSummary): boolean {
  return String(summary.finalStatus || '').trim() === 'error'
}

function isRescuedChain(summary: FailoverChainSummary): boolean {
  return hopCountOf(summary) >= 2 && isSuccessfulChain(summary)
}

/**
 * Extract UTC calendar YYYY-MM-DD from an ISO-like timestamp.
 * Invalid / empty / non-parseable / non-calendar → null (no guessing, no local TZ).
 * Shared by Chain dailyBuckets (Phase 8-B) and All UsageEvent daily (Phase 10-B).
 */
function parseUtcCalendarDate(raw: unknown): string | null {
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

/**
 * Extract UTC date-hour YYYY-MM-DDTHH from an ISO-like timestamp.
 * Invalid / empty / non-parseable / non-calendar / missing hour → null (no local TZ).
 * Used by All UsageEvent hourly (Phase 11-C). Not for Chain day-bucket resolution.
 */
function parseUtcDateHour(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const normalized = normalizeTimestamp(s)
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(normalized)
  if (!match) return null
  if (!Number.isFinite(Date.parse(normalized))) return null
  const [y, mo, d] = match[1].split('-').map((part) => Number(part))
  const hour = Number(match[2])
  if (![y, mo, d, hour].every((n) => Number.isFinite(n))) return null
  if (hour < 0 || hour > 23) return null
  const utc = Date.UTC(y, mo - 1, d, hour)
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== mo ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== hour
  ) {
    return null
  }
  return `${match[1]}T${match[2]}`
}

/** Alias used by Chain dailyBuckets (Phase 8-B). */
function parseChainBucketDate(raw: unknown): string | null {
  return parseUtcCalendarDate(raw)
}

/**
 * Phase 8-B: bucket date for a chain — last hop with a valid timestamp
 * (resolution day). No inference when none are valid.
 */
function chainDailyBucketDate(summary: FailoverChainSummary): string | null {
  if (!Array.isArray(summary.hops) || summary.hops.length === 0) return null
  const hops = summary.hops
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]
    if (!hop || typeof hop !== 'object') continue
    const date = parseChainBucketDate(hop.timestamp)
    if (date) return date
  }
  return null
}

/**
 * Pure Phase 3-A analysis over FailoverChainSummary[].
 * Does not regroup UsageEvents. No I/O, secrets, or credentials.
 */
export function analyzeFailoverChains(
  summaries: FailoverChainSummary[] | null | undefined
): FailoverChainAnalysis {
  const list = Array.isArray(summaries) ? summaries : []
  const totalChains = list.length

  let successfulChains = 0
  let exhaustedChains = 0
  let rescuedChains = 0
  let hopSum = 0
  let maxHops = 0
  const hopDistribution: FailoverChainHopDistribution = {
    one: 0,
    two: 0,
    three: 0,
    fourPlus: 0
  }
  const byMode: FailoverChainModeBreakdown = {
    ask: 0,
    agent: 0,
    unknown: 0
  }
  const providerMap = new Map<string, FailoverChainProviderStat>()
  const reasonMap = new Map<string, number>()
  const finalSuccessMap = new Map<string, number>()
  const finalFailedMap = new Map<string, number>()
  const transitionMap = new Map<string, { from: string; to: string; count: number }>()
  const dailyMap = new Map<
    string,
    { date: string; chainCount: number; successfulCount: number; exhaustedCount: number }
  >()

  for (const summary of list) {
    if (!summary || typeof summary !== 'object') continue

    if (isSuccessfulChain(summary)) successfulChains += 1
    else if (isExhaustedChain(summary)) exhaustedChains += 1

    if (isRescuedChain(summary)) rescuedChains += 1

    const hops = hopCountOf(summary)
    hopSum += hops
    if (hops > maxHops) maxHops = hops
    if (hops === 1) hopDistribution.one += 1
    else if (hops === 2) hopDistribution.two += 1
    else if (hops === 3) hopDistribution.three += 1
    else if (hops >= 4) hopDistribution.fourPlus += 1

    if (summary.mode === 'ask') byMode.ask += 1
    else if (summary.mode === 'agent') byMode.agent += 1
    else byMode.unknown += 1

    const finalSuccessProvider = String(summary.finalSuccessProvider || '').trim()
    if (finalSuccessProvider) {
      finalSuccessMap.set(
        finalSuccessProvider,
        (finalSuccessMap.get(finalSuccessProvider) || 0) + 1
      )
    }

    const finalFailedProvider = String(summary.finalFailedProvider || '').trim()
    if (finalFailedProvider) {
      finalFailedMap.set(
        finalFailedProvider,
        (finalFailedMap.get(finalFailedProvider) || 0) + 1
      )
    }

    const hopRows = Array.isArray(summary.hops)
      ? summary.hops
      : (new Array() as FailoverChainHop[])
    for (const hop of hopRows) {
      if (!hop || typeof hop !== 'object') continue
      const provider = String(hop.provider || '').trim() || '?'
      const cur = providerMap.get(provider) ?? {
        provider,
        hops: 0,
        errors: 0,
        oks: 0
      }
      cur.hops += 1
      const status = String(hop.status || '').trim()
      if (status === 'ok') cur.oks += 1
      else if (status === 'error') cur.errors += 1
      providerMap.set(provider, cur)
    }

    const reasonRows = Array.isArray(summary.reasons)
      ? summary.reasons
      : hopRows.map((hop) => String(hop?.reason || '').trim()).filter(Boolean)
    for (const raw of reasonRows) {
      const reason = String(raw || '').trim()
      if (!reason) continue
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1)
    }

    // Phase 7-B P1: adjacent transitions from summary.reasons only (no hop regen).
    if (Array.isArray(summary.reasons) && summary.reasons.length >= 2) {
      for (let i = 0; i < summary.reasons.length - 1; i += 1) {
        const from = String(summary.reasons[i] || '').trim()
        const to = String(summary.reasons[i + 1] || '').trim()
        if (!from || !to) continue
        const key = `${from}\0${to}`
        const cur = transitionMap.get(key)
        if (cur) cur.count += 1
        else transitionMap.set(key, { from, to, count: 1 })
      }
    }

    // Phase 8-B P1: daily facts from hop timestamps (invalid → excluded).
    const bucketDate = chainDailyBucketDate(summary)
    if (bucketDate) {
      const bucket = dailyMap.get(bucketDate) ?? {
        date: bucketDate,
        chainCount: 0,
        successfulCount: 0,
        exhaustedCount: 0
      }
      bucket.chainCount += 1
      if (isSuccessfulChain(summary)) bucket.successfulCount += 1
      else if (isExhaustedChain(summary)) bucket.exhaustedCount += 1
      dailyMap.set(bucketDate, bucket)
    }
  }

  const successRate = totalChains === 0 ? null : successfulChains / totalChains
  const rescueRate = totalChains === 0 ? null : rescuedChains / totalChains
  const averageHops = totalChains === 0 ? null : hopSum / totalChains

  const byProvider = Array.from(providerMap.values()).sort((a, b) =>
    a.provider.localeCompare(b.provider)
  )
  const byReason = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => a.reason.localeCompare(b.reason))
  const finalSuccessProviderCounts = Array.from(finalSuccessMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
  const finalFailedProviderCounts = Array.from(finalFailedMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
  const reasonTransitions = Array.from(transitionMap.values()).sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from)
    if (fromCmp !== 0) return fromCmp
    return a.to.localeCompare(b.to)
  })
  const dailyBuckets = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )

  return {
    totalChains,
    successfulChains,
    exhaustedChains,
    successRate,
    rescuedChains,
    rescueRate,
    hopDistribution,
    averageHops,
    maxHops,
    byMode,
    byProvider,
    byReason,
    finalSuccessProviderCounts,
    finalFailedProviderCounts,
    reasonTransitions,
    dailyBuckets
  }
}

/**
 * Phase 9-B: UsageEvent provider status facts (not Health/Risk).
 * Core aggregates whatever list is passed — population is decided by API wiring.
 */
export type UsageEventProviderStatus = {
  provider: string
  ok: number
  error: number
  total: number
}

/**
 * Phase 12-D A-2: Status API envelope — month population metadata (additive).
 * Core still returns UsageEventProviderStatus[]; API wraps with population/month.
 */
export type UsageEventProviderStatusAnalysis = {
  rows: UsageEventProviderStatus[]
  population: 'month'
  month: string
}

/**
 * Aggregate ok/error/total per provider across input UsageEvents.
 * Does not call groupUsageEventsByFailoverId or read Chain analysis fields.
 */
export function analyzeUsageEventProviderStatus(
  events: UsageEventLike[] | null | undefined
): UsageEventProviderStatus[] {
  const list = Array.isArray(events) ? events : []
  const map = new Map<string, UsageEventProviderStatus>()

  for (const event of list) {
    if (!event || typeof event !== 'object') continue

    const provider = String(event.provider ?? '').trim() || '?'
    const cur = map.get(provider) ?? {
      provider,
      ok: 0,
      error: 0,
      total: 0
    }
    cur.total += 1
    const status = String(event.status ?? '').trim()
    if (status === 'ok') cur.ok += 1
    else if (status === 'error') cur.error += 1
    map.set(provider, cur)
  }

  return Array.from(map.values()).sort((a, b) => a.provider.localeCompare(b.provider))
}

/** Attach month population metadata for Daily/Hourly analysis envelopes. */
export function withMonthPopulationAnalysis<T extends object>(
  analysis: T,
  month: string
): T & { population: 'month'; month: string } {
  return {
    ...analysis,
    population: 'month',
    month: String(month || '').trim()
  }
}

/**
 * Phase 10-B: All UsageEvent provider × UTC-day status facts (no evaluative labels).
 * Population: every event in the input list — with or without failoverId.
 * Independent of Failover dailyBuckets / month-total provider status aggregation.
 */
export type UsageEventProviderDailyStatus = {
  date: string
  provider: string
  ok: number
  error: number
  total: number
}

/**
 * Phase 10-B: daily rows + retention range of the analyzed UsageEvent list.
 * Range is Core-computed (UI must not rescan timestamps).
 */
export type UsageEventProviderDailyAnalysis = {
  rows: UsageEventProviderDailyStatus[]
  eventCount: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  /** Phase 12-D A-2: API wiring population (month when month-filtered). */
  population?: 'month'
  /** Phase 12-D A-2: YYYY-MM when population is month. */
  month?: string
}

/**
 * Aggregate ok/error/total per (UTC date × provider) across all UsageEvents.
 * Standalone over raw events; no chain grouping or Chain analysis fields.
 */
export function analyzeUsageEventProviderDailyStatus(
  events: UsageEventLike[] | null | undefined
): UsageEventProviderDailyAnalysis {
  const list = Array.isArray(events) ? events : []
  const map = new Map<string, UsageEventProviderDailyStatus>()
  let eventCount = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    eventCount += 1

    const rawTs = String(event.timestamp ?? '').trim()
    if (rawTs) {
      const ms = Date.parse(normalizeTimestamp(rawTs))
      if (Number.isFinite(ms)) {
        if (ms < oldestMs) {
          oldestMs = ms
          oldestTimestamp = rawTs
        }
        if (ms > newestMs) {
          newestMs = ms
          newestTimestamp = rawTs
        }
      }
    }

    const date = parseUtcCalendarDate(event.timestamp)
    if (!date) continue

    const provider = String(event.provider ?? '').trim() || '?'
    const key = `${date}\0${provider}`
    const cur = map.get(key) ?? {
      date,
      provider,
      ok: 0,
      error: 0,
      total: 0
    }
    cur.total += 1
    const status = String(event.status ?? '').trim()
    if (status === 'ok') cur.ok += 1
    else if (status === 'error') cur.error += 1
    map.set(key, cur)
  }

  const rows = Array.from(map.values()).sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return a.provider.localeCompare(b.provider)
  })

  return {
    rows,
    eventCount,
    oldestTimestamp,
    newestTimestamp
  }
}

/**
 * Phase 11-C: All UsageEvent provider × UTC-hour status facts (no evaluative labels).
 * Population: every event in the input list — with or without failoverId.
 * Independent of Failover Chain day buckets / Daily totals / Completeness re-judgment.
 */
export type UsageEventProviderHourlyStatus = {
  dateHour: string
  provider: string
  ok: number
  error: number
  total: number
}

export type UsageEventProviderHourlyAnalysis = {
  rows: UsageEventProviderHourlyStatus[]
  /** Phase 12-D A-2: API wiring population (month when month-filtered). */
  population?: 'month'
  /** Phase 12-D A-2: YYYY-MM when population is month. */
  month?: string
}

/**
 * Aggregate ok/error/total per (UTC dateHour × provider) across all UsageEvents.
 * Standalone over raw events; no chain grouping, no retention re-judgment.
 * Retention coverage remains usage_event_completeness (Phase 11-B).
 */
export function analyzeUsageEventProviderHourlyStatus(
  events: UsageEventLike[] | null | undefined
): UsageEventProviderHourlyAnalysis {
  const list = Array.isArray(events) ? events : []
  const map = new Map<string, UsageEventProviderHourlyStatus>()

  for (const event of list) {
    if (!event || typeof event !== 'object') continue

    const dateHour = parseUtcDateHour(event.timestamp)
    if (!dateHour) continue

    const provider = String(event.provider ?? '').trim() || '?'
    const key = `${dateHour}\0${provider}`
    const cur = map.get(key) ?? {
      dateHour,
      provider,
      ok: 0,
      error: 0,
      total: 0
    }
    cur.total += 1
    const status = String(event.status ?? '').trim()
    if (status === 'ok') cur.ok += 1
    else if (status === 'error') cur.error += 1
    map.set(key, cur)
  }

  const rows = Array.from(map.values()).sort((a, b) => {
    const hourCmp = a.dateHour.localeCompare(b.dateHour)
    if (hourCmp !== 0) return hourCmp
    return a.provider.localeCompare(b.provider)
  })

  return { rows }
}

/**
 * Phase 11-B / 12-C Completeness: Raw UsageEvent observation facts (not Health/Risk).
 * Population: API must pass allEvents (Raw retained), not month-filtered usageEvents.
 * Does not assert completeness-guarantee booleans.
 */
export type UsageEventCompleteness = {
  eventCount: number
  maxEvents: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  /** Cap fact only — true means eventCount hit maxEvents; false is not a completeness guarantee. */
  possiblyTruncated: boolean
  /** Raw retention day upper bound (fact). Not “7 days fully retained”. */
  retentionDays: number
  /** Input population label — Raw retained UsageEvents. */
  population: 'raw'
  /** Object events whose timestamp is empty or unparseable (still counted in eventCount). */
  invalidTimestampCount: number
  /** Valid timestamps with ms > nowMs (0 when nowMs not provided). Not an error label. */
  futureEventCount: number
}

/**
 * Fact layer for Raw UsageEvent observation coverage.
 * eventCount = object events in the input (attempt units; no Chain/Hop collapse).
 * possiblyTruncated := eventCount >= maxEvents (older events may have been dropped).
 * Invalid timestamps are not rewritten. Future timestamps remain in oldest/newest when present.
 */
export function analyzeUsageEventCompleteness(
  events: UsageEventLike[] | null | undefined,
  maxEvents: number,
  nowMs?: number,
  retentionDays: number = 7
): UsageEventCompleteness {
  const list = Array.isArray(events) ? events : []
  const cap = Number.isFinite(maxEvents) ? Math.max(0, Math.floor(maxEvents)) : 0
  const days = Number.isFinite(retentionDays) ? Math.max(0, Math.floor(retentionDays)) : 7
  const hasNow = typeof nowMs === 'number' && Number.isFinite(nowMs)
  let eventCount = 0
  let invalidTimestampCount = 0
  let futureEventCount = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    eventCount += 1

    const rawTs = String(event.timestamp ?? '').trim()
    if (!rawTs) {
      invalidTimestampCount += 1
      continue
    }
    const ms = Date.parse(normalizeTimestamp(rawTs))
    if (!Number.isFinite(ms)) {
      invalidTimestampCount += 1
      continue
    }
    if (hasNow && ms > (nowMs as number)) {
      futureEventCount += 1
    }
    if (ms < oldestMs) {
      oldestMs = ms
      oldestTimestamp = rawTs
    }
    if (ms > newestMs) {
      newestMs = ms
      newestTimestamp = rawTs
    }
  }

  return {
    eventCount,
    maxEvents: cap,
    oldestTimestamp,
    newestTimestamp,
    possiblyTruncated: eventCount >= cap && cap > 0,
    retentionDays: days,
    population: 'raw',
    invalidTimestampCount,
    futureEventCount
  }
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

export const ROLLING_WINDOW_1H_MS = 60 * 60 * 1000
export const ROLLING_WINDOW_24H_MS = 24 * 60 * 60 * 1000

/**
 * Phase 12-C: Rolling window facts over All UsageEvent Raw (not Health/Risk).
 * Population: input list as given (API must pass allEvents, not month-filtered).
 */
export type UsageEventRollingProviderStatus = {
  provider: string
  ok: number
  error: number
  total: number
}

export type UsageEventRollingWindow = {
  windowStart: number
  windowEnd: number
  eventCount: number
  ok: number
  error: number
  total: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  byProvider: UsageEventRollingProviderStatus[]
}

export type UsageEventProviderRolling = {
  population: 'raw'
  '1h': UsageEventRollingWindow
  '24h': UsageEventRollingWindow
}

/**
 * Aggregate UsageEvents in [nowMs - windowMs, nowMs] (inclusive).
 * Invalid / unparseable timestamps excluded. Future (ms > nowMs) excluded by windowEnd.
 * Does not call Chain / Hop / Final* helpers. Does not invent completeness guarantees.
 */
export function analyzeUsageEventRolling(
  events: UsageEventLike[] | null | undefined,
  windowMs: number,
  nowMs: number
): UsageEventRollingWindow {
  const list = Array.isArray(events) ? events : []
  const end = Number(nowMs)
  const span = Number.isFinite(windowMs) ? Math.max(0, Math.floor(windowMs)) : 0
  const start = end - span
  const map = new Map<string, UsageEventRollingProviderStatus>()
  let eventCount = 0
  let ok = 0
  let error = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    const rawTs = String(event.timestamp ?? '').trim()
    if (!rawTs) continue
    const ms = Date.parse(normalizeTimestamp(rawTs))
    if (!Number.isFinite(ms)) continue
    if (ms < start || ms > end) continue

    eventCount += 1
    if (ms < oldestMs) {
      oldestMs = ms
      oldestTimestamp = rawTs
    }
    if (ms > newestMs) {
      newestMs = ms
      newestTimestamp = rawTs
    }

    const provider = String(event.provider ?? '').trim() || '?'
    const cur = map.get(provider) ?? { provider, ok: 0, error: 0, total: 0 }
    cur.total += 1
    const status = String(event.status ?? '').trim()
    if (status === 'ok') {
      cur.ok += 1
      ok += 1
    } else if (status === 'error') {
      cur.error += 1
      error += 1
    }
    map.set(provider, cur)
  }

  const byProvider = Array.from(map.values()).sort((a, b) =>
    a.provider.localeCompare(b.provider)
  )

  return {
    windowStart: start,
    windowEnd: end,
    eventCount,
    ok,
    error,
    total: eventCount,
    oldestTimestamp,
    newestTimestamp,
    byProvider
  }
}

/** Build Rolling 1h + 24h sibling facts from the same All UsageEvent list. */
export function analyzeUsageEventProviderRolling(
  events: UsageEventLike[] | null | undefined,
  nowMs: number
): UsageEventProviderRolling {
  return {
    population: 'raw',
    '1h': analyzeUsageEventRolling(events, ROLLING_WINDOW_1H_MS, nowMs),
    '24h': analyzeUsageEventRolling(events, ROLLING_WINDOW_24H_MS, nowMs)
  }
}

/**
 * Phase 12-D B / 12-E A: provider × model observation facts (not Health/Risk).
 * Population: API must pass allEvents (Raw), not month-filtered usageEvents.
 * 1 UsageEvent = 1 provider attempt — no Chain/Hop/Final* / no dedupe.
 * Phase 12-E A: additive token / estimatedCost facts (stored values; no input+output recompute).
 */
export type UsageEventProviderModelStatus = {
  provider: string
  model: string
  ok: number
  error: number
  total: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  missingInputTokenCount: number
  missingOutputTokenCount: number
  missingTotalTokenCount: number
  missingEstimatedCostCount: number
}

export type UsageEventProviderModelAnalysis = {
  rows: UsageEventProviderModelStatus[]
  eventCount: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  population: 'raw'
}

/** Finite number only — does not treat missing/invalid as 0. Shared by Metrics / Provider×Model. */
function readFiniteMetric(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

/**
 * Aggregate ok/error/total and token/cost per (provider × model) across input UsageEvents.
 * Invalid timestamps excluded from oldest/newest only (events still counted).
 * Does not recompute totalTokens from input+output; uses stored totalTokens.
 */
export function analyzeUsageEventProviderModelStatus(
  events: UsageEventLike[] | null | undefined
): UsageEventProviderModelAnalysis {
  const list = Array.isArray(events) ? events : []
  const map = new Map<string, UsageEventProviderModelStatus>()
  let eventCount = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    eventCount += 1

    const provider = String(event.provider ?? '').trim() || '?'
    const model = String(event.model ?? '').trim() || '?'
    const key = `${provider}\0${model}`
    const cur = map.get(key) ?? {
      provider,
      model,
      ok: 0,
      error: 0,
      total: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      missingInputTokenCount: 0,
      missingOutputTokenCount: 0,
      missingTotalTokenCount: 0,
      missingEstimatedCostCount: 0
    }
    cur.total += 1
    const status = String(event.status ?? '').trim()
    if (status === 'ok') cur.ok += 1
    else if (status === 'error') cur.error += 1

    const inTok = readFiniteMetric(event.inputTokens)
    if (inTok === null) cur.missingInputTokenCount += 1
    else cur.inputTokens += inTok

    const outTok = readFiniteMetric(event.outputTokens)
    if (outTok === null) cur.missingOutputTokenCount += 1
    else cur.outputTokens += outTok

    const totTok = readFiniteMetric(event.totalTokens)
    if (totTok === null) cur.missingTotalTokenCount += 1
    else cur.totalTokens += totTok

    const cost = readFiniteMetric(event.estimatedCost)
    if (cost === null) cur.missingEstimatedCostCount += 1
    else cur.estimatedCost += cost

    map.set(key, cur)

    const rawTs = String(event.timestamp ?? '').trim()
    if (!rawTs) continue
    const ms = Date.parse(normalizeTimestamp(rawTs))
    if (!Number.isFinite(ms)) continue
    if (ms < oldestMs) {
      oldestMs = ms
      oldestTimestamp = rawTs
    }
    if (ms > newestMs) {
      newestMs = ms
      newestTimestamp = rawTs
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => {
    const p = a.provider.localeCompare(b.provider)
    if (p !== 0) return p
    return a.model.localeCompare(b.model)
  })

  return {
    rows,
    eventCount,
    oldestTimestamp,
    newestTimestamp,
    population: 'raw'
  }
}

/**
 * Phase 12-D D: token / estimatedCost observation facts (not evaluative labels).
 * Population: API must pass allEvents (Raw). Does not recompute totalTokens from input+output.
 * Invalid / missing numeric values are not coerced to 0 in the sum — counted as missing*.
 */
export type UsageEventUsageMetricsProvider = {
  provider: string
  eventCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  missingInputTokenCount: number
  missingOutputTokenCount: number
  missingTotalTokenCount: number
  missingEstimatedCostCount: number
}

export type UsageEventUsageMetrics = {
  population: 'raw'
  retentionDays: number
  eventCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  missingInputTokenCount: number
  missingOutputTokenCount: number
  missingTotalTokenCount: number
  missingEstimatedCostCount: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  byProvider: UsageEventUsageMetricsProvider[]
}

export function analyzeUsageEventUsageMetrics(
  events: UsageEventLike[] | null | undefined,
  retentionDays: number = 7
): UsageEventUsageMetrics {
  const list = Array.isArray(events) ? events : []
  const days = Number.isFinite(retentionDays) ? Math.max(0, Math.floor(retentionDays)) : 7
  const map = new Map<string, UsageEventUsageMetricsProvider>()
  let eventCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let estimatedCost = 0
  let missingInputTokenCount = 0
  let missingOutputTokenCount = 0
  let missingTotalTokenCount = 0
  let missingEstimatedCostCount = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    eventCount += 1

    const provider = String(event.provider ?? '').trim() || '?'
    const cur = map.get(provider) ?? {
      provider,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      missingInputTokenCount: 0,
      missingOutputTokenCount: 0,
      missingTotalTokenCount: 0,
      missingEstimatedCostCount: 0
    }
    cur.eventCount += 1

    const inTok = readFiniteMetric(event.inputTokens)
    if (inTok === null) {
      missingInputTokenCount += 1
      cur.missingInputTokenCount += 1
    } else {
      inputTokens += inTok
      cur.inputTokens += inTok
    }

    const outTok = readFiniteMetric(event.outputTokens)
    if (outTok === null) {
      missingOutputTokenCount += 1
      cur.missingOutputTokenCount += 1
    } else {
      outputTokens += outTok
      cur.outputTokens += outTok
    }

    const totTok = readFiniteMetric(event.totalTokens)
    if (totTok === null) {
      missingTotalTokenCount += 1
      cur.missingTotalTokenCount += 1
    } else {
      totalTokens += totTok
      cur.totalTokens += totTok
    }

    const cost = readFiniteMetric(event.estimatedCost)
    if (cost === null) {
      missingEstimatedCostCount += 1
      cur.missingEstimatedCostCount += 1
    } else {
      estimatedCost += cost
      cur.estimatedCost += cost
    }

    map.set(provider, cur)

    const rawTs = String(event.timestamp ?? '').trim()
    if (!rawTs) continue
    const ms = Date.parse(normalizeTimestamp(rawTs))
    if (!Number.isFinite(ms)) continue
    if (ms < oldestMs) {
      oldestMs = ms
      oldestTimestamp = rawTs
    }
    if (ms > newestMs) {
      newestMs = ms
      newestTimestamp = rawTs
    }
  }

  const byProvider = Array.from(map.values()).sort((a, b) =>
    a.provider.localeCompare(b.provider)
  )

  return {
    population: 'raw',
    retentionDays: days,
    eventCount,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    missingInputTokenCount,
    missingOutputTokenCount,
    missingTotalTokenCount,
    missingEstimatedCostCount,
    oldestTimestamp,
    newestTimestamp,
    byProvider
  }
}

/**
 * Phase 12-E B: billingMode observation facts (not evaluative labels).
 * Population: API must pass allEvents (Raw). Keys use billingModeForUi only
 * (BYOK | DEVELOPMENT). ORGANIZATION / MANAGED / null / other → missingBillingModeCount.
 * 1 UsageEvent = 1 provider attempt — no Chain/Hop/Final* / no credentialId keying.
 */
export type UsageEventBillingModeRow = {
  billingMode: 'BYOK' | 'DEVELOPMENT'
  total: number
}

export type UsageEventBillingModeProviderRow = {
  billingMode: 'BYOK' | 'DEVELOPMENT'
  provider: string
  total: number
}

export type UsageEventBillingModeAnalysis = {
  population: 'raw'
  retentionDays: number
  eventCount: number
  missingBillingModeCount: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  rows: UsageEventBillingModeRow[]
  byBillingModeProvider: UsageEventBillingModeProviderRow[]
}

export function analyzeUsageEventBillingMode(
  events: UsageEventLike[] | null | undefined,
  retentionDays: number = 7
): UsageEventBillingModeAnalysis {
  const list = Array.isArray(events) ? events : []
  const days = Number.isFinite(retentionDays) ? Math.max(0, Math.floor(retentionDays)) : 7
  const modeMap = new Map<'BYOK' | 'DEVELOPMENT', UsageEventBillingModeRow>()
  const crossMap = new Map<string, UsageEventBillingModeProviderRow>()
  let eventCount = 0
  let missingBillingModeCount = 0
  let oldestTimestamp: string | null = null
  let newestTimestamp: string | null = null
  let oldestMs = Number.POSITIVE_INFINITY
  let newestMs = Number.NEGATIVE_INFINITY

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    eventCount += 1

    const mode = billingModeForUi(event.billingMode)
    if (mode === null) {
      missingBillingModeCount += 1
    } else {
      const cur = modeMap.get(mode) ?? { billingMode: mode, total: 0 }
      cur.total += 1
      modeMap.set(mode, cur)

      const provider = String(event.provider ?? '').trim() || '?'
      const key = `${mode}\0${provider}`
      const cross = crossMap.get(key) ?? {
        billingMode: mode,
        provider,
        total: 0
      }
      cross.total += 1
      crossMap.set(key, cross)
    }

    const rawTs = String(event.timestamp ?? '').trim()
    if (!rawTs) continue
    const ms = Date.parse(normalizeTimestamp(rawTs))
    if (!Number.isFinite(ms)) continue
    if (ms < oldestMs) {
      oldestMs = ms
      oldestTimestamp = rawTs
    }
    if (ms > newestMs) {
      newestMs = ms
      newestTimestamp = rawTs
    }
  }

  const rows = Array.from(modeMap.values()).sort((a, b) =>
    a.billingMode.localeCompare(b.billingMode)
  )
  const byBillingModeProvider = Array.from(crossMap.values()).sort((a, b) => {
    const m = a.billingMode.localeCompare(b.billingMode)
    if (m !== 0) return m
    return a.provider.localeCompare(b.provider)
  })

  return {
    population: 'raw',
    retentionDays: days,
    eventCount,
    missingBillingModeCount,
    oldestTimestamp,
    newestTimestamp,
    rows,
    byBillingModeProvider
  }
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
