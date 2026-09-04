import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorSelection, OpenFile } from '../types'
import type { ProblemItem } from './ProblemsPanel'
import type { DebugBreakpointMap } from '../lib/debugTypes'
import { disposeTabCompletions, registerTabCompletions } from '../lib/tabCompletions'
import { disposeLspProviders, registerLspProviders } from '../lib/lspProviders'
import { InlineEditBar, type InlineEditTarget } from './InlineEditBar'
import { PreviewPane, supportsPreview } from './PreviewPane'
import './EditorPane.css'
import './PreviewPane.css'

type PreviewMode = 'edit' | 'preview' | 'split'

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
  onOpenDefinition?: (path: string, line?: number) => void
  revealLine?: number | null
  breakpoints?: DebugBreakpointMap
  onToggleBreakpoint?: (path: string, line: number) => void
  pausedLine?: { path: string; line: number } | null
  /** Increment to open Ctrl+K from outside (menu) */
  inlineEditTrigger?: number
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
  onOpenDefinition,
  revealLine,
  breakpoints = {},
  onToggleBreakpoint,
  pausedLine = null,
  inlineEditTrigger = 0
}: Props) {
  const file = tabs.find((tab) => tab.path === activePath) ?? null
  const dragRef = useRef<{ path: string; startX: number; startWidth: number } | null>(
    null
  )
  const selectionHandlerRef = useRef(onSelectionChange)
  selectionHandlerRef.current = onSelectionChange
  const diagnosticsHandlerRef = useRef(onDiagnostics)
  diagnosticsHandlerRef.current = onDiagnostics
  const openDefinitionRef = useRef(onOpenDefinition)
  openDefinitionRef.current = onOpenDefinition
  const toggleBpRef = useRef(onToggleBreakpoint)
  toggleBpRef.current = onToggleBreakpoint
  const breakpointsRef = useRef(breakpoints)
  breakpointsRef.current = breakpoints
  const pausedLineRef = useRef(pausedLine)
  pausedLineRef.current = pausedLine
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath
  const fileMetaRef = useRef<{ path: string; language: string } | null>(null)
  fileMetaRef.current = file ? { path: file.path, language: file.language } : null
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const decorationIdsRef = useRef<string[]>([])
  const [inlineTarget, setInlineTarget] = useState<InlineEditTarget | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('edit')
  const openInlineEditRef = useRef<() => void>(() => undefined)

  const openInlineEdit = useCallback(() => {
    const editor = editorRef.current
    const meta = fileMetaRef.current
    if (!editor || !meta) return
    const model = editor.getModel()
    if (!model) return

    let sel = editor.getSelection()
    if (!sel) return
    if (sel.isEmpty()) {
      const line = sel.startLineNumber
      editor.setSelection({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line)
      })
      sel = editor.getSelection()
      if (!sel || sel.isEmpty()) return
    }

    const selected = model.getValueInRange(sel)
    if (!selected.trim()) return

    const startOffset = model.getOffsetAt({
      lineNumber: sel.startLineNumber,
      column: sel.startColumn
    })
    const endOffset = model.getOffsetAt({
      lineNumber: sel.endLineNumber,
      column: sel.endColumn
    })
    const full = model.getValue()
    setInlineTarget({
      path: meta.path,
      language: meta.language,
      selection: selected,
      prefix: full.slice(Math.max(0, startOffset - 2500), startOffset),
      suffix: full.slice(endOffset, Math.min(full.length, endOffset + 1500)),
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      startColumn: sel.startColumn,
      endColumn: sel.endColumn
    })
  }, [])
  openInlineEditRef.current = openInlineEdit

  useEffect(() => {
    if (!file || !supportsPreview(file.language, file.path)) {
      setPreviewMode('edit')
    }
  }, [file?.path, file?.language])

  useEffect(() => {
    if (inlineEditTrigger > 0) openInlineEdit()
  }, [inlineEditTrigger, openInlineEdit])

  useEffect(() => {
    return () => {
      disposeTabCompletions()
      disposeLspProviders()
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !revealLine || revealLine < 1) return
    editor.revealLineInCenter(revealLine)
    editor.setPosition({ lineNumber: revealLine, column: 1 })
    editor.focus()
  }, [revealLine, activePath])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !activePath) return

    const lines = (breakpoints[activePath] ?? []).map((row) => row.line)
    const decorations: Array<{
      range: unknown
      options: Record<string, unknown>
    }> = lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'saforall-breakpoint-glyph',
        glyphMarginHoverMessage: { value: 'Breakpoint' }
      }
    }))

    if (
      pausedLine &&
      pausedLine.path.toLowerCase() === activePath.toLowerCase() &&
      pausedLine.line > 0
    ) {
      decorations.push({
        range: new monaco.Range(pausedLine.line, 1, pausedLine.line, 1),
        options: {
          isWholeLine: true,
          className: 'saforall-debug-paused-line',
          glyphMarginClassName: 'saforall-debug-paused-glyph'
        }
      })
    }

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      decorations as never
    )
  }, [breakpoints, pausedLine, activePath, file?.content])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    registerTabCompletions(monaco, () => fileMetaRef.current)
    registerLspProviders(
      monaco,
      () => fileMetaRef.current,
      (path, line) => {
        openDefinitionRef.current?.(path, line)
      }
    )

    editor.addAction({
      id: 'saforall.inlineEdit',
      label: 'Inline Edit (Ctrl+K)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        openInlineEditRef.current()
      }
    })

    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
      })
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
      })
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemas: [],
        enableSchemaRequest: false
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

    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const line = event.target.position?.lineNumber
      const path = activePathRef.current
      if (!line || !path || !toggleBpRef.current) return
      toggleBpRef.current(path, line)
    })

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
        <p className="hint">Ctrl/Cmd + K: 選択範囲を AI インライン編集</p>
        <p className="hint">左余白クリックでブレークポイント / Shift+F5 でデバッグ</p>
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
        {supportsPreview(file.language, file.path) && (
          <div className="preview-mode-group" role="group" aria-label="プレビュー表示">
            {(
              [
                ['edit', '編集'],
                ['split', '分割'],
                ['preview', 'プレビュー']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`preview-mode-btn ${previewMode === mode ? 'active' : ''}`}
                onClick={() => setPreviewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="save-btn" onClick={onSave}>
          保存
        </button>
      </div>
      <InlineEditBar
        target={inlineTarget}
        onClose={() => setInlineTarget(null)}
        onApplied={(edited) => {
          const editor = editorRef.current
          const target = inlineTarget
          if (!editor || !target) {
            setInlineTarget(null)
            return
          }
          const range = {
            startLineNumber: target.startLine,
            startColumn: target.startColumn,
            endLineNumber: target.endLine,
            endColumn: target.endColumn
          }
          editor.executeEdits('saforall-inline-edit', [
            {
              range,
              text: edited,
              forceMoveMarkers: true
            }
          ])
          const model = editor.getModel()
          if (model) {
            onChange(model.getValue())
          }
          setInlineTarget(null)
          editor.focus()
        }}
      />
      <div
        className={
          previewMode === 'split' && supportsPreview(file.language, file.path)
            ? 'editor-preview-split'
            : 'editor-host-wrap'
        }
      >
        {previewMode !== 'preview' && (
          <div className="editor-host">
            <Editor
              path={file.path}
              language={file.language}
              value={file.content}
              theme="vs-dark"
              loading={<div className="editor-loading">エディタを読み込み中…</div>}
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
                glyphMargin: true,
                inlineSuggest: { enabled: true }
              }}
            />
          </div>
        )}
        {previewMode !== 'edit' && supportsPreview(file.language, file.path) && (
          <PreviewPane
            language={file.language}
            content={file.content}
            fileName={file.path.split(/[/\\]/).pop()}
          />
        )}
      </div>
    </div>
  )
}
