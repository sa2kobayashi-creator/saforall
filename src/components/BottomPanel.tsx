import { TerminalPanel } from './TerminalPanel'
import { ProblemsPanel, type ProblemItem } from './ProblemsPanel'
import { DebugPanel } from './DebugPanel'
import { ReferencesPanel, type ReferenceHit } from './ReferencesPanel'
import { JobsPanel } from './JobsPanel'
import { TimelinePanel } from './TimelinePanel'
import type { DebugCallFrame } from '../lib/debugTypes'
import { useI18n } from '../i18n'
import './BottomPanel.css'

export type BottomPanelTab = 'terminal' | 'problems' | 'debug' | 'references' | 'jobs' | 'timeline'

type Props = {
  open: boolean
  height: number
  activeTab: BottomPanelTab
  cwd: string | null
  activePath: string | null
  historyRefreshKey?: number
  pendingCommand: string | null
  problems: ProblemItem[]
  references: {
    hits: ReferenceHit[]
    symbolLabel?: string | null
    loading?: boolean
    onOpen: (path: string, line: number) => void
  }
  onJobDetail?: (job: {
    id: string
    kind: 'agent' | 'bugbot'
    title: string
    status: string
    summary?: string
    error?: string
    prompt?: string
  }) => void
  onHistoryRestore?: (path: string, content: string) => void
  onStatusMessage?: (message: string) => void
  debug: {
    running: boolean
    paused: boolean
    port: number | null
    frames: DebugCallFrame[]
    variables: import('../lib/debugTypes').DebugVariable[]
    watches: Array<{ expression: string; value?: string }>
    breakpoints: import('../lib/debugTypes').DebugBreakpointMap
    logs: string[]
    breakpointCount: number
    exceptionBreakMode: 'none' | 'uncaught' | 'all'
    onExceptionBreakModeChange: (mode: 'none' | 'uncaught' | 'all') => void
    onContinue: () => void
    onStepOver: () => void
    onStop: () => void
    onStart: () => void
    onOpenFrame: (frame: DebugCallFrame) => void
    onAddWatch: (expression: string) => void
    onRemoveWatch: (expression: string) => void
    onSetBreakpointCondition: (path: string, line: number, condition: string) => void
  }
  onChangeTab: (tab: BottomPanelTab) => void
  onCommandSent: () => void
  onClose: () => void
  onOpenFile: (path: string, line?: number) => void
}

export function BottomPanel({
  open,
  height,
  activeTab,
  cwd,
  activePath,
  historyRefreshKey = 0,
  pendingCommand,
  problems,
  references,
  onJobDetail,
  onHistoryRestore,
  onStatusMessage,
  debug,
  onChangeTab,
  onCommandSent,
  onClose,
  onOpenFile
}: Props) {
  const { t } = useI18n()

  return (
    <section
      className={`bottom-panel${open ? '' : ' is-collapsed'}`}
      style={{ height: open ? height : 0 }}
      aria-label={t('bottom.aria')}
      aria-hidden={!open}
      hidden={!open}
    >
      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'terminal'}
            className={activeTab === 'terminal' ? 'active' : ''}
            onClick={() => onChangeTab('terminal')}
          >
            {t('bottom.terminal')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'problems'}
            className={activeTab === 'problems' ? 'active' : ''}
            onClick={() => onChangeTab('problems')}
          >
            {t('bottom.problems')}
            {problems.length > 0 ? ` (${problems.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'debug'}
            className={activeTab === 'debug' ? 'active' : ''}
            onClick={() => onChangeTab('debug')}
          >
            {t('bottom.debug')}
            {debug.paused ? ' ●' : debug.running ? ' ▸' : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'references'}
            className={activeTab === 'references' ? 'active' : ''}
            onClick={() => onChangeTab('references')}
          >
            References
            {references.hits.length > 0 ? ` (${references.hits.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'jobs'}
            className={activeTab === 'jobs' ? 'active' : ''}
            onClick={() => onChangeTab('jobs')}
          >
            Jobs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timeline'}
            className={activeTab === 'timeline' ? 'active' : ''}
            onClick={() => onChangeTab('timeline')}
          >
            Timeline
          </button>
        </div>
        <div className="bottom-panel-actions">
          {activeTab === 'terminal' && (
            <span className="bottom-panel-hint">{cwd ?? t('bottom.cwd')}</span>
          )}
          <button type="button" title={t('common.close')} onClick={onClose}>
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
            open
            visible={open && activeTab === 'terminal'}
            embedded
            height={height}
            fitTrigger={`${activeTab}-${open}-${height}`}
            cwd={cwd}
            pendingCommand={open && activeTab === 'terminal' ? pendingCommand : null}
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
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'debug'}
          style={{ display: activeTab === 'debug' ? 'flex' : 'none' }}
        >
          <DebugPanel {...debug} />
        </div>
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'references'}
          style={{ display: activeTab === 'references' ? 'flex' : 'none' }}
        >
          <ReferencesPanel {...references} />
        </div>
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'jobs'}
          style={{ display: activeTab === 'jobs' ? 'flex' : 'none' }}
        >
          <JobsPanel onOpenPrompt={onJobDetail} />
        </div>
        <div
          className="bottom-panel-page"
          hidden={activeTab !== 'timeline'}
          style={{ display: activeTab === 'timeline' ? 'flex' : 'none' }}
        >
          <TimelinePanel
            workspacePath={cwd}
            activePath={activePath}
            refreshKey={historyRefreshKey}
            onRestore={(path, content) => onHistoryRestore?.(path, content)}
            onStatusMessage={onStatusMessage}
          />
        </div>
      </div>
    </section>
  )
}
