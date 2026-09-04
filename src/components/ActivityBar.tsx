import './ActivityBar.css'

export type SidebarView = 'explorer' | 'scm' | 'extensions'

type Props = {
  activeView: SidebarView
  chatOpen: boolean
  settingsOpen: boolean
  usageOpen: boolean
  terminalOpen: boolean
  onChangeView: (view: SidebarView) => void
  onToggleChat: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
  onOpenUsage: () => void
  onToggleTerminal: () => void
  onRunFile?: () => void
}

export function ActivityBar({
  activeView,
  chatOpen,
  settingsOpen,
  usageOpen,
  terminalOpen,
  onChangeView,
  onToggleChat,
  onOpenWorkspace,
  onOpenSettings,
  onOpenUsage,
  onToggleTerminal,
  onRunFile
}: Props) {
  return (
    <aside className="activity-bar" aria-label="アクティビティバー">
      <button
        type="button"
        className={`activity-btn ${activeView === 'explorer' ? 'active' : ''}`}
        title="Explorer"
        onClick={() => onChangeView('explorer')}
      >
        📁
      </button>
      <button
        type="button"
        className={`activity-btn ${activeView === 'scm' ? 'active' : ''}`}
        title="Source Control"
        onClick={() => onChangeView('scm')}
      >
        ⎇
      </button>
      <button
        type="button"
        className={`activity-btn ${activeView === 'extensions' ? 'active' : ''}`}
        title="Extensions"
        onClick={() => onChangeView('extensions')}
      >
        ▤
      </button>
      <div className="activity-spacer" />
      <button
        type="button"
        className="activity-btn"
        title="フォルダを開く"
        onClick={onOpenWorkspace}
      >
        📂
      </button>
      {onRunFile && (
        <button type="button" className="activity-btn" title="Run Current File (F5)" onClick={onRunFile}>
          ▶
        </button>
      )}
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
        className={`activity-btn ${usageOpen ? 'active' : ''}`}
        title="AI 使用量"
        onClick={onOpenUsage}
      >
        $
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
