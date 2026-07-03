import './ActivityBar.css'

type Props = {
  chatOpen: boolean
  onToggleChat: () => void
  onOpenWorkspace: () => void
}

export function ActivityBar({ chatOpen, onToggleChat, onOpenWorkspace }: Props) {
  return (
    <aside className="activity-bar" aria-label="アクティビティバー">
      <button
        type="button"
        className="activity-btn"
        title="フォルダを開く"
        onClick={onOpenWorkspace}
      >
        📁
      </button>
      <button
        type="button"
        className={`activity-btn ${chatOpen ? 'active' : ''}`}
        title="AI チャット"
        onClick={onToggleChat}
      >
        ✨
      </button>
    </aside>
  )
}
