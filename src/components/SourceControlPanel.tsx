import { useCallback, useEffect, useMemo, useState } from 'react'
import './SourceControlPanel.css'

type GitFile = {
  path: string
  status: string
  staged: boolean
  unstaged: boolean
}

type Props = {
  workspacePath: string | null
  width: number
  refreshKey: number
  syncCommand: 'pull' | 'push' | null
  onSyncHandled: () => void
  onOpenWorkspace: () => void
  onClone: () => void
  onOpenFile: (path: string) => void
  onStatusMessage?: (message: string) => void
}

export function SourceControlPanel({
  workspacePath,
  width,
  refreshKey,
  syncCommand,
  onSyncHandled,
  onOpenWorkspace,
  onClone,
  onOpenFile,
  onStatusMessage
}: Props) {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)
  const [upstream, setUpstream] = useState<string | null>(null)
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [isRepo, setIsRepo] = useState(false)
  const [files, setFiles] = useState<GitFile[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const staged = useMemo(() => files.filter((file) => file.staged), [files])
  const changes = useMemo(() => files.filter((file) => file.unstaged), [files])

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setIsRepo(false)
      setFiles([])
      setBranch(null)
      setUpstream(null)
      setAhead(0)
      setBehind(0)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await window.saforall.gitStatus(workspacePath)
      setIsRepo(result.isRepo)
      setBranch(result.branch)
      setUpstream(result.upstream)
      setAhead(result.ahead ?? 0)
      setBehind(result.behind ?? 0)
      setFiles(
        result.files.map((file) => ({
          path: file.path,
          status: file.status,
          staged: file.staged,
          unstaged: file.unstaged
        }))
      )
      if (!result.ok || (result.error && !result.isRepo)) {
        setError(result.error ?? null)
      } else if (result.error && result.isRepo === false) {
        setError(result.error)
      } else {
        setError(null)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  const runOp = useCallback(
    async (label: string, action: () => Promise<{ ok: boolean; error?: string; stdout?: string }>) => {
      if (!workspacePath) return
      setBusy(true)
      setError(null)
      const result = await action()
      setBusy(false)
      if (!result.ok) {
        setError(result.error ?? `${label} に失敗しました`)
        onStatusMessage?.(result.error ?? `${label} に失敗しました`)
        return
      }
      onStatusMessage?.(result.stdout?.trim() || `${label} 完了`)
      if (label === 'Commit') setMessage('')
      await refresh()
    },
    [workspacePath, refresh, onStatusMessage]
  )

  useEffect(() => {
    if (!syncCommand || !workspacePath) return
    if (loading) return
    if (!isRepo) {
      onSyncHandled()
      return
    }
    const run = syncCommand
    if (run === 'pull') {
      void runOp('Pull', () => window.saforall.gitPull(workspacePath)).finally(onSyncHandled)
    } else {
      void runOp('Push', () => window.saforall.gitPush(workspacePath)).finally(onSyncHandled)
    }
  }, [syncCommand, workspacePath, isRepo, loading, runOp, onSyncHandled])

  const onInit = async () => {
    if (!workspacePath) return
    await runOp('Init', () => window.saforall.gitInit(workspacePath))
  }

  const openPath = (relative: string) => {
    if (!workspacePath) return
    const sep = workspacePath.includes('\\') ? '\\' : '/'
    onOpenFile(`${workspacePath}${sep}${relative}`)
  }

  return (
    <aside className="scm-panel" style={{ width }} aria-label="Source Control">
      <div className="scm-header">
        <strong>SOURCE CONTROL</strong>
        <div className="scm-actions">
          <button type="button" title="更新" disabled={busy} onClick={() => void refresh()}>
            ↻
          </button>
          <button type="button" title="Pull" disabled={busy || !isRepo} onClick={() => void runOp('Pull', () => window.saforall.gitPull(workspacePath!))}>
            ⇓
          </button>
          <button type="button" title="Push" disabled={busy || !isRepo} onClick={() => void runOp('Push', () => window.saforall.gitPush(workspacePath!))}>
            ⇑
          </button>
          <button type="button" title="Clone" onClick={onClone}>
            ↓
          </button>
        </div>
      </div>

      {!workspacePath && (
        <div className="scm-empty">
          <p>フォルダを開くか、リポジトリをクローンしてください。</p>
          <button type="button" onClick={onOpenWorkspace}>
            フォルダを開く
          </button>
          <button type="button" onClick={onClone}>
            Clone…
          </button>
        </div>
      )}

      {workspacePath && (
        <div className="scm-body">
          <div className="scm-meta">
            <div className="scm-path" title={workspacePath}>
              {workspacePath}
            </div>
            {loading && <div className="scm-note">確認中…</div>}
            {isRepo ? (
              <div className="scm-branch">
                ⎇ {branch ?? 'unknown'}
                {upstream ? ` → ${upstream}` : ''}
                {(ahead > 0 || behind > 0) && (
                  <span className="scm-sync-count">
                    {ahead > 0 ? ` ↑${ahead}` : ''}
                    {behind > 0 ? ` ↓${behind}` : ''}
                  </span>
                )}
              </div>
            ) : (
              <div className="scm-note">
                Git リポジトリではありません。
                <button type="button" onClick={() => void onInit()}>
                  git init
                </button>
              </div>
            )}
            {error && <div className="scm-error">{error}</div>}
          </div>

          {isRepo && (
            <>
              <div className="scm-commit">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="コミットメッセージ"
                  rows={3}
                  disabled={busy}
                />
                <div className="scm-commit-actions">
                  <button
                    type="button"
                    disabled={busy || staged.length === 0 || !message.trim()}
                    onClick={() =>
                      void runOp('Commit', () =>
                        window.saforall.gitCommit({
                          cwd: workspacePath,
                          message
                        })
                      )
                    }
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    disabled={busy || changes.length === 0}
                    title="すべてステージ"
                    onClick={() =>
                      void runOp('Stage all', () => window.saforall.gitStageAll(workspacePath))
                    }
                  >
                    + All
                  </button>
                </div>
              </div>

              <div className="scm-section-title">
                Staged Changes {staged.length > 0 ? `(${staged.length})` : ''}
              </div>
              {staged.length === 0 ? (
                <div className="scm-note">ステージされた変更はありません</div>
              ) : (
                <ul className="scm-file-list">
                  {staged.map((file) => (
                    <li key={`staged-${file.path}`}>
                      <div className="scm-file-row">
                        <button
                          type="button"
                          className="scm-file"
                          title={file.path}
                          onClick={() => openPath(file.path)}
                        >
                          <span className="scm-file-status">{file.status}</span>
                          <span className="scm-file-path">{file.path}</span>
                        </button>
                        <button
                          type="button"
                          className="scm-file-action"
                          title="Unstage"
                          disabled={busy}
                          onClick={() =>
                            void runOp('Unstage', () =>
                              window.saforall.gitUnstage({
                                cwd: workspacePath,
                                paths: [file.path]
                              })
                            )
                          }
                        >
                          −
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="scm-section-title">
                Changes {changes.length > 0 ? `(${changes.length})` : ''}
              </div>
              {changes.length === 0 ? (
                <div className="scm-note">変更はありません</div>
              ) : (
                <ul className="scm-file-list">
                  {changes.map((file) => (
                    <li key={`change-${file.path}`}>
                      <div className="scm-file-row">
                        <button
                          type="button"
                          className="scm-file"
                          title={file.path}
                          onClick={() => openPath(file.path)}
                        >
                          <span className="scm-file-status">{file.status}</span>
                          <span className="scm-file-path">{file.path}</span>
                        </button>
                        <button
                          type="button"
                          className="scm-file-action"
                          title="Stage"
                          disabled={busy}
                          onClick={() =>
                            void runOp('Stage', () =>
                              window.saforall.gitStage({
                                cwd: workspacePath,
                                paths: [file.path]
                              })
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  )
}
