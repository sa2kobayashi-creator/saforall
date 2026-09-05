import type { Monaco } from '@monaco-editor/react'

type Disposables = Array<{ dispose: () => void }>

type Position = { lineNumber: number; column: number }
type ModelLike = {
  getWordUntilPosition: (pos: Position) => {
    word?: string
    startColumn: number
    endColumn: number
  }
  getWordAtPosition?: (pos: Position) => {
    word: string
    startColumn: number
    endColumn: number
  } | null
}
type CancellationToken = { isCancellationRequested: boolean }
type UriLike = { fsPath?: string; path: string }
type SelectionLike = { startLineNumber?: number; startColumn?: number } | null | undefined

export type LspTextEdit = {
  path: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

let disposables: Disposables = []

export function disposeLspProviders(): void {
  for (const d of disposables) d.dispose()
  disposables = []
}

/** Monaco CompletionItemKind roughly matches LSP CompletionItemKind. */
function mapKind(monaco: Monaco, kind?: number): number {
  const K = monaco.languages.CompletionItemKind
  switch (kind) {
    case 1:
      return K.Text
    case 2:
      return K.Method
    case 3:
      return K.Function
    case 4:
      return K.Constructor
    case 5:
      return K.Field
    case 6:
      return K.Variable
    case 7:
      return K.Class
    case 8:
      return K.Interface
    case 9:
      return K.Module
    case 10:
      return K.Property
    case 11:
      return K.Unit
    case 12:
      return K.Value
    case 13:
      return K.Enum
    case 14:
      return K.Keyword
    case 15:
      return K.Snippet
    case 16:
      return K.Color
    case 17:
      return K.File
    case 18:
      return K.Reference
    case 19:
      return K.Folder
    case 20:
      return K.EnumMember
    case 21:
      return K.Constant
    case 22:
      return K.Struct
    case 23:
      return K.Event
    case 24:
      return K.Operator
    case 25:
      return K.TypeParameter
    default:
      return K.Text
  }
}

export function registerLspProviders(
  monaco: Monaco,
  getMeta: () => { path: string; language: string } | null,
  onOpenDefinition: (path: string, line: number, column?: number) => void,
  onApplyEdits?: (edits: LspTextEdit[]) => Promise<void> | void
): void {
  disposeLspProviders()

  const languages = [
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'python'
  ]

  for (const language of languages) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: ['.', '"', "'", '/', '@'],
        provideCompletionItems: async (
          model: ModelLike,
          position: Position,
          _context: unknown,
          token: CancellationToken
        ) => {
          const meta = getMeta()
          if (!meta || typeof window.saforall.lspCompletion !== 'function') {
            return { suggestions: [] }
          }
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          }
          try {
            const items = await window.saforall.lspCompletion({
              path: meta.path,
              line: position.lineNumber - 1,
              character: position.column - 1
            })
            if (token.isCancellationRequested) return { suggestions: [] }
            return {
              suggestions: items.map((item) => ({
                label: item.label,
                kind: mapKind(monaco, item.kind),
                detail: item.detail,
                documentation: item.documentation,
                insertText: item.insertText || item.label,
                range
              }))
            }
          } catch {
            return { suggestions: [] }
          }
        }
      })
    )

    disposables.push(
      monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: async (
          _model: unknown,
          position: Position,
          token: CancellationToken
        ) => {
          const meta = getMeta()
          if (!meta || typeof window.saforall.lspDefinition !== 'function') return null
          try {
            const locs = await window.saforall.lspDefinition({
              path: meta.path,
              line: position.lineNumber - 1,
              character: position.column - 1
            })
            if (token.isCancellationRequested || locs.length === 0) return null
            return locs.map((loc) => ({
              uri: monaco.Uri.file(loc.path),
              range: new monaco.Range(loc.line, loc.column, loc.line, loc.column)
            }))
          } catch {
            return null
          }
        }
      })
    )

    disposables.push(
      monaco.languages.registerHoverProvider(language, {
        provideHover: async (_model: unknown, position: Position, token: CancellationToken) => {
          const meta = getMeta()
          if (!meta || typeof window.saforall.lspHover !== 'function') return null
          try {
            const hover = await window.saforall.lspHover({
              path: meta.path,
              line: position.lineNumber - 1,
              character: position.column - 1
            })
            if (token.isCancellationRequested || !hover?.contents) return null
            return {
              contents: [{ value: hover.contents }]
            }
          } catch {
            return null
          }
        }
      })
    )

    disposables.push(
      monaco.languages.registerReferenceProvider(language, {
        provideReferences: async (
          _model: unknown,
          position: Position,
          _context: unknown,
          token: CancellationToken
        ) => {
          const meta = getMeta()
          if (!meta || typeof window.saforall.lspReferences !== 'function') return []
          try {
            const locs = await window.saforall.lspReferences({
              path: meta.path,
              line: position.lineNumber - 1,
              character: position.column - 1
            })
            if (token.isCancellationRequested) return []
            return locs.map((loc) => ({
              uri: monaco.Uri.file(loc.path),
              range: new monaco.Range(
                loc.line,
                loc.column,
                ('endLine' in loc && typeof loc.endLine === 'number' ? loc.endLine : loc.line),
                ('endColumn' in loc && typeof loc.endColumn === 'number'
                  ? loc.endColumn
                  : loc.column)
              )
            }))
          } catch {
            return []
          }
        }
      })
    )

    disposables.push(
      monaco.languages.registerRenameProvider(language, {
        provideRenameEdits: async (
          model: ModelLike,
          position: Position,
          newName: string,
          token: CancellationToken
        ) => {
          const meta = getMeta()
          if (!meta || typeof window.saforall.lspRename !== 'function') {
            return { edits: [], rejectReason: 'LSP rename unavailable' }
          }
          try {
            const edits = await window.saforall.lspRename({
              path: meta.path,
              line: position.lineNumber - 1,
              character: position.column - 1,
              newName
            })
            if (token.isCancellationRequested) {
              return { edits: [], rejectReason: 'cancelled' }
            }
            if (edits.length === 0) {
              return { edits: [], rejectReason: 'No rename edits from language server' }
            }
            if (onApplyEdits) {
              await onApplyEdits(edits)
              // Already applied via app; return empty so Monaco doesn't double-apply.
              return { edits: [] }
            }
            return {
              edits: edits.map((edit) => ({
                resource: monaco.Uri.file(edit.path),
                textEdit: {
                  range: new monaco.Range(
                    edit.startLine,
                    edit.startColumn,
                    edit.endLine,
                    edit.endColumn
                  ),
                  text: edit.newText
                }
              }))
            }
          } catch (error) {
            return {
              edits: [],
              rejectReason: error instanceof Error ? error.message : String(error)
            }
          }
        },
        resolveRenameLocation: (model: ModelLike, position: Position) => {
          const at = model.getWordAtPosition?.(position)
          const until = model.getWordUntilPosition(position)
          const word = at?.word || until.word
          if (!word) {
            return {
              rejectReason: 'Rename is only available on a symbol name'
            }
          }
          const startColumn = at && 'startColumn' in at && typeof (at as { startColumn?: number }).startColumn === 'number'
            ? (at as { startColumn: number }).startColumn
            : until.startColumn
          const endColumn = at && 'endColumn' in at && typeof (at as { endColumn?: number }).endColumn === 'number'
            ? (at as { endColumn: number }).endColumn
            : until.endColumn
          return {
            range: {
              startLineNumber: position.lineNumber,
              startColumn,
              endLineNumber: position.lineNumber,
              endColumn
            },
            text: word
          }
        }
      })
    )
  }

  // Route Monaco go-to-definition / references into our tab opener
  const openerApi = monaco.editor as typeof monaco.editor & {
    registerEditorOpener?: (opener: {
      openCodeEditor: (
        source: unknown,
        resource: UriLike,
        selection: SelectionLike
      ) => boolean | Promise<boolean>
    }) => { dispose: () => void }
  }
  if (typeof openerApi.registerEditorOpener === 'function') {
    disposables.push(
      openerApi.registerEditorOpener({
        openCodeEditor(
          _source: unknown,
          resource: UriLike,
          selection: SelectionLike
        ) {
          const path = resource.fsPath || resource.path
          if (!path) return false
          const line = selection?.startLineNumber ?? 1
          const column = selection?.startColumn ?? 1
          onOpenDefinition(path.replace(/^\//, ''), line, column)
          return true
        }
      })
    )
  }
}
