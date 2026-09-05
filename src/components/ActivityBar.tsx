import { useI18n } from '../i18n'
import './ActivityBar.css'

export type SidebarView = 'explorer' | 'search' | 'scm' | 'extensions'

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
  const { t } = useI18n()

  return (
    <aside className="activity-bar" aria-label={t('activity.aria')}>
      <button
        type="button"
        className={`activity-btn ${activeView === 'explorer' ? 'active' : ''}`}
        title={t('activity.explorer')}
        onClick={() => onChangeView('explorer')}
      >
        📁
      </button>
      <button
        type="button"
        className={`activity-btn ${activeView === 'search' ? 'active' : ''}`}
        title={t('activity.search')}
        onClick={() => onChangeView('search')}
      >
        🔎
      </button>
      <button
        type="button"
        className={`activity-btn ${activeView === 'scm' ? 'active' : ''}`}
        title={t('activity.scm')}
        onClick={() => onChangeView('scm')}
      >
        ⎇
      </button>
      <button
        type="button"
        className={`activity-btn ${activeView === 'extensions' ? 'active' : ''}`}
        title={t('activity.extensions')}
        onClick={() => onChangeView('extensions')}
      >
        ▤
      </button>
      <div className="activity-spacer" />
      <button
        type="button"
        className="activity-btn"
        title={t('activity.openFolder')}
        onClick={onOpenWorkspace}
      >
        📂
      </button>
      {onRunFile && (
        <button
          type="button"
          className="activity-btn"
          title={t('activity.runFile')}
          onClick={onRunFile}
        >
          ▶
        </button>
      )}
      <button
        type="button"
        className={`activity-btn ${chatOpen ? 'active' : ''}`}
        title={t('activity.chat')}
        onClick={onToggleChat}
      >
        ✨
      </button>
      <button
        type="button"
        className={`activity-btn ${usageOpen ? 'active' : ''}`}
        title={t('activity.usage')}
        onClick={onOpenUsage}
      >
        $
      </button>
      <button
        type="button"
        className={`activity-btn ${terminalOpen ? 'active' : ''}`}
        title={t('activity.terminal')}
        onClick={onToggleTerminal}
      >
        ⌨
      </button>
      <button
        type="button"
        className={`activity-btn ${settingsOpen ? 'active' : ''}`}
        title={t('activity.settings')}
        onClick={onOpenSettings}
      >
        ⚙
      </button>
    </aside>
  )
}
