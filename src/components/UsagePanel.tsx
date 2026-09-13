import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_COST_LIMITS,
  ENGINE_LABELS,
  USAGE_ENGINE_KEYS,
  USER_PLAN_LABELS,
  parseUserPlan,
  type ProviderEngine
} from '../lib/llmModels'
import {
  currentUsageMonth,
  dismissRouterHintCode,
  filterVisibleRouterHints,
  loadDismissedRouterHintCodes
} from '../lib/routerHintDismiss'
import './UsagePanel.css'

type EngineUsage = {
  spent: number
  limit: number
  remaining: number
  requests?: number
  input_tokens?: number
  output_tokens?: number
}

type ModelUsage = {
  engine: string
  model: string
  spent: number
  requests: number
  input_tokens: number
  output_tokens: number
}

type RouteHint = {
  code?: string
  level: string
  text: string
}

type RouteEngineStat = {
  engine: string
  count: number
  estimated_usd: number
}

type RouteTaskStat = {
  task_type: string
  engine: string
  count: number
}

type RouteRecent = {
  id: number
  engine: string
  task_type: string
  mode: string
  model: string | null
  estimated_usd: number
  fallback_from: string | null
  fallback_reason: string | null
  created_at: string
  /** From Electron usage events. BYOK or DEVELOPMENT when known. */
  billingMode?: 'BYOK' | 'DEVELOPMENT' | null
  /** From Electron usage events only. Never invent; never a secret. */
  credentialId?: string | null
  /** Router Failover trail (providers / reason). Distinct from PHP fallback_from. */
  routerFailover?: {
    primaryProvider: string
    fallbackProvider?: string | null
    reason?: string | null
    attempt?: number
    failoverId?: string | null
    path?: string[] | null
    mode?: 'ask' | 'agent' | null
  } | null
}

/**
 * Phase 4-B: display whitelist for chain hops (no credentialId / billingMode).
 * Runtime payloads may include extra fields — UI must not render them.
 */
type FailoverChainHopView = {
  provider: string
  status: string
  attempt: number
  reason: string | null
  mode: 'ask' | 'agent' | null
  timestamp: string
}

/** Derived Router Failover chain (failoverId group). Not PHP fallback. */
type FailoverChainSummaryRow = {
  failoverId: string
  mode?: 'ask' | 'agent' | null
  path: string[]
  providers: string[]
  reasons: string[]
  statuses?: string[]
  finalStatus?: string
  finalReason?: string | null
  /**
   * Phase 6-B/6-C: Core-generated final success attribution.
   * Display only — never infer from hops[].
   */
  finalSuccessProvider?: string | null
  /**
   * Phase 7-B/7-C: Core-generated final failure attribution.
   * Display only — never infer from hops[].
   */
  finalFailedProvider?: string | null
  /** Phase 4-B: hop details from API summary (display only). */
  hops?: FailoverChainHopView[] | null
}

/** Mirror of Phase 3-A FailoverChainAnalysis (display only; no re-analysis). */
type FailoverChainAnalysisView = {
  totalChains: number
  successfulChains: number
  exhaustedChains: number
  successRate: number | null
  rescuedChains: number
  rescueRate: number | null
  hopDistribution: {
    one: number
    two: number
    three: number
    fourPlus: number
  }
  averageHops: number | null
  maxHops: number
  byMode: {
    ask: number
    agent: number
    unknown: number
  }
  byProvider: Array<{
    provider: string
    hops: number
    errors: number
    oks: number
  }>
  byReason: Array<{
    reason: string
    count: number
  }>
  /**
   * Phase 6-B/6-C: chain-level final success counts (not byProvider.oks).
   * Display only — never recompute in panel.
   */
  finalSuccessProviderCounts?: Array<{
    provider: string
    count: number
  }> | null
  /**
   * Phase 7-B/7-C: chain-level final failure counts (not byProvider.errors).
   * Display only — never recompute in panel.
   */
  finalFailedProviderCounts?: Array<{
    provider: string
    count: number
  }> | null
  /**
   * Phase 7-B/7-C: adjacent reason transitions from Core analysis.
   * Display only — never recompute from reasons[] in panel.
   */
  reasonTransitions?: Array<{
    from: string
    to: string
    count: number
  }> | null
  /**
   * Phase 8-B: Core daily chain facts (display only; not Health/Risk).
   */
  dailyBuckets?: Array<{
    date: string
    chainCount: number
    successfulCount: number
    exhaustedCount: number
  }> | null
}

/**
 * Phase 9-B/9-C: All UsageEvent provider status (display only).
 * Separate population from Failover Analysis — not Health/Risk.
 */
type UsageEventProviderStatusRow = {
  provider: string
  ok: number
  error: number
  total: number
}

/**
 * Phase 10-B: All UsageEvent provider × day status (display only).
 * Sibling of usage_event_provider_status — not Failover dailyBuckets / Health.
 */
type UsageEventProviderDailyStatusRow = {
  date: string
  provider: string
  ok: number
  error: number
  total: number
}

type UsageEventProviderDailyAnalysisView = {
  rows: UsageEventProviderDailyStatusRow[]
  eventCount: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
}

/**
 * Phase 11-C: All UsageEvent provider × UTC-hour status (display only).
 * Sibling of daily / completeness — not Failover dailyBuckets / Health / Rolling.
 */
type UsageEventProviderHourlyStatusRow = {
  dateHour: string
  provider: string
  ok: number
  error: number
  total: number
}

type UsageEventProviderHourlyAnalysisView = {
  rows: UsageEventProviderHourlyStatusRow[]
}

/**
 * Phase 12-B: Persistent Daily Aggregate (display only).
 * Long-term All UsageEvent facts — not Raw-derived daily / not Health.
 */
type UsageEventProviderDailyRetainedView = {
  rows: UsageEventProviderDailyStatusRow[]
  oldestDate: string | null
  newestDate: string | null
  dayCount: number
}

/**
 * Phase 11-B: All UsageEvent retention completeness (display only).
 * Not Health/Risk — retention-cap facts from Core.
 */
type UsageEventCompletenessView = {
  eventCount: number
  maxEvents: number
  oldestTimestamp: string | null
  newestTimestamp: string | null
  possiblyTruncated: boolean
}

type RouterInsight = {
  total: number
  fallbacks: number
  fallback_rate: number
  /** Electron Router Failover chains (unique failoverId). Not PHP fallbacks. */
  router_failover_chains?: number
  /** Read-time chain summaries grouped by failoverId. */
  router_failover_chain_summaries?: FailoverChainSummaryRow[]
  /** Phase 3-A read-time analysis from summaries. Display only in panel. */
  router_failover_analysis?: FailoverChainAnalysisView | null
  /**
   * Phase 9-B/9-C: All UsageEvent provider status from Core.
   * Sibling of router_failover_analysis — never nest or recompute in panel.
   */
  usage_event_provider_status?: UsageEventProviderStatusRow[] | null
  /**
   * Phase 10-B: All UsageEvent provider × UTC-day status from Core.
   * Sibling of usage_event_provider_status / router_failover_analysis.
   */
  usage_event_provider_daily?: UsageEventProviderDailyAnalysisView | null
  /**
   * Phase 11-C: All UsageEvent provider × UTC-hour status from Core.
   * Sibling field — never recompute hourly buckets in panel.
   */
  usage_event_provider_hourly?: UsageEventProviderHourlyAnalysisView | null
  /**
   * Phase 12-B: Persistent Daily Aggregate (long-term All UsageEvent facts).
   * Sibling of Raw-derived usage_event_provider_daily — never mix or recompute.
   */
  usage_event_provider_daily_retained?: UsageEventProviderDailyRetainedView | null
  /**
   * Phase 11-B: All UsageEvent retention completeness from Core.
   * Sibling field — never recompute possiblyTruncated in panel.
   */
  usage_event_completeness?: UsageEventCompletenessView | null
  by_engine: RouteEngineStat[]
  by_task: RouteTaskStat[]
  recent: RouteRecent[]
  hints: RouteHint[]
  month?: string
  recent_total?: number
}

