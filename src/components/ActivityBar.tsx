import './ActivityBar.css'

type Props = {
  chatOpen: boolean
  settingsOpen: boolean
  onToggleChat: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
}

export function ActivityBar({
  chatOpen,
  settingsOpen,
  onToggleChat,
  onOpenWorkspace,
  onOpenSettings
}: Props) {
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
      <button
        type="button"
        className={`activity-btn ${settingsOpen ? 'active' : ''}`}
        title="設定"
        onClick={onOpenSettings}
      >
        ⚙
      </button>
    </aside>
  )
}
