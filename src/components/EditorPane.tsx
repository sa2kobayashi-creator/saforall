import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorSelection, OpenFile } from '../types'
import type { ProblemItem } from './ProblemsPanel'
import type { DebugBreakpointMap } from '../lib/debugTypes'
import { disposeTabCompletions, registerTabCompletions } from '../lib/tabCompletions'
import { disposeLspProviders, registerLspProviders } from '../lib/lspProviders'
import { InlineEditBar, type InlineEditTarget } from './InlineEditBar'
import { PreviewPane, supportsPreview } from './PreviewPane'
import {
  EditorBreadcrumbs,
  OutlinePanel,
  useDocumentSymbols
} from './OutlinePanel'
import './EditorPane.css'
import './PreviewPane.css'

type PreviewMode = 'edit' | 'preview' | 'split'

type Props = {
  tabs: OpenFile[]
  activePath: string | null
  tabWidths: Record<string, number>
  backendConnected?: boolean
  workspacePath?: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onResizeTab: (path: string, width: number) => void
  onChange: (content: string) => void
  onSave: () => void
  onSelectionChange?: (selection: EditorSelection | null) => void
  onDiagnostics?: (items: ProblemItem[]) => void
  onOpenDefinition?: (path: string, line?: number) => void
  onFindReferences?: (hits: Array<{
    path: string
    line: number
    column: number
    endLine?: number
    endColumn?: number
  }>, symbolLabel?: string) => void
  onApplyLspEdits?: (
    edits: Array<{
      path: string
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
  ) => Promise<void> | void
  revealLine?: number | null
  breakpoints?: DebugBreakpointMap
  onToggleBreakpoint?: (path: string, line: number) => void
  pausedLine?: { path: string; line: number } | null
  /** Increment to open Ctrl+K from outside (menu) */
  inlineEditTrigger?: number
  /** Increment to run peek definition / references from menu */
  peekDefinitionTrigger?: number
  peekReferencesTrigger?: number
  /** Register Monaco LSP/tab providers (only one pane should) */
  registerProviders?: boolean
  showOutline?: boolean
  onEditorFocus?: () => void
  onStatusMessage?: (message: string) => void
}

const DEFAULT_TAB_WIDTH = 160
const MIN_TAB_WIDTH = 88
const MAX_TAB_WIDTH = 480

export function EditorPane({
  tabs,
  activePath,
  tabWidths,
  backendConnected = false,
  workspacePath = null,
  onSelectTab,
  onCloseTab,
  onResizeTab,
  onChange,
  onSave,
  onSelectionChange,
  onDiagnostics,
  onOpenDefinition,
  onFindReferences,
  onApplyLspEdits,
  revealLine,
  breakpoints = {},
  onToggleBreakpoint,
  pausedLine = null,
  inlineEditTrigger = 0,
  peekDefinitionTrigger = 0,
  peekReferencesTrigger = 0,
  registerProviders = true,
  showOutline = true,
  onEditorFocus,
  onStatusMessage
}: Props) {
  const file = tabs.find((tab) => tab.path === activePath) ?? null
  const dragRef = useRef<{ path: string; startX: number; startWidth: number } | null>(
    null
  )
  const symbols = useDocumentSymbols(activePath)
  const [cursorLine, setCursorLine] = useState(1)
  const [blameOn, setBlameOn] = useState(false)
  const blameDecorationsRef = useRef<string[]>([])
  const blameMapRef = useRef<
    Map<number, { author: string; commit: string; summary: string }>
  >(new Map())
  const backendConnectedRef = useRef(backendConnected)
  backendConnectedRef.current = backendConnected
  const selectionHandlerRef = useRef(onSelectionChange)
  selectionHandlerRef.current = onSelectionChange
  const diagnosticsHandlerRef = useRef(onDiagnostics)
  diagnosticsHandlerRef.current = onDiagnostics
  const openDefinitionRef = useRef(onOpenDefinition)
  openDefinitionRef.current = onOpenDefinition
  const findReferencesRef = useRef(onFindReferences)
  findReferencesRef.current = onFindReferences
  const applyLspEditsRef = useRef(onApplyLspEdits)
  applyLspEditsRef.current = onApplyLspEdits
  const statusMessageRef = useRef(onStatusMessage)
  statusMessageRef.current = onStatusMessage
  const workspacePathRef = useRef(workspacePath)
  workspacePathRef.current = workspacePath
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
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const decorationIdsRef = useRef<string[]>([])
  const [inlineTarget, setInlineTarget] = useState<InlineEditTarget | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('edit')
  const [peek, setPeek] = useState<{
    title: string
    hits: Array<{ path: string; line: number; column: number }>
  } | null>(null)
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

  const runPeekDefinition = useCallback(async () => {
    const editor = editorRef.current
    const meta = fileMetaRef.current
    if (!editor || !meta || typeof window.saforall.lspDefinition !== 'function') return
    const pos = editor.getPosition()
    if (!pos) return
    try {
      const hits = await window.saforall.lspDefinition({
        path: meta.path,
        line: pos.lineNumber - 1,
        character: pos.column - 1
      })
      if (hits.length === 0) {
        statusMessageRef.current?.('定義が見つかりません')
        setPeek(null)
        return
      }
      if (hits.length === 1 && hits[0].path === meta.path) {
        const hit = hits[0]
        editor.revealLineInCenter(hit.line)
        editor.setPosition({ lineNumber: hit.line, column: hit.column || 1 })
      }
      setPeek({
        title: 'Peek Definition',
        hits: hits.map((row) => ({
          path: row.path,
          line: row.line,
          column: row.column || 1
        }))
      })
    } catch (error) {
      statusMessageRef.current?.(`Peek Definition 失敗: ${String(error)}`)
    }
  }, [])

  const runPeekReferences = useCallback(async () => {
    const editor = editorRef.current
    const meta = fileMetaRef.current
    if (!editor || !meta || typeof window.saforall.lspReferences !== 'function') return
    const pos = editor.getPosition()
    if (!pos) return
    const model = editor.getModel()
    const word = model?.getWordAtPosition(pos)?.word
    try {
      const hits = await window.saforall.lspReferences({
        path: meta.path,
        line: pos.lineNumber - 1,
        character: pos.column - 1
      })
      if (hits.length === 0) {
        statusMessageRef.current?.('参照が見つかりません')
        setPeek(null)
        return
      }
      setPeek({
        title: `Peek References${word ? ` · ${word}` : ''}`,
        hits: hits.map((row) => ({
          path: row.path,
          line: row.line,
          column: row.column || 1
        }))
      })
    } catch (error) {
      statusMessageRef.current?.(`Peek References 失敗: ${String(error)}`)
    }
  }, [])

  useEffect(() => {
    if (peekDefinitionTrigger > 0) void runPeekDefinition()
  }, [peekDefinitionTrigger, runPeekDefinition])

  useEffect(() => {
    if (peekReferencesTrigger > 0) void runPeekReferences()
  }, [peekReferencesTrigger, runPeekReferences])

  useEffect(() => {
    return () => {
      if (!registerProviders) return
      disposeTabCompletions()
      disposeLspProviders()
    }
  }, [registerProviders])

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

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !blameOn || !activePath || !workspacePath) {
      if (editor) {
        blameDecorationsRef.current = editor.deltaDecorations(blameDecorationsRef.current, [])
      }
      blameMapRef.current = new Map()
      return
    }
    const root = workspacePath.replace(/[/\\]+$/, '')
    const unifiedRoot = root.replace(/\\/g, '/').toLowerCase()
    const unifiedPath = activePath.replace(/\\/g, '/')
    let rel = unifiedPath
    const lower = unifiedPath.toLowerCase()
    if (lower.startsWith(unifiedRoot + '/')) {
      rel = unifiedPath.slice(root.length).replace(/^[/\\]+/, '')
    } else if (lower.startsWith(unifiedRoot)) {
      rel = unifiedPath.slice(root.length).replace(/^[/\\]+/, '')
    }
    let cancelled = false
    void window.saforall
      .gitBlame({ cwd: workspacePath, path: rel })
      .then((result) => {
        if (cancelled || !result.ok) {
          statusMessageRef.current?.(result.error ?? 'Blame を取得できません')
          return
        }
        const map = new Map<number, { author: string; commit: string; summary: string }>()
        const decorations: unknown[] = []
        for (const row of result.lines) {
          map.set(row.line, {
            author: row.author,
            commit: row.commit,
            summary: row.summary
          })
          decorations.push({
            range: new monaco.Range(row.line, 1, row.line, 1),
            options: {
              isWholeLine: false,
              linesDecorationsClassName: 'saforall-blame-gutter',
              hoverMessage: {
                value: `${row.author} · ${row.commit}\n${row.summary}`
              }
            }
          })
        }
        blameMapRef.current = map
        blameDecorationsRef.current = editor.deltaDecorations(
          blameDecorationsRef.current,
          decorations as never
        )
      })
      .catch((error) => statusMessageRef.current?.(`Blame 失敗: ${String(error)}`))
    return () => {
      cancelled = true
    }
  }, [blameOn, activePath, workspacePath, file?.content])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (registerProviders) {
      registerTabCompletions(monaco, () => fileMetaRef.current, {
        isBackendConnected: () => backendConnectedRef.current,
        getRelatedFiles: () =>
          tabsRef.current.map((tab) => ({
            path: tab.path,
            content: tab.content
          }))
      })
      registerLspProviders(
        monaco,
        () => fileMetaRef.current,
        (path, line) => {
          openDefinitionRef.current?.(path, line)
        },
        (edits) => applyLspEditsRef.current?.(edits)
      )
    }

    editor.addAction({
      id: 'saforall.inlineEdit',
      label: 'Inline Edit (Ctrl+K)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        openInlineEditRef.current()
      }
    })

    editor.addAction({
      id: 'saforall.peekDefinition',
      label: 'Peek Definition',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F12],
      run: () => {
        void runPeekDefinition()
      }
    })

    editor.addAction({
      id: 'saforall.peekReferences',
      label: 'Peek References',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F12],
      run: () => {
        void runPeekReferences()
      }
    })

    editor.addAction({
      id: 'saforall.findReferences',
      label: 'Find All References',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
      run: async (ed) => {
        const meta = fileMetaRef.current
        if (!meta || typeof window.saforall.lspReferences !== 'function') return
        const pos = ed.getPosition()
        if (!pos) return
        const model = ed.getModel()
        const word = model?.getWordAtPosition(pos)
        const symbolLabel = word?.word
        try {
          const hits = await window.saforall.lspReferences({
            path: meta.path,
            line: pos.lineNumber - 1,
            character: pos.column - 1
          })
          findReferencesRef.current?.(hits, symbolLabel)
        } catch {
          findReferencesRef.current?.([], symbolLabel)
        }
      }
    })

    editor.addAction({
      id: 'saforall.formatDocument',
      label: 'Format Document',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: async () => {
        const meta = fileMetaRef.current
        if (!meta || typeof window.saforall.lspFormat !== 'function') return
        try {
          const edits = await window.saforall.lspFormat({ path: meta.path })
          if (edits.length === 0) {
            statusMessageRef.current?.('整形できる変更はありません（LSP）')
            return
          }
          await applyLspEditsRef.current?.(edits)
          statusMessageRef.current?.(`Format: ${edits.length} edits`)
        } catch (error) {
          statusMessageRef.current?.(`Format 失敗: ${String(error)}`)
        }
      }
    })

    editor.onDidChangeCursorPosition((event) => {
      setCursorLine(event.position.lineNumber)
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
          (marker: {
            severity: number
            resource: { path?: string }
            startLineNumber: number
            startColumn: number
            message: string
            source?: string
          }) => {
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
              id: `monaco:${path}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
              severity,
              source: marker.source || 'monaco',
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
        <div className="editor-extra-actions">
          <button
            type="button"
            className={blameOn ? 'active' : ''}
            title="Git Blame"
            disabled={!workspacePath || !activePath}
            onClick={() => setBlameOn((value) => !value)}
          >
            Blame
          </button>
          <button
            type="button"
            title="Format Document (Shift+Alt+F)"
            disabled={!activePath}
            onClick={() => {
              const ed = editorRef.current
              if (!ed) return
              void ed.getAction('saforall.formatDocument')?.run()
            }}
          >
            Format
          </button>
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
      <EditorBreadcrumbs
        path={activePath}
        symbols={symbols}
        cursorLine={cursorLine}
        onJump={(line, column) => {
          const editor = editorRef.current
          if (!editor) return
          editor.revealLineInCenter(line)
          editor.setPosition({ lineNumber: line, column: column ?? 1 })
          editor.focus()
        }}
      />
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
      {peek && (
        <div className="editor-peek" role="dialog" aria-label={peek.title}>
          <div className="editor-peek-header">
            <strong>{peek.title}</strong>
            <span>{peek.hits.length} 件</span>
            <button type="button" onClick={() => setPeek(null)}>
              ×
            </button>
          </div>
          <div className="editor-peek-list">
            {peek.hits.map((hit, i) => (
              <button
                key={`${hit.path}:${hit.line}:${i}`}
                type="button"
                className="editor-peek-item"
                onClick={() => {
                  if (hit.path === activePath) {
                    const editor = editorRef.current
                    if (editor) {
                      editor.revealLineInCenter(hit.line)
                      editor.setPosition({ lineNumber: hit.line, column: hit.column || 1 })
                      editor.focus()
                    }
                  } else {
                    openDefinitionRef.current?.(hit.path, hit.line)
                  }
                  setPeek(null)
                }}
              >
                <span className="editor-peek-path">
                  {hit.path.split(/[/\\]/).pop() ?? hit.path}
                </span>
                <span className="editor-peek-meta">
                  L{hit.line}:{hit.column} · {hit.path}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className={
          previewMode === 'split' && supportsPreview(file.language, file.path)
            ? 'editor-preview-split'
            : 'editor-host-wrap'
        }
        onFocusCapture={() => onEditorFocus?.()}
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
      {showOutline && (
        <OutlinePanel
          symbols={symbols}
          activePath={activePath}
          onJump={(line, column) => {
            const editor = editorRef.current
            if (!editor) return
            editor.revealLineInCenter(line)
            editor.setPosition({ lineNumber: line, column: column ?? 1 })
            editor.focus()
          }}
        />
      )}
    </div>
  )
}
