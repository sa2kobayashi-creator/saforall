import Editor, { type OnMount } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import type { EditorSelection, OpenFile } from '../types'
import type { ProblemItem } from './ProblemsPanel'
import { disposeTabCompletions, registerTabCompletions } from '../lib/tabCompletions'
import './EditorPane.css'

type Props = {
  tabs: OpenFile[]
  activePath: string | null
  tabWidths: Record<string, number>
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onResizeTab: (path: string, width: number) => void
  onChange: (content: string) => void
  onSave: () => void
  onSelectionChange?: (selection: EditorSelection | null) => void
  onDiagnostics?: (items: ProblemItem[]) => void
  revealLine?: number | null
}

const DEFAULT_TAB_WIDTH = 160
const MIN_TAB_WIDTH = 88
const MAX_TAB_WIDTH = 480

export function EditorPane({
  tabs,
  activePath,
  tabWidths,
  onSelectTab,
  onCloseTab,
  onResizeTab,
  onChange,
  onSave,
  onSelectionChange,
  onDiagnostics,
  revealLine
}: Props) {
  const file = tabs.find((tab) => tab.path === activePath) ?? null
  const dragRef = useRef<{ path: string; startX: number; startWidth: number } | null>(
    null
  )
  const selectionHandlerRef = useRef(onSelectionChange)
  selectionHandlerRef.current = onSelectionChange
  const diagnosticsHandlerRef = useRef(onDiagnostics)
  diagnosticsHandlerRef.current = onDiagnostics
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath
  const fileMetaRef = useRef<{ path: string; language: string } | null>(null)
  fileMetaRef.current = file ? { path: file.path, language: file.language } : null
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  useEffect(() => {
    return () => {
      disposeTabCompletions()
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !revealLine || revealLine < 1) return
    editor.revealLineInCenter(revealLine)
    editor.setPosition({ lineNumber: revealLine, column: 1 })
    editor.focus()
  }, [revealLine, activePath])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    registerTabCompletions(monaco, () => fileMetaRef.current)

    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
      })
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
      })
    } catch {
      // language service may be unavailable
    }

    const emitMarkers = () => {
      const handler = diagnosticsHandlerRef.current
      if (!handler) return
      const markers = monaco.editor.getModelMarkers({})
      const items: ProblemItem[] = markers
        .filter((marker: { severity: number }) => marker.severity > 0)
        .slice(0, 200)
        .map(
          (
            marker: {
              severity: number
              resource: { path?: string }
              startLineNumber: number
              startColumn: number
              message: string
              source?: string
            },
            index: number
          ) => {
          const severity =
            marker.severity === 8
              ? 'error'
              : marker.severity === 4
                ? 'warning'
                : 'info'
          const resource = marker.resource.path
            ? decodeURIComponent(marker.resource.path.replace(/^\//, ''))
            : activePathRef.current ?? 'unknown'
          const path = resource.replace(/^([A-Za-z])%3A/i, '$1:')
          return {
            id: `monaco:${path}:${marker.startLineNumber}:${marker.startColumn}:${index}`,
            severity,
            source: marker.source || 'LSP',
            message: marker.message,
            path,
            line: marker.startLineNumber,
            column: marker.startColumn
          }
        }
        )
      handler(items)
    }

    const sub = monaco.editor.onDidChangeMarkers(() => {
      emitMarkers()
    })
    window.setTimeout(emitMarkers, 500)

    const emitSelection = () => {
      const handler = selectionHandlerRef.current
      if (!handler) return
      const model = editor.getModel()
      const sel = editor.getSelection()
      const path = activePathRef.current
      if (!model || !sel || sel.isEmpty() || !path) {
        handler(null)
        return
      }
      handler({
        path,
        text: model.getValueInRange(sel),
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber
      })
    }

    editor.onDidChangeCursorSelection(emitSelection)
    emitSelection()

    editor.onDidDispose(() => {
      sub.dispose()
    })
  }

  if (tabs.length === 0 || !file) {
    return (
      <div className="editor-empty">
        <h1>saforall</h1>
        <p>左のツリーからファイルを開くと、タブで複数編集できます。</p>
        <p className="hint">保存: Ctrl / Cmd + S（フォーカス時）</p>
        <p className="hint">Tab 補完: 入力を止めると候補が出ます（Tab で確定）</p>
        <p className="hint">タブ右端をドラッグすると幅を変更できます</p>
      </div>
    )
  }

  return (
    <div
      className="editor-pane"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSave()
        }
      }}
    >
      <div className="editor-tabs">
        <div className="editor-tab-list">
          {tabs.map((tab) => {
            const name = tab.path.split(/[/\\]/).pop()
            const active = tab.path === activePath
            const width = tabWidths[tab.path] ?? DEFAULT_TAB_WIDTH
            return (
              <div
                key={tab.path}
                className={`editor-tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}`}
                style={{ width }}
              >
                <button
                  type="button"
                  className="editor-tab-label"
                  onClick={() => onSelectTab(tab.path)}
                  title={tab.path}
                >
                  {name}
                  {tab.dirty ? ' •' : ''}
                </button>
                <button
                  type="button"
                  className="editor-tab-close"
                  title="閉じる"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.path)
                  }}
                >
                  ×
                </button>
                <div
                  className="editor-tab-resize"
                  title="幅を変更"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    dragRef.current = {
                      path: tab.path,
                      startX: event.clientX,
                      startWidth: width
                    }

                    const onMove = (moveEvent: MouseEvent) => {
                      const drag = dragRef.current
                      if (!drag) return
                      const next = Math.min(
                        MAX_TAB_WIDTH,
                        Math.max(
                          MIN_TAB_WIDTH,
                          drag.startWidth + (moveEvent.clientX - drag.startX)
                        )
                      )
                      onResizeTab(drag.path, next)
                    }

                    const onUp = () => {
                      dragRef.current = null
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                      document.body.style.cursor = ''
                      document.body.style.userSelect = ''
                    }

                    document.body.style.cursor = 'col-resize'
                    document.body.style.userSelect = 'none'
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                />
              </div>
            )
          })}
        </div>
        <button type="button" className="save-btn" onClick={onSave}>
          保存
        </button>
      </div>
      <div className="editor-host">
        <Editor
          path={file.path}
          language={file.language}
          value={file.content}
          theme="vs-dark"
          onMount={handleMount}
          onChange={(value) => onChange(value ?? '')}
          options={{
            fontSize: 14,
            fontFamily: 'Cascadia Code, Consolas, monospace',
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            inlineSuggest: { enabled: true }
          }}
        />
      </div>
    </div>
  )
}
