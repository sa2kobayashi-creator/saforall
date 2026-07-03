import { useEffect, useState } from 'react'
import './Sidebar.css'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

type Props = {
  workspacePath: string | null
  activePath: string | null
  onOpenWorkspace: () => void
  onOpenFile: (path: string) => void
}

export function Sidebar({
  workspacePath,
  activePath,
  onOpenWorkspace,
  onOpenFile
}: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) {
      setEntries([])
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const list = await window.saforall.readDir(workspacePath)
        if (!cancelled) {
          setEntries(list)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspacePath])

  const workspaceName = workspacePath
    ? workspacePath.split(/[/\\]/).filter(Boolean).pop()
    : null

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>{workspaceName ?? 'EXPLORER'}</span>
        <button type="button" onClick={onOpenWorkspace} title="フォルダを開く">
          ＋
        </button>
      </div>

      {!workspacePath && (
        <div className="sidebar-empty">
          <p>ワークスペースが未選択です</p>
          <button type="button" className="primary" onClick={onOpenWorkspace}>
            フォルダを開く
          </button>
        </div>
      )}

      {error && <div className="sidebar-error">{error}</div>}

      <ul className="file-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`file-item ${activePath === entry.path ? 'active' : ''}`}
              onClick={() => {
                if (!entry.isDirectory) onOpenFile(entry.path)
              }}
              disabled={entry.isDirectory}
              title={entry.path}
            >
              <span className="file-icon">{entry.isDirectory ? '📂' : '📄'}</span>
              <span className="file-name">{entry.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
