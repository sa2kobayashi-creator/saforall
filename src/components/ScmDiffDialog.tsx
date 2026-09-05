import { DiffEditor } from '@monaco-editor/react'
import { useEffect } from 'react'
import './ApplyDiffDialog.css'

export type ScmDiffView = {
  path: string
  original: string
  modified: string
  staged: boolean
  language?: string
}

type Props = {
  open: boolean
  view: ScmDiffView | null
  onClose: () => void
  onOpenFile?: (path: string) => void
}

export function ScmDiffDialog({ open, view, onClose, onOpenFile }: Props) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !view) return null
  const fileName = view.path.split(/[/\\]/).pop() ?? view.path

  return (
    <div className="apply-diff-overlay" role="dialog" aria-modal="true" aria-label="Git 差分">
      <div className="apply-diff-dialog">
        <div className="apply-diff-header">
          <div>
            <h2>Git Diff {view.staged ? '(staged)' : '(working tree)'}</h2>
            <p>
              <strong title={view.path}>{fileName}</strong>
            </p>
            <p className="apply-diff-path">{view.path}</p>
          </div>
          <button type="button" className="apply-diff-close" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="apply-diff-editor">
          <DiffEditor
            original={view.original}
            modified={view.modified}
            language={view.language || 'plaintext'}
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
          {onOpenFile && (
            <button type="button" onClick={() => onOpenFile(view.path)}>
              ファイルを開く
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
        <p className="apply-diff-hint">Esc で閉じる</p>
      </div>
    </div>
  )
}
