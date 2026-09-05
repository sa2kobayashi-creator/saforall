import { useEffect, useState } from 'react'
import './TimelinePanel.css'

export type HistoryEntry = {
  id: string
  path: string
  savedAt: number
  bytes: number
  label?: string
}

type Props = {
  workspacePath: string | null
  activePath: string | null
  refreshKey?: number
  onRestore: (path: string, content: string) => void
  onStatusMessage?: (message: string) => void
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

export function TimelinePanel({
  workspacePath,
  activePath,
  refreshKey = 0,
  onRestore,
  onStatusMessage
}: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'file' | 'all'>('file')

  useEffect(() => {
    if (!workspacePath || typeof window.saforall.listLocalHistory !== 'function') {
      setEntries([])
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    const path = scope === 'file' ? activePath ?? undefined : undefined
    void window.saforall
      .listLocalHistory(workspacePath, path)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspacePath, activePath, scope, refreshKey])

  return (
    <div className="timeline-panel" aria-label="Local History">
      <div className="timeline-toolbar">
        <strong>Local History</strong>
        <div className="timeline-scope">
          <button
            type="button"
            className={scope === 'file' ? 'active' : ''}
            onClick={() => setScope('file')}
          >
            このファイル
          </button>
          <button
            type="button"
            className={scope === 'all' ? 'active' : ''}
            onClick={() => setScope('all')}
          >
            すべて
          </button>
        </div>
      </div>
      {busy && <p className="timeline-hint">読み込み中…</p>}
      {error && <p className="timeline-error">{error}</p>}
      {!busy && entries.length === 0 && (
        <p className="timeline-hint">履歴はまだありません（保存時に記録されます）</p>
      )}
      <ul className="timeline-list">
        {entries.map((entry) => (
          <li key={`${entry.path}:${entry.id}`}>
            <div className="timeline-row">
              <div>
                <div className="timeline-path" title={entry.path}>
                  {entry.path}
                  {entry.label ? ` · ${entry.label}` : ''}
                </div>
                <div className="timeline-meta">
                  {formatWhen(entry.savedAt)} · {entry.bytes} bytes
                </div>
              </div>
              <button
                type="button"
                disabled={!workspacePath}
                onClick={() => {
                  if (!workspacePath) return
                  void window.saforall
                    .readLocalHistory({
                      cwd: workspacePath,
                      id: entry.id,
                      path: entry.path
                    })
                    .then((content) => {
                      onRestore(entry.path, content)
                      onStatusMessage?.(`履歴を開きました: ${entry.path}`)
                    })
                    .catch((err) => onStatusMessage?.(String(err)))
                }}
              >
                開く
              </button>
              <button
                type="button"
                className="primary"
                disabled={!workspacePath}
                onClick={() => {
                  if (!workspacePath) return
                  const ok = window.confirm(`${entry.path} をこの履歴で上書きしますか？`)
                  if (!ok) return
                  void window.saforall
                    .restoreLocalHistory({
                      cwd: workspacePath,
                      id: entry.id,
                      path: entry.path
                    })
                    .then(async () => {
                      const content = await window.saforall.readFile(
                        workspacePath.includes('\\')
                          ? `${workspacePath.replace(/\\+$/, '')}\\${entry.path.replace(/\//g, '\\')}`
                          : `${workspacePath.replace(/\/+$/, '')}/${entry.path}`
                      )
                      onRestore(entry.path, content)
                      onStatusMessage?.(`履歴を復元しました: ${entry.path}`)
                    })
                    .catch((err) => onStatusMessage?.(String(err)))
                }}
              >
                復元
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