type FeedbackSummary = {
  windowDays: number
  searches: number
  searchWithHits: number
  editsQueued: number
  editsRejected: number
  emptyToolRetries: number
  verifyIncomplete: number
  verifyPass: number
  agentRuns: number
  agentTopHit: number
  agentTopHitRate: number | null
  readRequired: number
}

type UsagePayload = {
  month: string
  router_month?: string
  total: {
    spent: number
    limit: number
    remaining: number
    requests: number
  }
  user?: {
    plan: string
    spent: number
    limit: number
    remaining: number
    pct?: number
    level?: string
  }
  usage: Record<string, EngineUsage>
  models: ModelUsage[]
  router?: RouterInsight
  feedback?: FeedbackSummary
  claude_prepaid?: {
    tracking: boolean
    remaining: number | null
    warn_at: number
    depleted?: boolean
    low?: boolean
  }
  note?: string
}

type Props = {
  open: boolean
  backendConnected: boolean
  variant?: 'overlay' | 'dock'
  width?: number
  onClose: () => void
  onOpenSettings?: () => void
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function percent(spent: number, limit: number): number {
  if (limit <= 0) return spent > 0 ? 100 : 0
  return Math.min(100, Math.round((spent / limit) * 1000) / 10)
}

function formatBillingMode(mode: RouteRecent['billingMode']): string {
  if (mode === 'BYOK') return 'BYOK'
  if (mode === 'DEVELOPMENT') return 'DEVELOPMENT'
  return '—'
}

/** Shorten credentialId for table; full value in title. Never show secrets. */
function formatCredentialId(id: RouteRecent['credentialId']): string {
  const raw = String(id || '').trim()
  if (!raw) return '—'
  if (raw.startsWith('dev:')) return raw
  if (raw.length <= 18) return raw
  return `${raw.slice(0, 10)}…${raw.slice(-4)}`
}

/** Router Failover display; empty when no provider switch. Never secrets. */
function formatRouterFailover(row: RouteRecent): string {
  const f = row.routerFailover
  if (!f?.primaryProvider) return ''
  const path = Array.isArray(f.path) ? f.path.filter((p) => String(p || '').trim()) : null
  const switched =
    (path && path.length > 1) ||
    Boolean(f.fallbackProvider) ||
    (typeof f.attempt === 'number' && f.attempt > 1)
  if (!switched) return ''
  const base =
    path && path.length > 1
      ? path.join('→')
      : `${f.primaryProvider}→${f.fallbackProvider || row.engine}`
  const modeTag = f.mode === 'agent' ? ' [agent]' : f.mode === 'ask' ? ' [ask]' : ''
  return f.reason ? `${base} (${f.reason})${modeTag}` : `${base}${modeTag}`
}

function engineDisplayName(engine: string): string {
  return ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS] ?? engine
}

/** Display-only: provider path from API Chain summary (no regrouping). */
function formatChainProviders(chain: FailoverChainSummaryRow): string {
  const path =
    Array.isArray(chain.path) && chain.path.length > 0
      ? chain.path
      : Array.isArray(chain.providers)
        ? chain.providers
        : []
  return path
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map(engineDisplayName)
    .join(' → ')
}

/** Display-only: reason path from API Chain summary (no regrouping). */
function formatChainReasons(chain: FailoverChainSummaryRow): string {
  return (Array.isArray(chain.reasons) ? chain.reasons : [])
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .join(' → ')
}

/** Phase 5-B: Summary statuses[] as-is (do not rebuild from hops). */
function formatChainStatuses(chain: FailoverChainSummaryRow): string {
  return (Array.isArray(chain.statuses) ? chain.statuses : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' → ')
}

/** Phase 4-B: safe hop list from summary (no regroup / re-analysis). */
function resolveChainHops(
  chain: FailoverChainSummaryRow
): FailoverChainHopView[] {
  return Array.isArray(chain.hops) ? chain.hops : []
}

/** Display-only hop field → em dash when empty. */
function formatHopText(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return raw || '—'
}

/** Display-only hop attempt (recorded value; never recalculate). */
function formatHopAttempt(value: number | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return '—'
}

/** Display-only attempt label (#N); value still from hop.attempt. */
function formatHopAttemptLabel(value: number | null | undefined): string {
  const raw = formatHopAttempt(value)
  return raw === '—' ? '—' : `#${raw}`
}

/** Display-only hop mode (null stays —; do not remap to unknown). */
function formatHopMode(mode: FailoverChainHopView['mode']): string {
  if (mode === 'ask' || mode === 'agent') return mode
  return '—'
}

/** Display-only hop timestamp (format only; never rebuild chains). */
function formatHopTimestamp(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return raw
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return raw
  }
}

/** Phase 5-A: Summary finalStatus as-is (no hop re-judgment). */
function formatChainFinalStatus(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return raw || '—'
}

/** Phase 5-A: Summary finalReason as-is (null/empty → —). */
function formatChainFinalReason(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return raw || '—'
}

/**
 * Phase 6-C: display Core finalSuccessProvider as-is (null/empty → —).
 * Never infer from hops[].
 */
function formatChainFinalSuccessProvider(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  return engineDisplayName(raw)
}

/**
 * Phase 7-C: display Core finalFailedProvider as-is (null/empty → —).
 * Never infer from hops[].
 */
function formatChainFinalFailedProvider(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  return engineDisplayName(raw)
}

/**
 * Phase 2-C-7: Single Source — display API summaries only (no Chain regrouping).
 * Legacy/external payloads without summaries → empty (do not invent chains from recent).
 */
function resolveFailoverChains(router: RouterInsight): FailoverChainSummaryRow[] {
  const fromApi = router.router_failover_chain_summaries
  if (!Array.isArray(fromApi)) return []
  return fromApi.filter((c) => String(c?.failoverId || '').trim())
}

/** Display-only rate format for Phase 3-A analysis (no recalculation). */
function formatFailoverRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 1000) / 10}%`
}

/** Display-only average hops (null → —). */
function formatAverageHops(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 100) / 100)
}

/**
 * Phase 4-A display-only: errors/hops for one Provider row.
 * Not Chain/API re-analysis. hops===0 → —.
 */
function formatProviderErrorRate(errors: number, hops: number): string {
  const h = Number(hops) || 0
  if (h <= 0) return '—'
  const e = Number(errors) || 0
  return `${Math.round((e / h) * 1000) / 10}%`
}

/** Phase 4-A display-only bar width from a row value vs max (0–100). */
function relativeBarWidth(value: number, max: number): number {
  const v = Number(value) || 0
  const m = Number(max) || 0
  if (m <= 0 || v <= 0) return 0
  return Math.min(100, Math.round((v / m) * 1000) / 10)
}

/**
 * Phase 8-B: display-only order for Final Failed facts (count desc).
 * Does not recompute counts — sorts Core rows only.
 */
function sortFinalFailedCountsForDisplay(
  rows: Array<{ provider: string; count: number }> | null | undefined
): Array<{ provider: string; count: number }> {
  if (!Array.isArray(rows)) return []
  return [...rows].sort((a, b) => {
    const countCmp = (Number(b.count) || 0) - (Number(a.count) || 0)
    if (countCmp !== 0) return countCmp
    return String(a.provider || '').localeCompare(String(b.provider || ''))
  })
}

const LLM_ENGINES = new Set(['openai', 'gemini', 'claude', 'workers'])
const RECENT_PAGE_SIZE = 20

function listRecentMonthOptions(now = new Date(), count = 12): string[] {
  const months: string[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let i = 0; i < count; i += 1) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    months.push(`${y}-${m}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return months
}

