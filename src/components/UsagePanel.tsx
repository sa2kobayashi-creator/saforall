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
}

type RouterInsight = {
  total: number
  fallbacks: number
  fallback_rate: number
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

/** Fill missing billingMode from BYOK list when Main enrichment is absent. */
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
                          <th>est</th>
                          <th>フォールバック</th>
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
                            <td>{formatUsd(row.estimated_usd)}</td>
                            <td className="usage-model-id" title={row.fallback_reason ?? ''}>
                              {row.fallback_from
                                ? `${row.fallback_from}→${row.engine}`
                                : '—'}
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
