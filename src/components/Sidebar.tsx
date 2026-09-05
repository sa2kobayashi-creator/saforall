import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import './Sidebar.css'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

type Props = {
  workspacePath: string | null
  activePath: string | null
  width: number
  onOpenWorkspace: () => void
  onOpenFile: (path: string) => void
}

type TreeNodeProps = {
  entry: DirEntry
  depth: number
  activePath: string | null
  onOpenFile: (path: string) => void
}

function TreeNode({ entry, depth, activePath, onOpenFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadChildren = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.saforall.readDir(entry.path)
      setChildren(list)
    } catch (err) {
      setError(String(err))
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [entry.path])

  const onToggle = async () => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path)
      return
    }

    const next = !expanded
    setExpanded(next)
    if (next && children === null) {
      await loadChildren()
    }
  }

  return (
    <li>
      <button
        type="button"
        className={`file-item ${activePath === entry.path ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => {
          void onToggle()
        }}
        title={entry.path}
      >
        <span className="file-icon">
          {entry.isDirectory ? (expanded ? '📂' : '📁') : '📄'}
        </span>
        <span className="file-name">{entry.name}</span>
      </button>

      {entry.isDirectory && expanded && (
        <ul className="file-list nested">
          {loading && <li className="file-meta">読み込み中…</li>}
          {error && <li className="file-meta error">{error}</li>}
          {!loading && children?.length === 0 && (
            <li className="file-meta">空のフォルダ</li>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function Sidebar({
  workspacePath,
  activePath,
  width,
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

  const { t } = useI18n()

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span>{workspaceName ?? t('sidebar.explorer')}</span>
        <button type="button" onClick={onOpenWorkspace} title={t('sidebar.openFolder')}>
          ＋
        </button>
      </div>

      {!workspacePath && (
        <div className="sidebar-empty">
          <p>{t('sidebar.noWorkspace')}</p>
          <button type="button" className="primary" onClick={onOpenWorkspace}>
            {t('sidebar.openFolder')}
          </button>
        </div>
      )}

      {error && <div className="sidebar-error">{error}</div>}

      <ul className="file-list">
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </ul>
    </aside>
  )
}
