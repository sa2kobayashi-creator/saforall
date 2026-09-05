import { useCallback, useEffect, useState } from 'react'
import './RulesPanel.css'

type RuleFile = {
  path: string
  kind: 'rules' | 'agents' | 'memory'
  bytes: number
}

type Props = {
  workspacePath: string | null
  width: number
  onOpenWorkspace: () => void
  onOpenFile: (path: string) => void
  onStatusMessage?: (message: string) => void
}

export function RulesPanel({
  workspacePath,
  width,
  onOpenWorkspace,
  onOpenFile,
  onStatusMessage
}: Props) {
  const [files, setFiles] = useState<RuleFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspacePath || typeof window.saforall.listRules !== 'function') {
      setFiles([])
      return
    }
    setBusy(true)
    setError(null)
    try {
      const listed = await window.saforall.listRules(workspacePath)
      setFiles(listed)
      const memory = await window.saforall.readMemory(workspacePath)
      setMemoryDraft(memory)
      setSelected((current) => current ?? listed[0]?.path ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!workspacePath || !selected) {
      setPreview('')
      return
    }
    void (async () => {
      try {
        const text = await window.saforall.readRuleFile(workspacePath, selected)
        setPreview(text)
      } catch (err) {
        setPreview(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [workspacePath, selected])

  const appendNote = async () => {
    if (!workspacePath || !note.trim()) return
    setBusy(true)
    try {
      await window.saforall.appendMemory(workspacePath, note.trim())
      setNote('')
      await refresh()
      onStatusMessage?.('Memory に追記しました（次の Agent 実行から反映）')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveMemory = async () => {
    if (!workspacePath) return
    setBusy(true)
    try {
      await window.saforall.saveMemory(workspacePath, memoryDraft)
      await refresh()
      onStatusMessage?.('memories.md を保存しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openAbsolute = (rel: string) => {
    if (!workspacePath) return
    const sep = workspacePath.includes('\\') ? '\\' : '/'
    onOpenFile(`${workspacePath}${sep}${rel.replace(/\//g, sep)}`)
  }

  return (
    <aside className="rules-panel" style={{ width }} aria-label="Rules & Memories">
      <div className="rules-header">
        <strong>Rules / Memories</strong>
        <button type="button" disabled={!workspacePath || busy} onClick={() => void refresh()}>
          ↻
        </button>
      </div>
      {!workspacePath ? (
        <div className="rules-empty">
          <p>フォルダを開いて Rules を表示</p>
          <button type="button" onClick={onOpenWorkspace}>
            フォルダを開く
          </button>
        </div>
      ) : (
        <>
          {error && <p className="rules-error">{error}</p>}
          <div className="rules-files">
            <strong>検出ファイル</strong>
            {files.length === 0 ? (
              <p className="rules-hint">
                AGENTS.md / .cursor/rules / .saforall/memories.md がありません
              </p>
            ) : (
              <ul>
                {files.map((row) => (
                  <li key={row.path}>
                    <button
                      type="button"
                      className={selected === row.path ? 'active' : ''}
                      onClick={() => setSelected(row.path)}
                    >
                      <span>{row.path}</span>
                      <em>{row.kind}</em>
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      title="エディタで開く"
                      onClick={() => openAbsolute(row.path)}
                    >
                      ✎
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rules-preview">
            <strong>プレビュー</strong>
            <pre>{preview || '（選択なし）'}</pre>
          </div>
          <div className="rules-memory">
            <strong>Memory 追記</strong>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Agent に覚えてほしいメモ…"
              rows={3}
            />
            <button type="button" disabled={busy || !note.trim()} onClick={() => void appendNote()}>
              追記
            </button>
            <strong className="rules-sub">memories.md 編集</strong>
            <textarea
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              rows={8}
            />
            <button type="button" disabled={busy} onClick={() => void saveMemory()}>
              保存
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
