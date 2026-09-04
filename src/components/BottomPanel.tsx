import { TerminalPanel } from './TerminalPanel'
import { ProblemsPanel, type ProblemItem } from './ProblemsPanel'
import './BottomPanel.css'

export type BottomPanelTab = 'terminal' | 'problems'

type Props = {
  open: boolean
  height: number
  activeTab: BottomPanelTab
  cwd: string | null
  pendingCommand: string | null
  problems: ProblemItem[]
  onChangeTab: (tab: BottomPanelTab) => void
  onCommandSent: () => void
  onClose: () => void
  onOpenFile: (path: string) => void
}

export function BottomPanel({
  open,
  height,
  activeTab,
  cwd,
  pendingCommand,
  problems,
  onChangeTab,
  onCommandSent,
  onClose,
  onOpenFile
}: Props) {
  if (!open) return null

  return (
    <section className="bottom-panel" style={{ height }} aria-label="下部パネル">
      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'terminal'}
            className={activeTab === 'terminal' ? 'active' : ''}
            onClick={() => onChangeTab('terminal')}
          >
            TERMINAL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'problems'}
            className={activeTab === 'problems' ? 'active' : ''}
            onClick={() => onChangeTab('problems')}
          >
            PROBLEMS{problems.length > 0 ? ` (${problems.length})` : ''}
          </button>
        </div>
        <div className="bottom-panel-actions">
          {activeTab === 'terminal' && (
            <span className="bottom-panel-hint">{cwd ?? 'カレントディレクトリ'}</span>
          )}
          <button type="button" title="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="bottom-panel-body">
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'terminal'}
          style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalPanel
            open={open}
            embedded
            height={height}
            fitTrigger={activeTab}
            cwd={cwd}
            pendingCommand={activeTab === 'terminal' ? pendingCommand : null}
            onCommandSent={onCommandSent}
          />
        </div>
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'problems'}
          style={{ display: activeTab === 'problems' ? 'flex' : 'none' }}
        >
          <ProblemsPanel problems={problems} onOpenFile={onOpenFile} />
        </div>
      </div>
    </section>
  )
}
