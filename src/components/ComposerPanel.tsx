import { useEffect, useMemo } from 'react'
import type { ApplyDiffProposal } from './ApplyDiffDialog'
import { computeDiffStats } from '../lib/diffStats'
import './ComposerPanel.css'

type Props = {
  proposals: ApplyDiffProposal[]
  activeIndex: number
  dirtyPaths?: string[]
  onSelect: (index: number) => void
  onAcceptOne: (index: number) => void
  onRejectOne: (index: number) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onClose: () => void
}

function modeLabel(mode: ApplyDiffProposal['mode']): string {
  if (mode === 'create') return '新規'
  if (mode === 'append') return '追記'
  if (mode === 'patch') return '部分'
  return '置換'
}

export function ComposerPanel({
  proposals,
  activeIndex,
  dirtyPaths = [],
  onSelect,
  onAcceptOne,
  onRejectOne,
  onAcceptAll,
  onRejectAll,
  onClose
}: Props) {
  const stats = useMemo(
    () => proposals.map((row) => computeDiffStats(row.original, row.modified)),
    [proposals]
  )

  useEffect(() => {
    if (proposals.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onSelect(Math.min(proposals.length - 1, activeIndex + 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        onSelect(Math.max(0, activeIndex - 1))
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        onAcceptOne(activeIndex)
      } else if (event.key === 'Delete' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        onRejectOne(activeIndex)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [proposals.length, activeIndex, onSelect, onAcceptOne, onRejectOne])

  if (proposals.length === 0) return null

  return (
    <aside className="composer-panel" aria-label="Composer 変更一覧">
      <div className="composer-head">
        <div>
          <strong>Composer</strong>
          <span>{proposals.length} ファイル</span>
        </div>
        <button type="button" onClick={onClose} title="一覧を隠す">
          ×
        </button>
      </div>
      <div className="composer-actions">
        <button type="button" className="primary" onClick={onAcceptAll}>
          すべて適用
        </button>
        <button type="button" onClick={onRejectAll}>
          すべて却下
        </button>
      </div>
      <ul className="composer-list">
        {proposals.map((row, index) => {
          const name = row.targetPath.split(/[/\\]/).pop() ?? row.targetPath
          const diff = stats[index]
          const conflict = dirtyPaths.some(
            (path) => path.toLowerCase() === row.targetPath.toLowerCase()
          )
          return (
            <li key={`${row.targetPath}-${index}`}>
              <button
                type="button"
                className={`composer-item${index === activeIndex ? ' is-active' : ''}${
                  conflict ? ' is-conflict' : ''
                }`}
                onClick={() => onSelect(index)}
                title={
                  conflict
                    ? `${row.targetPath}（エディタで未保存の変更あり）`
                    : row.targetPath
                }
              >
                <span className={`composer-mode composer-mode--${row.mode}`}>
                  {modeLabel(row.mode)}
                </span>
                <span className="composer-name">
                  {conflict ? '! ' : ''}
                  {name}
                </span>
                {diff && (
                  <span className="composer-stats">
                    <em className="plus">+{diff.added}</em>
                    <em className="minus">-{diff.removed}</em>
                  </span>
                )}
              </button>
              <div className="composer-item-actions">
                <button type="button" onClick={() => onAcceptOne(index)} title="適用 (Ctrl+Enter)">
                  ✓
                </button>
                <button type="button" onClick={() => onRejectOne(index)} title="却下 (Ctrl+Delete)">
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="composer-hint">↑↓ 選択 · Ctrl+Enter 適用 · Ctrl+Delete 却下</p>
    </aside>
  )
}
