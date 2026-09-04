import './PendingEditsBar.css'

type Props = {
  count: number
  currentPath: string | null
  onReview: () => void
  onAcceptAll: () => void
  onRejectAll: () => void
}

export function PendingEditsBar({
  count,
  currentPath,
  onReview,
  onAcceptAll,
  onRejectAll
}: Props) {
  if (count <= 0) return null
  const name = currentPath ? currentPath.split(/[/\\]/).pop() : null

  return (
    <div className="pending-edits-bar" role="status">
      <span>
        変更候補 {count} 件
        {name ? ` · 先頭: ${name}` : ''}
      </span>
      <div className="pending-edits-actions">
        <button type="button" onClick={onReview}>
          差分を確認
        </button>
        <button type="button" className="primary" onClick={onAcceptAll}>
          すべて適用
        </button>
        <button type="button" onClick={onRejectAll}>
          すべて却下
        </button>
      </div>
    </div>
  )
}
