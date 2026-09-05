import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_COST_LIMITS,
  ENGINE_LABELS,
  USAGE_ENGINE_KEYS,
  USER_PLAN_LABELS,
  parseUserPlan,
  type ProviderEngine
} from '../lib/llmModels'
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
}

type RouterInsight = {
  total: number
  fallbacks: number
  fallback_rate: number
  by_engine: RouteEngineStat[]
  by_task: RouteTaskStat[]
  recent: RouteRecent[]
  hints: RouteHint[]
}

type UsagePayload = {
  month: string
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

  const load = useCallback(async () => {
    if (!backendConnected) {
      setError('バックエンド未接続のため使用量を取得できません')
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.saforall.request<UsagePayload>('GET', '/ai/usage')
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? '使用量の取得に失敗しました')
        setData(null)
        return
      }
      setData(result.data)
    } catch (err) {
      setError(String(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [backendConnected])

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
          <p className="usage-warning">バックエンドに接続すると使用量を表示できます。</p>
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

                {data.router.hints.length > 0 && (
                  <ul className="usage-hints">
                    {data.router.hints.map((hint, index) => (
                      <li
                        key={`${hint.level}-${index}`}
                        className={`usage-hint usage-hint--${hint.level}`}
                      >
                        {hint.text}
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
                    <h4 className="usage-subhead">直近の判定</h4>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>日時</th>
                          <th>エンジン</th>
                          <th>タスク</th>
                          <th>est</th>
                          <th>フォールバック</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.router.recent.slice(0, 12).map((row) => (
                          <tr key={row.id}>
                            <td className="usage-model-id" title={row.created_at}>
                              {row.created_at.replace('T', ' ').slice(5, 16)}
                            </td>
                            <td>
                              {ENGINE_LABELS[row.engine as keyof typeof ENGINE_LABELS] ??
                                row.engine}
                            </td>
                            <td title={row.model ?? ''}>{row.task_type}</td>
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
                  </>
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
