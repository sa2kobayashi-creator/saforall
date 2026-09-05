import { useEffect, useMemo, useState } from 'react'
import './QuickOpenDialog.css'

export type PaletteCommand = {
  id: string
  label: string
  group?: string
}

type Props = {
  open: boolean
  commands: PaletteCommand[]
  onClose: () => void
  onRun: (commandId: string) => void
}

export function CommandPalette({ open, commands, onClose, onRun }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 40)
    return commands
      .filter(
        (row) =>
          row.label.toLowerCase().includes(q) ||
          row.id.toLowerCase().includes(q) ||
          (row.group ?? '').toLowerCase().includes(q)
      )
      .slice(0, 40)
  }, [commands, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((i) => Math.min(filtered.length - 1, i + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((i) => Math.max(0, i - 1))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const hit = filtered[index]
        if (hit) {
          onRun(hit.id)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, filtered, index, onClose, onRun])

  if (!open) return null

  return (
    <div className="quick-open-overlay" role="dialog" aria-modal="true" aria-label="コマンドパレット">
      <div className="quick-open-dialog">
        <input
          autoFocus
          value={query}
          placeholder="コマンドを検索（Ctrl+Shift+P）"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="quick-open-results">
          {filtered.length === 0 && <p className="quick-open-empty">一致なし</p>}
          {filtered.map((row, i) => (
            <button
              key={row.id}
              type="button"
              className={`quick-open-hit${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                onRun(row.id)
                onClose()
              }}
            >
              <span className="quick-open-path">{row.label}</span>
              <span className="quick-open-meta">{row.group ?? row.id}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const BUILTIN_PALETTE_COMMANDS: PaletteCommand[] = [
  { id: 'workspace:open', label: 'フォルダを開く', group: 'Workspace' },
  { id: 'file:save', label: 'ファイルを保存', group: 'File' },
  { id: 'view:explorer', label: 'エクスプローラーを表示', group: 'View' },
  { id: 'view:search', label: '検索を表示', group: 'View' },
  { id: 'view:scm', label: 'ソース管理を表示', group: 'View' },
  { id: 'view:extensions', label: '拡張機能を表示', group: 'View' },
  { id: 'view:terminal', label: 'ターミナルを表示', group: 'View' },
  { id: 'terminal:new', label: '新しいターミナル', group: 'Terminal' },
  { id: 'view:problems', label: 'Problems を表示', group: 'View' },
  { id: 'view:chat', label: 'AI チャット', group: 'View' },
  { id: 'view:settings', label: '設定を開く', group: 'View' },
  { id: 'view:commands', label: 'コマンドパレット', group: 'View' },
  { id: 'go:symbolInFile', label: 'ファイル内シンボル (Ctrl+Shift+O)', group: 'Go' },
  { id: 'go:workspaceSymbol', label: 'ワークスペースシンボル (Ctrl+T)', group: 'Go' },
  { id: 'go:peekDefinition', label: '定義をピーク (Alt+F12)', group: 'Go' },
  { id: 'go:peekReferences', label: '参照をピーク (Shift+Alt+F12)', group: 'Go' },
  { id: 'view:splitEditor', label: 'エディタを分割 (Ctrl+\\)', group: 'View' },
  { id: 'edit:inline', label: 'インライン編集 (Ctrl+K)', group: 'Edit' },
  { id: 'git:clone', label: 'リポジトリをクローン', group: 'Git' },
  { id: 'git:pull', label: 'Git Pull', group: 'Git' },
  { id: 'git:push', label: 'Git Push', group: 'Git' },
  { id: 'run:file', label: '現在のファイルを実行', group: 'Run' },
  { id: 'agent:background', label: 'Background Agent', group: 'Agent' },
  { id: 'agent:bugbot', label: 'Bugbot', group: 'Agent' },
  { id: 'help:shortcuts', label: 'キーボードショートカット', group: 'Help' }
]
