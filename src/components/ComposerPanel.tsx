import type { ApplyDiffProposal } from './ApplyDiffDialog'
import './ComposerPanel.css'

type Props = {
  proposals: ApplyDiffProposal[]
  activeIndex: number
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
  return '置換'
}

export function ComposerPanel({
  proposals,
  activeIndex,
  onSelect,
  onAcceptOne,
  onRejectOne,
  onAcceptAll,
  onRejectAll,
  onClose
}: Props) {
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
          return (
            <li key={`${row.targetPath}-${index}`}>
              <button
                type="button"
                className={`composer-item${index === activeIndex ? ' is-active' : ''}`}
                onClick={() => onSelect(index)}
                title={row.targetPath}
              >
                <span className={`composer-mode composer-mode--${row.mode}`}>
                  {modeLabel(row.mode)}
                </span>
                <span className="composer-name">{name}</span>
              </button>
              <div className="composer-item-actions">
                <button type="button" onClick={() => onAcceptOne(index)} title="適用">
                  ✓
                </button>
                <button type="button" onClick={() => onRejectOne(index)} title="却下">
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="composer-hint">選択すると差分レビューが開きます</p>
    </aside>
  )
}