/**
 * Fill missing billingMode from BYOK list when Main enrichment is absent.
 * Never invent or overwrite credentialId (event-backed only).
 */
async function attachBillingModes(payload: UsagePayload): Promise<UsagePayload> {
  const recent = payload.router?.recent
  if (!recent?.length) return payload
  const needsFill = recent.some(
    (row) => row.billingMode !== 'BYOK' && row.billingMode !== 'DEVELOPMENT'
  )
  if (!needsFill) return payload

  const byokEngines = new Set<string>()
  try {
    if (typeof window.saforall.listByokCredentials === 'function') {
      const listed = await window.saforall.listByokCredentials()
      if (listed.ok && Array.isArray(listed.credentials)) {
        for (const row of listed.credentials) {
          if (row.configured) byokEngines.add(String(row.providerId).toLowerCase())
        }
      }
    }
  } catch {
    // keep DEVELOPMENT fallback
  }

  return {
    ...payload,
    router: payload.router
      ? {
          ...payload.router,
          recent: recent.map((row) => {
            if (row.billingMode === 'BYOK' || row.billingMode === 'DEVELOPMENT') return row
            const engine = String(row.engine || '').toLowerCase()
            if (!LLM_ENGINES.has(engine)) return { ...row, billingMode: null }
            return {
              ...row,
              billingMode: byokEngines.has(engine) ? 'BYOK' : 'DEVELOPMENT'
              // credentialId unchanged (spread row); never invent from vault
            }
          })
        }
      : payload.router
  }
}

function barClass(pct: number): string {
  if (pct >= 95) return 'usage-bar-fill danger'
  if (pct >= 85) return 'usage-bar-fill danger'
  if (pct >= 70) return 'usage-bar-fill warn'
  return 'usage-bar-fill'
}

