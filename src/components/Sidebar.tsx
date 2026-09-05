import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
  refreshKey?: number
  onOpenWorkspace: () => void
  onOpenFile: (path: string) => void
  onStatusMessage?: (message: string) => void
}

type MenuState = {
  x: number
  y: number
  entry: DirEntry | null
  parentPath: string
}

type TreeNodeProps = {
  entry: DirEntry
  depth: number
  activePath: string | null
  refreshToken: number
  onOpenFile: (path: string) => void
  onContextMenu: (event: ReactMouseEvent, entry: DirEntry) => void
}

function TreeNode({
  entry,
  depth,
  activePath,
  refreshToken,
  onOpenFile,
  onContextMenu
}: TreeNodeProps) {
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

  useEffect(() => {
    if (expanded) void loadChildren()
  }, [refreshToken, expanded, loadChildren])

  const onToggle = async () => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path)
      return
    }
    const next = !expanded
    setExpanded(next)
    if (next && children === null) await loadChildren()
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
        onContextMenu={(event) => onContextMenu(event, entry)}
        title={entry.path}
      >
        <span className="file-icon">{entry.isDirectory ? (expanded ? '📂' : '📁') : '📄'}</span>
        <span className="file-name">{entry.name}</span>
      </button>
      {entry.isDirectory && expanded && (
        <ul className="file-list nested">
          {loading && <li className="file-meta">読み込み中…</li>}
          {error && <li className="file-meta error">{error}</li>}
          {!loading && children?.length === 0 && <li className="file-meta">空のフォルダ</li>}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              refreshToken={refreshToken}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
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
  refreshKey = 0,
  onOpenWorkspace,
  onOpenFile,
  onStatusMessage
}: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const { t } = useI18n()

  const reloadRoot = useCallback(async () => {
    if (!workspacePath) {
      setEntries([])
      return
    }
    try {
      const list = await window.saforall.readDir(workspacePath)
      setEntries(list)
      setError(null)
      setRefreshToken((n) => n + 1)
    } catch (err) {
      setError(String(err))
    }
  }, [workspacePath])

  useEffect(() => {
    void reloadRoot()
  }, [reloadRoot, refreshKey])

  useEffect(() => {
    if (!menu) return
    const onDoc = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const joinPath = (parent: string, name: string) => {
    const sep = parent.includes('\\') ? '\\' : '/'
    return `${parent.replace(/[/\\]+$/, '')}${sep}${name}`
  }

  const runCreate = async (isDirectory: boolean) => {
    if (!menu) return
    const label = isDirectory ? 'フォルダ名' : 'ファイル名'
    const name = window.prompt(`${label}を入力してください`)
    if (!name?.trim()) return
    const target = joinPath(menu.parentPath, name.trim())
    try {
      if (isDirectory) {
        await window.saforall.mkdir(target)
      } else {
        await window.saforall.writeFile(target, '')
      }
      onStatusMessage?.(`${isDirectory ? 'フォルダ' : 'ファイル'}を作成: ${name.trim()}`)
      setMenu(null)
      await reloadRoot()
      if (!isDirectory) onOpenFile(target)
    } catch (err) {
      onStatusMessage?.(String(err))
    }
  }

  const runRename = async () => {
    if (!menu?.entry) return
    const nextName = window.prompt('新しい名前', menu.entry.name)
    if (!nextName?.trim() || nextName.trim() === menu.entry.name) return
    const parent = menu.entry.path.replace(/[/\\][^/\\]+$/, '')
    const to = joinPath(parent, nextName.trim())
    try {
      await window.saforall.renamePath({ from: menu.entry.path, to })
      onStatusMessage?.(`リネーム: ${nextName.trim()}`)
      setMenu(null)
      await reloadRoot()
    } catch (err) {
      onStatusMessage?.(String(err))
    }
  }

  const runDelete = async () => {
    if (!menu?.entry) return
    const ok = window.confirm(`削除しますか？\n${menu.entry.path}`)
    if (!ok) return
    try {
      await window.saforall.deletePath(menu.entry.path)
      onStatusMessage?.(`削除: ${menu.entry.name}`)
      setMenu(null)
      await reloadRoot()
    } catch (err) {
      onStatusMessage?.(String(err))
    }
  }

  return (
    <aside className="sidebar" style={{ width }} aria-label={t('sidebar.explorer')}>
      <div className="sidebar-header">
        <strong>{t('sidebar.explorer')}</strong>
        <button type="button" onClick={onOpenWorkspace} title={t('common.openFolder')}>
          {t('common.openFolder')}
        </button>
      </div>
      {!workspacePath ? (
        <div className="sidebar-empty">
          <p>{t('sidebar.noWorkspace')}</p>
          <button type="button" className="primary" onClick={onOpenWorkspace}>
            {t('sidebar.openFolder')}
          </button>
        </div>
      ) : (
        <div
          className="sidebar-tree"
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({
              x: event.clientX,
              y: event.clientY,
              entry: null,
              parentPath: workspacePath
            })
          }}
        >
          {error && <p className="file-meta error">{error}</p>}
          <ul className="file-list">
            {entries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                activePath={activePath}
                refreshToken={refreshToken}
                onOpenFile={onOpenFile}
                onContextMenu={(event, target) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    entry: target,
                    parentPath: target.isDirectory
                      ? target.path
                      : target.path.replace(/[/\\][^/\\]+$/, '') || workspacePath
                  })
                }}
              />
            ))}
          </ul>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="explorer-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button type="button" role="menuitem" onClick={() => void runCreate(false)}>
            新規ファイル
          </button>
          <button type="button" role="menuitem" onClick={() => void runCreate(true)}>
            新規フォルダ
          </button>
          {menu.entry && (
            <>
              <button type="button" role="menuitem" onClick={() => void runRename()}>
                リネーム
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => void runDelete()}>
                削除
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
