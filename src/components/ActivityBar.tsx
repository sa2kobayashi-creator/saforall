import './ActivityBar.css'

type Props = {
  chatOpen: boolean
  settingsOpen: boolean
  terminalOpen: boolean
  onToggleChat: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
  onToggleTerminal: () => void
}

export function ActivityBar({
  chatOpen,
  settingsOpen,
  terminalOpen,
  onToggleChat,
  onOpenWorkspace,
  onOpenSettings,
  onToggleTerminal
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
        className={`activity-btn ${terminalOpen ? 'active' : ''}`}
        title="ターミナル"
        onClick={onToggleTerminal}
      >
        ⌨
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
