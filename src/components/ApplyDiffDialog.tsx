import { DiffEditor } from '@monaco-editor/react'
import { useEffect } from 'react'
import './ApplyDiffDialog.css'

export type ApplyDiffProposal = {
  targetPath: string
  original: string
  modified: string
  mode: 'create' | 'replace' | 'append' | 'patch'
  language?: string
  source?: 'agent' | 'chat'
}

type Props = {
  open: boolean
  proposal: ApplyDiffProposal | null
  queueCount?: number
  queueIndex?: number
  acceptLabel?: string
  onAccept: () => void
  onReject: () => void
  onAcceptAll?: () => void
  onRejectAll?: () => void
}

function modeLabel(mode: ApplyDiffProposal['mode']): string {
  if (mode === 'create') return '新規作成'
  if (mode === 'append') return '追記'
  if (mode === 'patch') return '部分置換'
  return '置換'
}

export function ApplyDiffDialog({
  open,
  proposal,
  queueCount = 1,
  queueIndex = 0,
  acceptLabel = '適用する',
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onReject()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey && onAcceptAll) onAcceptAll()
        else onAccept()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onReject, onAccept, onAcceptAll])

  if (!open || !proposal) return null

  const fileName = proposal.targetPath.split(/[/\\]/).pop() ?? proposal.targetPath
  const multi = queueCount > 1

  return (
    <div className="apply-diff-overlay" role="dialog" aria-modal="true" aria-label="差分を確認して適用">
      <div className="apply-diff-dialog">
        <div className="apply-diff-header">
          <div>
            <h2>変更を確認</h2>
            <p>
              <span className={`apply-diff-mode apply-diff-mode--${proposal.mode}`}>
                {modeLabel(proposal.mode)}
              </span>
              <strong title={proposal.targetPath}>{fileName}</strong>
              {multi && (
                <span className="apply-diff-queue">
                  （{queueIndex + 1} / {queueCount}）
                </span>
              )}
            </p>
            <p className="apply-diff-path">{proposal.targetPath}</p>
          </div>
          <button type="button" className="apply-diff-close" onClick={onReject} title="閉じる">
            ×
          </button>
        </div>

        <div className="apply-diff-editor">
          <DiffEditor
            original={proposal.original}
            modified={proposal.modified}
            language={proposal.language || 'plaintext'}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'Cascadia Code, Consolas, monospace',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on'
            }}
          />
        </div>

        <div className="apply-diff-actions">
          {multi && onRejectAll && (
            <button type="button" onClick={onRejectAll}>
              すべて却下
            </button>
          )}
          <button type="button" onClick={onReject}>
            {multi ? 'この変更をスキップ' : 'キャンセル'}
          </button>
          {multi && onAcceptAll && (
            <button type="button" className="secondary" onClick={onAcceptAll}>
              すべて適用
            </button>
          )}
          <button type="button" className="primary" onClick={onAccept}>
            {acceptLabel}
          </button>
        </div>
        <p className="apply-diff-hint">Ctrl/Cmd+Enter で適用 · Ctrl/Cmd+Shift+Enter ですべて適用 · Esc でスキップ</p>
      </div>
    </div>
  )
}