export function UsagePanel({
  open,
  backendConnected,
  variant = 'overlay',
  width = 320,
  onClose,
  onOpenSettings
}: Props) {
  const [data, setData] = useState<UsagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [routerMonth, setRouterMonth] = useState(() => currentUsageMonth())
  const [recentVisible, setRecentVisible] = useState(RECENT_PAGE_SIZE)
  const usageMonth = data?.month?.slice(0, 7) || currentUsageMonth()
  const monthOptions = useMemo(() => listRecentMonthOptions(), [])
  const [dismissedHintCodes, setDismissedHintCodes] = useState<string[]>(() =>
    loadDismissedRouterHintCodes(currentUsageMonth())
  )

  useEffect(() => {
    setDismissedHintCodes(loadDismissedRouterHintCodes(usageMonth))
  }, [usageMonth])

  const visibleRouterHints = useMemo(() => {
    if (!data?.router?.hints) return []
    return filterVisibleRouterHints(data.router.hints, dismissedHintCodes)
  }, [data?.router?.hints, dismissedHintCodes])

  const failoverChains = useMemo(() => {
    if (!data?.router) return []
    return resolveFailoverChains(data.router)
  }, [data?.router])

  /** Phase 3-B: display API analysis only (no re-analysis / regroup). */
  const failoverAnalysis = data?.router?.router_failover_analysis ?? null

  /** Phase 9-C: Core All UsageEvent status — display only (not Failover Analysis). */
  const usageEventProviderStatus = Array.isArray(
    data?.router?.usage_event_provider_status
  )
    ? data.router.usage_event_provider_status
    : null
  const usageEventProviderTotalMax = usageEventProviderStatus
    ? Math.max(0, ...usageEventProviderStatus.map((row) => Number(row.total) || 0))
    : 0

  /** Phase 10-B: Core All UsageEvent daily status — display only. */
  const usageEventProviderDaily =
    data?.router?.usage_event_provider_daily &&
    typeof data.router.usage_event_provider_daily === 'object'
      ? data.router.usage_event_provider_daily
      : null
  const usageEventProviderDailyRows = Array.isArray(usageEventProviderDaily?.rows)
    ? usageEventProviderDaily.rows
    : null

  /** Phase 11-C: Core All UsageEvent hourly status — display only. */
  const usageEventProviderHourly =
    data?.router?.usage_event_provider_hourly &&
    typeof data.router.usage_event_provider_hourly === 'object'
      ? data.router.usage_event_provider_hourly
      : null
  const usageEventProviderHourlyRows = Array.isArray(usageEventProviderHourly?.rows)
    ? usageEventProviderHourly.rows
    : null

  /** Phase 12-B: Persistent Daily Aggregate — display only. */
  const usageEventProviderDailyRetained =
    data?.router?.usage_event_provider_daily_retained &&
    typeof data.router.usage_event_provider_daily_retained === 'object'
      ? data.router.usage_event_provider_daily_retained
      : null
  const usageEventProviderDailyRetainedRows = Array.isArray(
    usageEventProviderDailyRetained?.rows
  )
    ? usageEventProviderDailyRetained.rows
    : null

  /** Phase 11-B: Core retention completeness — display only (not Health). */
  const usageEventCompleteness =
    data?.router?.usage_event_completeness &&
    typeof data.router.usage_event_completeness === 'object'
      ? data.router.usage_event_completeness
      : null

  // Phase 4-A display-only maxima for relative bars (not Chain re-aggregation).
  const providerHopMax = Array.isArray(failoverAnalysis?.byProvider)
    ? Math.max(0, ...failoverAnalysis.byProvider.map((row) => Number(row.hops) || 0))
    : 0
  const reasonCountMax = Array.isArray(failoverAnalysis?.byReason)
    ? Math.max(0, ...failoverAnalysis.byReason.map((row) => Number(row.count) || 0))
    : 0
  const finalSuccessCountMax = Array.isArray(failoverAnalysis?.finalSuccessProviderCounts)
    ? Math.max(
        0,
        ...failoverAnalysis.finalSuccessProviderCounts.map((row) => Number(row.count) || 0)
      )
    : 0
  const finalFailedCountMax = Array.isArray(failoverAnalysis?.finalFailedProviderCounts)
    ? Math.max(
        0,
        ...failoverAnalysis.finalFailedProviderCounts.map((row) => Number(row.count) || 0)
      )
    : 0
  const reasonTransitionCountMax = Array.isArray(failoverAnalysis?.reasonTransitions)
    ? Math.max(
        0,
        ...failoverAnalysis.reasonTransitions.map((row) => Number(row.count) || 0)
      )
    : 0
  const modeCountMax = failoverAnalysis?.byMode
    ? Math.max(
        Number(failoverAnalysis.byMode.ask) || 0,
        Number(failoverAnalysis.byMode.agent) || 0,
        Number(failoverAnalysis.byMode.unknown) || 0
      )
    : 0

  const dismissHint = (code: string | undefined) => {
    if (!code) return
    setDismissedHintCodes(dismissRouterHintCode(usageMonth, code))
  }

  const load = useCallback(async () => {
    if (!backendConnected) {
      setError('接続がないため使用量を取得できません。ステータスバーから再確認してください')
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.saforall.request<UsagePayload>(
        'GET',
        `/ai/usage?month=${encodeURIComponent(routerMonth)}`
      )
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? '使用量の取得に失敗しました')
        setData(null)
        return
      }
      setData(await attachBillingModes(result.data))
      setRecentVisible(RECENT_PAGE_SIZE)
    } catch (err) {
      setError(String(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [backendConnected, routerMonth])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  if (!open) return null

  const totalSpent = data?.total.spent ?? 0
  const totalLimit = data?.total.limit ?? 0
  const totalPct = percent(totalSpent, totalLimit)

  const body = (
      <div
        className={`usage-panel${variant === 'dock' ? ' usage-panel--dock' : ''}`}
        style={variant === 'dock' ? { width } : undefined}
      >
        <div className="usage-header">
          <div>
            <h2>AI 使用量</h2>
            <p className="usage-subtitle">
              {data?.month ? `${data.month} の概算` : '今月の概算'}
              {loading ? ' · 更新中…' : ''}
            </p>
          </div>
          <div className="usage-header-actions">
            <button type="button" onClick={() => void load()} disabled={loading}>
              更新
            </button>
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>

        {!backendConnected && (
          <p className="usage-warning">
            接続がないため使用量を表示できません。ローカルモードならアプリ再起動後に再確認してください。
          </p>
        )}
        {error && <p className="usage-error">{error}</p>}

        {data && (
          <>
            <section className="usage-total">
              <div className="usage-total-row">
                <strong>合計（今月・Provider）</strong>
                <span>
                  {formatUsd(totalSpent)} / {formatUsd(totalLimit)}
                  <span className="usage-muted"> · 残 {formatUsd(data.total.remaining)}</span>
                </span>
              </div>
              <div className="usage-bar-track" title={`${totalPct}%`}>
                <div className={barClass(totalPct)} style={{ width: `${totalPct}%` }} />
              </div>
              <div className="usage-total-meta">
                リクエスト {data.total.requests.toLocaleString()} 回 · 使用率 {totalPct}%
              </div>
              {(() => {
                const ranked = USAGE_ENGINE_KEYS.map((key) => ({
                  key,
                  spent: data.usage[key]?.spent ?? 0
                }))
                  .filter((row) => row.spent > 0)
                  .sort((a, b) => b.spent - a.spent)
                const top = ranked[0]
                if (!top) {
                  return (
                    <p className="usage-summary-line">
                      まだ課金概算はありません。チャットを使うとエンジン別に積み上がります。
                    </p>
                  )
                }
                return (
                  <p className="usage-summary-line">
                    いま一番使っているのは <strong>{ENGINE_LABELS[top.key] ?? top.key}</strong>
                    （{formatUsd(top.spent)}）
                    {ranked.length > 1
                      ? ` · ついで ${ENGINE_LABELS[ranked[1].key] ?? ranked[1].key}`
                      : ''}
                  </p>
                )
              })()}
            </section>

            {data.user && (
              <section className="usage-total">
                <div className="usage-total-row">
                  <strong>
                    ユーザープラン（
                    {USER_PLAN_LABELS[parseUserPlan(data.user.plan)] ?? data.user.plan}）
                  </strong>
                  <span>
                    {formatUsd(data.user.spent)} / {formatUsd(data.user.limit)}
                    <span className="usage-muted"> · 残 {formatUsd(data.user.remaining)}</span>
                  </span>
                </div>
                <div
                  className="usage-bar-track"
                  title={`${percent(data.user.spent, data.user.limit)}%`}
                >
                  <div
                    className={barClass(percent(data.user.spent, data.user.limit))}
                    style={{ width: `${percent(data.user.spent, data.user.limit)}%` }}
                  />
                </div>
              </section>
            )}

            <section className="usage-total">
              <div className="usage-total-row">
                <strong>Anthropic チャージ残（手入力）</strong>
                <span>
                  {data.claude_prepaid?.tracking && data.claude_prepaid.remaining != null
                    ? formatUsd(data.claude_prepaid.remaining)
                    : '未設定'}
                </span>
              </div>
              {data.claude_prepaid?.tracking && data.claude_prepaid.remaining != null ? (
                <>
                  {(() => {
                    const rem = data.claude_prepaid!.remaining as number
                    const warn = data.claude_prepaid!.warn_at
                    const scale = Math.max(warn * 5, rem, 5)
                    const leftPct = Math.max(0, Math.min(100, (rem / scale) * 100))
                    const usedPct = rem <= 0 ? 100 : Math.max(0, 100 - leftPct)
                    return (
                      <div
                        className="usage-bar-track"
                        title={rem <= 0 ? '枯渇' : rem <= warn ? '残少' : 'OK'}
                      >
                        <div className={barClass(usedPct)} style={{ width: `${usedPct}%` }} />
                      </div>
                    )
                  })()}
                  <p className="usage-summary-line">
                    {data.claude_prepaid.remaining <= 0
                      ? '残高 0 — Auto は Claude を避けます。設定の予算でチャージ後の残りを入力してください。'
                      : data.claude_prepaid.remaining <= data.claude_prepaid.warn_at
                        ? `警告しきい値（$${data.claude_prepaid.warn_at}）以下です。Anthropic Console を確認してください。`
                        : 'Claude 利用のたびに概算で減ります（公式残高APIはないため近似です）。'}
                  </p>
                </>
              ) : (
                <p className="usage-summary-line">
                  設定 → 予算 で「Anthropic チャージ残」を入れると、切れる前に警告できます。
                  {onOpenSettings && (
                    <>
                      {' '}
                      <button type="button" className="usage-link-btn" onClick={onOpenSettings}>
                        設定を開く
                      </button>
                    </>
                  )}
                </p>
              )}
            </section>

            {data.feedback && (
              <section className="usage-feedback">
                <h3>検索 / Agent フィードバック（{data.feedback.windowDays}日）</h3>
                <p className="usage-summary-line">
                  検索 {data.feedback.searches} 回
                  {data.feedback.searches > 0
                    ? `（ヒット ${data.feedback.searchWithHits}）`
                    : ''}
                  {' · '}
                  編集キュー {data.feedback.editsQueued}
                  {data.feedback.editsRejected > 0
                    ? ` / 却下 ${data.feedback.editsRejected}`
                    : ''}
                </p>
                <p className="usage-summary-line">
                  Agent 完了 {data.feedback.agentRuns} 回
                  {data.feedback.agentTopHitRate != null
                    ? ` · topヒット率 ${data.feedback.agentTopHitRate}%`
                    : ''}
                  {' · '}
                  verify 成功 {data.feedback.verifyPass} / 未完了 {data.feedback.verifyIncomplete}
                </p>
                {(data.feedback.emptyToolRetries > 0 || data.feedback.readRequired > 0) && (
                  <p className="usage-muted">
                    空 tool_calls {data.feedback.emptyToolRetries} · read必須拒否{' '}
                    {data.feedback.readRequired}
                  </p>
                )}
                <p className="usage-muted">
                  userData/local-db/feedback-events.json に蓄積（ランキング調整の根拠）
                </p>
              </section>
            )}

            <section className="usage-engines">
              <h3>エンジン別</h3>
              <div className="usage-engine-grid">
                {USAGE_ENGINE_KEYS.map((key) => {
                  const row = data.usage[key]
                  const spent = row?.spent ?? 0
                  const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
                  const remaining = row?.remaining ?? Math.max(0, limit - spent)
                  const pct = percent(spent, limit)
                  const requests = row?.requests ?? 0
                  return (
                    <article key={key} className="usage-engine-card">
                      <header>
                        <strong>{ENGINE_LABELS[key]}</strong>
                        <span>
                          {formatUsd(spent)} / {formatUsd(limit)}
                        </span>
                      </header>
                      <div className="usage-bar-track">
                        <div className={barClass(pct)} style={{ width: `${pct}%` }} />
                      </div>
                      <footer>
                        <span>残 {formatUsd(remaining)}</span>
                        <span>
                          {requests} 回 · {pct}%
                        </span>
                      </footer>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="usage-models">
              <h3>モデル別</h3>
              {data.models.length === 0 ? (
                <p className="usage-muted">まだ使用記録がありません。</p>
              ) : (
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>エンジン</th>
                      <th>モデル</th>
                      <th>概算料金</th>
                      <th>回数</th>
                      <th>トークン (in/out)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((row) => {
                      const engine = row.engine as ProviderEngine
                      const label =
                        ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS] ?? row.engine
                      return (
                        <tr key={`${row.engine}:${row.model}`}>
                          <td>{label}</td>
                          <td className="usage-model-id" title={row.model}>
                            {row.model}
                          </td>
                          <td>{formatUsd(row.spent)}</td>
                          <td>{row.requests}</td>
                          <td>
                            {row.input_tokens.toLocaleString()} /{' '}
                            {row.output_tokens.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>

            {data.router && (
              <section className="usage-router">
                <h3>Router 振り分け（今月）</h3>
                <p className="usage-muted">
                  {data.router.total} 件 · フォールバック {data.router.fallbacks} 件（
                  {data.router.fallback_rate}%）
                  {typeof data.router.router_failover_chains === 'number'
                    ? ` · Router Failover ${data.router.router_failover_chains} 件`
                    : ''}
                </p>

                {visibleRouterHints.length > 0 && (
                  <ul className="usage-hints">
                    {visibleRouterHints.map((hint, index) => (
                      <li
                        key={`${hint.code ?? hint.level}-${index}`}
                        className={`usage-hint usage-hint--${hint.level}`}
                      >
                        <div className="usage-hint-body">
                          <span>{hint.text}</span>
                          {hint.code ? (
                            <button
                              type="button"
                              className="usage-hint-dismiss"
                              title="閉じる（今月は再表示しない）"
                              onClick={() => dismissHint(hint.code)}
                            >
                              閉じる
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {failoverAnalysis != null && (
                  <div className="usage-failover-analysis">
                    <h4 className="usage-subhead">Router Failover Analysis</h4>
                    <p className="usage-muted">
                      3-A 読取時集計 · PHP フォールバックとは別
                    </p>

                    <h5 className="usage-failover-analysis-sub">Overview</h5>
                    <div className="usage-failover-overview">
                      <dl className="usage-failover-analysis-stats usage-failover-overview-primary">
                        <div>
                          <dt>Total Chains</dt>
                          <dd>{failoverAnalysis.totalChains}</dd>
                        </div>
                        <div>
                          <dt>Successful</dt>
                          <dd>{failoverAnalysis.successfulChains}</dd>
                        </div>
                        <div>
                          <dt>Exhausted</dt>
                          <dd>{failoverAnalysis.exhaustedChains}</dd>
                        </div>
                        <div>
                          <dt>Success Rate</dt>
                          <dd>{formatFailoverRate(failoverAnalysis.successRate)}</dd>
                        </div>
                      </dl>
                      <dl className="usage-failover-analysis-stats usage-failover-overview-rescue">
                        <div>
                          <dt>Rescued</dt>
                          <dd>{failoverAnalysis.rescuedChains}</dd>
                        </div>
                        <div>
                          <dt>Rescue Rate</dt>
                          <dd>{formatFailoverRate(failoverAnalysis.rescueRate)}</dd>
                        </div>
                      </dl>
                    </div>
                    <p className="usage-muted usage-failover-exhausted-note">
                      Exhausted = Chain 最終枯渇（Hop Errors の合計ではない）
                    </p>

                    {Array.isArray(failoverAnalysis.finalFailedProviderCounts) &&
                      failoverAnalysis.finalFailedProviderCounts.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">
                            Final Failed Providers
                          </h5>
                          <p className="usage-muted usage-failover-final-failed-note">
                            Final Failed が多い Provider · Chain 最終失敗の帰属 · Hop の Errors とは別
                          </p>
                          <table className="usage-table usage-failover-final-failed-table">
                            <thead>
                              <tr>
                                <th>Provider</th>
                                <th>Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortFinalFailedCountsForDisplay(
                                failoverAnalysis.finalFailedProviderCounts
                              ).map((row) => (
                                <tr key={row.provider}>
                                  <td>
                                    {ENGINE_LABELS[
                                      row.provider as keyof typeof ENGINE_LABELS
                                    ] ?? row.provider}
                                  </td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.count}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill warn"
                                          style={{
                                            width: `${relativeBarWidth(
                                              row.count,
                                              finalFailedCountMax
                                            )}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                    {Array.isArray(failoverAnalysis.reasonTransitions) &&
                      failoverAnalysis.reasonTransitions.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">
                            Reason Transitions
                          </h5>
                          <p className="usage-muted usage-failover-reason-transition-note">
                            Chain reasons の隣接遷移 · Core 集計を直表示 · 原因断定ではない
                          </p>
                          <table className="usage-table usage-failover-reason-transition-table">
                            <thead>
                              <tr>
                                <th>From</th>
                                <th>To</th>
                                <th>Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failoverAnalysis.reasonTransitions.map((row) => (
                                <tr key={`${row.from}\0${row.to}`}>
                                  <td className="usage-model-id">{row.from}</td>
                                  <td className="usage-model-id">{row.to}</td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.count}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill"
                                          style={{
                                            width: `${relativeBarWidth(
                                              row.count,
                                              reasonTransitionCountMax
                                            )}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                    <h5 className="usage-failover-analysis-sub">Hop</h5>
                    <dl className="usage-failover-analysis-stats">
                      <div>
                        <dt>1 Hop</dt>
                        <dd>{failoverAnalysis.hopDistribution?.one ?? 0}</dd>
                      </div>
                      <div>
                        <dt>2 Hop</dt>
                        <dd>{failoverAnalysis.hopDistribution?.two ?? 0}</dd>
                      </div>
                      <div>
                        <dt>3 Hop</dt>
                        <dd>{failoverAnalysis.hopDistribution?.three ?? 0}</dd>
                      </div>
                      <div>
                        <dt>4+ Hop</dt>
                        <dd>{failoverAnalysis.hopDistribution?.fourPlus ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Average Hops</dt>
                        <dd>{formatAverageHops(failoverAnalysis.averageHops)}</dd>
                      </div>
                      <div>
                        <dt>Max Hops</dt>
                        <dd>{failoverAnalysis.maxHops ?? 0}</dd>
                      </div>
                    </dl>

                    <h5 className="usage-failover-analysis-sub">Mode</h5>
                    <ul className="usage-failover-mode-list">
                      <li className="usage-failover-mode-item">
                        <div className="usage-failover-mode-head">
                          <span>Ask</span>
                          <strong>{failoverAnalysis.byMode?.ask ?? 0}</strong>
                        </div>
                        <div className="usage-bar-track usage-failover-mini-bar">
                          <div
                            className="usage-bar-fill"
                            style={{
                              width: `${relativeBarWidth(
                                failoverAnalysis.byMode?.ask ?? 0,
                                modeCountMax
                              )}%`
                            }}
                          />
                        </div>
                      </li>
                      <li className="usage-failover-mode-item">
                        <div className="usage-failover-mode-head">
                          <span>Agent</span>
                          <strong>{failoverAnalysis.byMode?.agent ?? 0}</strong>
                        </div>
                        <div className="usage-bar-track usage-failover-mini-bar">
                          <div
                            className="usage-bar-fill"
                            style={{
                              width: `${relativeBarWidth(
                                failoverAnalysis.byMode?.agent ?? 0,
                                modeCountMax
                              )}%`
                            }}
                          />
                        </div>
                      </li>
                      <li className="usage-failover-mode-item">
                        <div className="usage-failover-mode-head">
                          <span>Unknown</span>
                          <strong>{failoverAnalysis.byMode?.unknown ?? 0}</strong>
                        </div>
                        <div className="usage-bar-track usage-failover-mini-bar">
                          <div
                            className="usage-bar-fill"
                            style={{
                              width: `${relativeBarWidth(
                                failoverAnalysis.byMode?.unknown ?? 0,
                                modeCountMax
                              )}%`
                            }}
                          />
                        </div>
                      </li>
                    </ul>

                    {Array.isArray(failoverAnalysis.byProvider) &&
                      failoverAnalysis.byProvider.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">Provider</h5>
                          <p className="usage-muted usage-failover-provider-note">
                            Hop 単位の OKs / Errors · Final Success / Final Failed
                            とは別
                          </p>
                          <table className="usage-table usage-failover-provider-table">
                            <thead>
                              <tr>
                                <th>Provider</th>
                                <th>Hops</th>
                                <th>Errors</th>
                                <th>OKs</th>
                                <th>Error Rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failoverAnalysis.byProvider.map((row) => (
                                <tr key={row.provider}>
                                  <td>
                                    {ENGINE_LABELS[
                                      row.provider as keyof typeof ENGINE_LABELS
                                    ] ?? row.provider}
                                  </td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.hops}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill"
                                          style={{
                                            width: `${relativeBarWidth(row.hops, providerHopMax)}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.errors}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill warn"
                                          style={{
                                            width: `${relativeBarWidth(row.errors, providerHopMax)}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.oks}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill"
                                          style={{
                                            width: `${relativeBarWidth(row.oks, providerHopMax)}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    {formatProviderErrorRate(row.errors, row.hops)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                    {Array.isArray(failoverAnalysis.finalSuccessProviderCounts) &&
                      failoverAnalysis.finalSuccessProviderCounts.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">
                            Final Success Providers
                          </h5>
                          <p className="usage-muted usage-failover-final-success-note">
                            Chain 最終成功の帰属件数 · Hop の OKs とは別
                          </p>
                          <table className="usage-table usage-failover-final-success-table">
                            <thead>
                              <tr>
                                <th>Provider</th>
                                <th>Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failoverAnalysis.finalSuccessProviderCounts.map((row) => (
                                <tr key={row.provider}>
                                  <td>
                                    {ENGINE_LABELS[
                                      row.provider as keyof typeof ENGINE_LABELS
                                    ] ?? row.provider}
                                  </td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.count}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill"
                                          style={{
                                            width: `${relativeBarWidth(
                                              row.count,
                                              finalSuccessCountMax
                                            )}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                    {Array.isArray(failoverAnalysis.byReason) &&
                      failoverAnalysis.byReason.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">Reason</h5>
                          <table className="usage-table usage-failover-reason-table">
                            <thead>
                              <tr>
                                <th>Reason</th>
                                <th>Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failoverAnalysis.byReason.map((row) => (
                                <tr key={row.reason}>
                                  <td className="usage-model-id">{row.reason}</td>
                                  <td>
                                    <div className="usage-failover-metric">
                                      <span>{row.count}</span>
                                      <div className="usage-bar-track usage-failover-mini-bar">
                                        <div
                                          className="usage-bar-fill"
                                          style={{
                                            width: `${relativeBarWidth(row.count, reasonCountMax)}%`
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                    {Array.isArray(failoverAnalysis.dailyBuckets) &&
                      failoverAnalysis.dailyBuckets.length > 0 && (
                        <>
                          <h5 className="usage-failover-analysis-sub">Daily Analysis</h5>
                          <p className="usage-muted usage-failover-daily-note">
                            同月内の日次 Chain 件数 · Core 集計を直表示 · Health/Risk
                            判定ではない
                          </p>
                          <table className="usage-table usage-failover-daily-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Chains</th>
                                <th>Successful</th>
                                <th>Exhausted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failoverAnalysis.dailyBuckets.map((row) => (
                                <tr key={row.date}>
                                  <td className="usage-model-id">{row.date}</td>
                                  <td>{row.chainCount}</td>
                                  <td>{row.successfulCount}</td>
                                  <td>{row.exhaustedCount}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                  </div>
                )}

                {usageEventProviderStatus != null &&
                  usageEventProviderStatus.length > 0 && (
                    <div className="usage-event-provider-status">
                      <h4 className="usage-subhead">All UsageEvent Provider Status</h4>
                      <p className="usage-muted usage-event-provider-status-note">
                        全 UsageEvent が対象 · failoverId
                        の有無を問わない · Router Failover Analysis（Failover
                        Chain）とは別母集団 · Hop / Final Success / Final Failed
                        とは別集計
                      </p>
                      <p className="usage-muted usage-event-provider-status-note">
                        Health / Risk
                        の自動判定や断定ラベルではない · 単なる OK / Error / Total
                        の事実表示
                      </p>
                      <p className="usage-muted usage-event-provider-status-note">
                        現在保持されている UsageEvent（直近 7 日かつ最大 10,000 件）が母集団です ·
                        完全な過去データではありません
                      </p>
                      <table className="usage-table usage-event-provider-status-table">
                        <thead>
                          <tr>
                            <th>Provider</th>
                            <th>OK</th>
                            <th>Error</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageEventProviderStatus.map((row) => (
                            <tr key={row.provider}>
                              <td>
                                {ENGINE_LABELS[
                                  row.provider as keyof typeof ENGINE_LABELS
                                ] ?? row.provider}
                              </td>
                              <td>
                                <div className="usage-failover-metric">
                                  <span>{row.ok}</span>
                                  <div className="usage-bar-track usage-failover-mini-bar">
                                    <div
                                      className="usage-bar-fill"
                                      style={{
                                        width: `${relativeBarWidth(
                                          row.ok,
                                          usageEventProviderTotalMax
                                        )}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="usage-failover-metric">
                                  <span>{row.error}</span>
                                  <div className="usage-bar-track usage-failover-mini-bar">
                                    <div
                                      className="usage-bar-fill warn"
                                      style={{
                                        width: `${relativeBarWidth(
                                          row.error,
                                          usageEventProviderTotalMax
                                        )}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="usage-failover-metric">
                                  <span>{row.total}</span>
                                  <div className="usage-bar-track usage-failover-mini-bar">
                                    <div
                                      className="usage-bar-fill"
                                      style={{
                                        width: `${relativeBarWidth(
                                          row.total,
                                          usageEventProviderTotalMax
                                        )}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {usageEventProviderDailyRows != null &&
                  usageEventProviderDailyRows.length > 0 && (
                    <div className="usage-event-provider-daily">
                      <h4 className="usage-subhead">
                        All UsageEvent Provider Daily Analysis
                      </h4>
                      <p className="usage-muted usage-event-provider-daily-note">
                        All UsageEvent を対象とした日次集計です · Failover Chain
                        Analysis とは別の母集団です
                      </p>
                      <p className="usage-muted usage-event-provider-daily-note">
                        現在保持されている UsageEvent（直近 7 日かつ最大 10,000 件）の範囲内です ·
                        完全な過去履歴を示すものではありません
                      </p>
                      <p className="usage-muted usage-event-provider-daily-note">
                        UTC カレンダー日 · 月次合計（Provider Status）および Chain
                        Daily とは別集計 · 自動判定ラベルではありません
                      </p>
                      {usageEventProviderDaily != null && (
                        <p className="usage-muted usage-event-provider-daily-range">
                          範囲 · events {usageEventProviderDaily.eventCount}
                          {usageEventProviderDaily.oldestTimestamp
                            ? ` · oldest ${usageEventProviderDaily.oldestTimestamp}`
                            : ''}
                          {usageEventProviderDaily.newestTimestamp
                            ? ` · newest ${usageEventProviderDaily.newestTimestamp}`
                            : ''}
                        </p>
                      )}
                      <table className="usage-table usage-event-provider-daily-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Provider</th>
                            <th>OK</th>
                            <th>Error</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageEventProviderDailyRows.map((row) => (
                            <tr key={`${row.date}\0${row.provider}`}>
                              <td className="usage-model-id">{row.date}</td>
                              <td>
                                {ENGINE_LABELS[
                                  row.provider as keyof typeof ENGINE_LABELS
                                ] ?? row.provider}
                              </td>
                              <td>{row.ok}</td>
                              <td>{row.error}</td>
                              <td>{row.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {usageEventProviderHourlyRows != null &&
                  usageEventProviderHourlyRows.length > 0 && (
                    <div className="usage-event-provider-hourly">
                      <h4 className="usage-subhead">
                        All UsageEvent Provider Hourly Analysis
                      </h4>
                      <p className="usage-muted usage-event-provider-hourly-note">
                        保持されている All UsageEvent を UTC 時間単位で見た事実です ·
                        Failover Chain Analysis / Daily とは別の母集団・別集計です
                      </p>
                      <p className="usage-muted usage-event-provider-hourly-note">
                        完全な時間履歴ではありません · UsageEvent は直近 7 日かつ最大 10,000 件まで保持されます
                        · 保持範囲は Completeness セクションを参照してください
                      </p>
                      <p className="usage-muted usage-event-provider-hourly-note">
                        UTC dateHour · 自動判定ラベルではありません
                      </p>
                      <table className="usage-table usage-event-provider-hourly-table">
                        <thead>
                          <tr>
                            <th>Date Hour</th>
                            <th>Provider</th>
                            <th>OK</th>
                            <th>Error</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageEventProviderHourlyRows.map((row) => (
                            <tr key={`${row.dateHour}\0${row.provider}`}>
                              <td className="usage-model-id">{row.dateHour}</td>
                              <td>
                                {ENGINE_LABELS[
                                  row.provider as keyof typeof ENGINE_LABELS
                                ] ?? row.provider}
                              </td>
                              <td>{row.ok}</td>
                              <td>{row.error}</td>
                              <td>{row.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {usageEventProviderDailyRetainedRows != null &&
                  usageEventProviderDailyRetainedRows.length > 0 && (
                    <div className="usage-event-provider-daily-retained">
                      <h4 className="usage-subhead">
                        All UsageEvent Provider Daily Retained
                      </h4>
                      <p className="usage-muted usage-event-provider-daily-retained-note">
                        長期保持の Daily Aggregate です · Raw（直近 7 日）由来の Daily
                        とは別の事実レイヤです
                      </p>
                      <p className="usage-muted usage-event-provider-daily-retained-note">
                        All UsageEvent 母集団 · Failover Chain / Hop / Final* とは別 ·
                        Raw 削除後も日次事実は残ります · 自動判定ラベルではありません
                      </p>
                      {usageEventProviderDailyRetained != null && (
                        <p className="usage-muted usage-event-provider-daily-retained-range">
                          範囲 · days {usageEventProviderDailyRetained.dayCount}
                          {usageEventProviderDailyRetained.oldestDate
                            ? ` · oldest ${usageEventProviderDailyRetained.oldestDate}`
                            : ''}
                          {usageEventProviderDailyRetained.newestDate
                            ? ` · newest ${usageEventProviderDailyRetained.newestDate}`
                            : ''}
                        </p>
                      )}
                      <table className="usage-table usage-event-provider-daily-retained-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Provider</th>
                            <th>OK</th>
                            <th>Error</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageEventProviderDailyRetainedRows.map((row) => (
                            <tr key={`retained-${row.date}\0${row.provider}`}>
                              <td className="usage-model-id">{row.date}</td>
                              <td>
                                {ENGINE_LABELS[
                                  row.provider as keyof typeof ENGINE_LABELS
                                ] ?? row.provider}
                              </td>
                              <td>{row.ok}</td>
                              <td>{row.error}</td>
                              <td>{row.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {usageEventCompleteness != null && (
                  <div className="usage-event-completeness">
                    <h4 className="usage-subhead">All UsageEvent Data Completeness</h4>
                    <p className="usage-muted usage-event-completeness-note">
                      現在保持されている UsageEvent を対象とした保持状態です ·
                      保持上限は直近 7 日かつ最大 10,000 件 · 完全な過去履歴を意味しません
                    </p>
                    <p className="usage-muted usage-event-completeness-note">
                      上限に達している場合、より古いイベントが保持されていない可能性があります
                      · Daily Retained の長期集計とは別事実です · 自動判定ラベルではありません
                    </p>
                    <dl className="usage-event-completeness-stats">
                      <div>
                        <dt>Event Count</dt>
                        <dd>{usageEventCompleteness.eventCount}</dd>
                      </div>
                      <div>
                        <dt>MAX_EVENTS</dt>
                        <dd>{usageEventCompleteness.maxEvents}</dd>
                      </div>
                      <div>
                        <dt>Oldest Timestamp</dt>
                        <dd className="usage-model-id">
                          {usageEventCompleteness.oldestTimestamp ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>Newest Timestamp</dt>
                        <dd className="usage-model-id">
                          {usageEventCompleteness.newestTimestamp ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>Possibly Truncated</dt>
                        <dd>
                          {usageEventCompleteness.possiblyTruncated ? 'true' : 'false'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}

                {failoverChains.length > 0 && (
                  <>
                    <h4 className="usage-subhead">Router Failover Chain</h4>
                    <p className="usage-muted">
                      failoverId 単位 · {failoverChains.length} 件（PHP
                      フォールバックとは別）
                    </p>
                    <ul className="usage-failover-chains">
                      {failoverChains.map((chain) => {
                        const providers = formatChainProviders(chain)
                        const reasons = formatChainReasons(chain)
                        const statusPath = formatChainStatuses(chain)
                        const modeTag =
                          chain.mode === 'agent' ? 'agent' : chain.mode === 'ask' ? 'ask' : null
                        const hops = resolveChainHops(chain)
                        return (
                          <li
                            key={chain.failoverId}
                            className="usage-failover-chain"
                            title={chain.failoverId}
                          >
                            {modeTag ? (
                              <span className="usage-failover-chain-mode">[{modeTag}]</span>
                            ) : null}
                            <div className="usage-failover-chain-path">
                              {providers || '—'}
                            </div>
                            {reasons ? (
                              <div className="usage-failover-chain-reasons">{reasons}</div>
                            ) : null}
                            {statusPath ? (
                              <div className="usage-failover-chain-statuses">
                                <span className="usage-muted">Status path</span>{' '}
                                {statusPath}
                              </div>
                            ) : null}
                            <div className="usage-failover-chain-final-wrap">
                              <div className="usage-failover-analysis-sub">Final result</div>
                              <dl className="usage-failover-chain-final">
                                <div>
                                  <dt>Final Status</dt>
                                  <dd>{formatChainFinalStatus(chain.finalStatus)}</dd>
                                </div>
                                <div>
                                  <dt>Final Reason</dt>
                                  <dd className="usage-model-id">
                                    {formatChainFinalReason(chain.finalReason)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Final Success Provider</dt>
                                  <dd>
                                    {formatChainFinalSuccessProvider(
                                      chain.finalSuccessProvider
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Final Failed Provider</dt>
                                  <dd>
                                    {formatChainFinalFailedProvider(
                                      chain.finalFailedProvider
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                            <details className="usage-failover-chain-toggle">
                              <summary>Hop details</summary>
                              {hops.length === 0 ? (
                                <p className="usage-muted usage-failover-hop-empty">
                                  —
                                </p>
                              ) : (
                                <div className="usage-failover-hop-list">
                                  <table className="usage-failover-hop-timeline">
                                    <thead>
                                      <tr>
                                        <th scope="col">Time</th>
                                        <th scope="col">Provider</th>
                                        <th scope="col">Status</th>
                                        <th scope="col">Attempt</th>
                                        <th scope="col">Reason</th>
                                        <th scope="col">Mode</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {hops.map((hop, hopIndex) => (
                                        <tr
                                          key={`${chain.failoverId}:${hopIndex}:${formatHopAttempt(hop?.attempt)}`}
                                          className="usage-failover-hop-row"
                                        >
                                          <td className="usage-failover-hop-time">
                                            {formatHopTimestamp(hop?.timestamp)}
                                          </td>
                                          <td className="usage-failover-hop-provider">
                                            {hop?.provider
                                              ? engineDisplayName(String(hop.provider))
                                              : '—'}
                                          </td>
                                          <td className="usage-failover-hop-status">
                                            {formatHopText(hop?.status)}
                                          </td>
                                          <td className="usage-failover-hop-attempt">
                                            {formatHopAttemptLabel(hop?.attempt)}
                                          </td>
                                          <td className="usage-failover-hop-reason usage-model-id">
                                            {formatHopText(hop?.reason)}
                                          </td>
                                          <td className="usage-failover-hop-mode">
                                            {formatHopMode(hop?.mode ?? null)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </details>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}

                {data.router.by_engine.length > 0 && (
                  <>
                    <h4 className="usage-subhead">エンジン別回数</h4>
                    <div className="usage-engine-grid">
                      {data.router.by_engine.map((row) => {
                        const label =
                          ENGINE_LABELS[row.engine as keyof typeof ENGINE_LABELS] ?? row.engine
                        const share =
                          data.router!.total > 0
                            ? Math.round((row.count / data.router!.total) * 1000) / 10
                            : 0
                        return (
                          <article key={row.engine} className="usage-engine-card">
                            <header>
                              <strong>{label}</strong>
                              <span>{row.count} 回</span>
                            </header>
                            <div className="usage-bar-track">
                              <div className="usage-bar-fill" style={{ width: `${share}%` }} />
                            </div>
                            <footer>
                              <span>{share}%</span>
                              <span>est {formatUsd(row.estimated_usd)}</span>
                            </footer>
                          </article>
                        )
                      })}
                    </div>
                  </>
                )}

                {data.router.by_task.length > 0 && (
                  <>
                    <h4 className="usage-subhead">タスク × エンジン</h4>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>タスク</th>
                          <th>エンジン</th>
                          <th>回数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.router.by_task.slice(0, 15).map((row) => (
                          <tr key={`${row.task_type}:${row.engine}`}>
                            <td>{row.task_type}</td>
                            <td>
                              {ENGINE_LABELS[row.engine as keyof typeof ENGINE_LABELS] ??
                                row.engine}
                            </td>
                            <td>{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {data.router.recent.length > 0 && (
                  <>
                    <div className="usage-recent-head">
                      <h4 className="usage-subhead">直近の判定</h4>
                      <label className="usage-month-filter">
                        月
                        <select
                          value={routerMonth}
                          onChange={(event) => setRouterMonth(event.target.value)}
                          disabled={loading}
                        >
                          {monthOptions.map((month) => (
                            <option key={month} value={month}>
                              {month}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="usage-muted">
                      {(data.router.month || data.router_month || routerMonth) + ' · '}
                      取得 {data.router.recent.length} 件
                      {typeof data.router.recent_total === 'number' &&
                      data.router.recent_total > data.router.recent.length
                        ? `（月内 ${data.router.recent_total} 件中）`
                        : ''}
                      {' · '}
                      表示 {Math.min(recentVisible, data.router.recent.length)} 件
                    </p>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>日時</th>
                          <th>エンジン</th>
                          <th>タスク</th>
                          <th>課金</th>
                          <th>Credential</th>
                          <th>est</th>
                          <th>フォールバック</th>
                          <th>Router Failover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.router.recent.slice(0, recentVisible).map((row) => (
                          <tr key={row.id}>
                            <td className="usage-model-id" title={row.created_at}>
                              {row.created_at.replace('T', ' ').slice(5, 16)}
                            </td>
                            <td>
                              {ENGINE_LABELS[row.engine as keyof typeof ENGINE_LABELS] ??
                                row.engine}
                            </td>
                            <td title={row.model ?? ''}>{row.task_type}</td>
                            <td>{formatBillingMode(row.billingMode)}</td>
                            <td
                              className="usage-model-id"
                              title={String(row.credentialId || '').trim() || undefined}
                            >
                              {formatCredentialId(row.credentialId)}
                            </td>
                            <td>{formatUsd(row.estimated_usd)}</td>
                            <td className="usage-model-id" title={row.fallback_reason ?? ''}>
                              {row.fallback_from
                                ? `${row.fallback_from}→${row.engine}`
                                : '—'}
                            </td>
                            <td
                              className="usage-model-id"
                              title={row.routerFailover?.reason ?? undefined}
                            >
                              {formatRouterFailover(row) || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {recentVisible < data.router.recent.length && (
                      <button
                        type="button"
                        className="usage-more-btn"
                        onClick={() =>
                          setRecentVisible((n) =>
                            Math.min(n + RECENT_PAGE_SIZE, data.router!.recent.length)
                          )
                        }
                      >
                        もっと見る（残り{' '}
                        {data.router.recent.length - recentVisible} 件）
                      </button>
                    )}
                  </>
                )}

                {data.router.recent.length === 0 && (
                  <div className="usage-recent-head">
                    <h4 className="usage-subhead">直近の判定</h4>
                    <label className="usage-month-filter">
                      月
                      <select
                        value={routerMonth}
                        onChange={(event) => setRouterMonth(event.target.value)}
                        disabled={loading}
                      >
                        {monthOptions.map((month) => (
                          <option key={month} value={month}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {onOpenSettings && (
                  <p className="usage-footer">
                    ヒントを見て Auto を直す場合は{' '}
                    <button
                      type="button"
                      className="usage-link"
                      onClick={() => {
                        onClose()
                        onOpenSettings()
                      }}
                    >
                      設定（Auto パイプライン）
                    </button>{' '}
                    へ。
                  </p>
                )}
              </section>
            )}

            {data.note && <p className="usage-note">{data.note}</p>}
            {onOpenSettings && (
              <p className="usage-footer">
                月額上限の変更は{' '}
                <button
                  type="button"
                  className="usage-link"
                  onClick={() => {
                    onClose()
                    onOpenSettings()
                  }}
                >
                  設定
                </button>{' '}
                から行えます。
              </p>
            )}
          </>
        )}
      </div>
  )

  if (variant === 'dock') {
    return (
      <aside className="usage-dock" aria-label="AI 使用量" style={{ width }}>
        {body}
      </aside>
    )
  }

  return (
    <div className="usage-overlay" role="dialog" aria-label="AI 使用量">
      {body}
    </div>
  )
}
