import type { Monaco } from '@monaco-editor/react'

type Disposables = Array<{ dispose: () => void }>

type Position = { lineNumber: number; column: number }
type ModelLike = {
  getWordUntilPosition: (pos: Position) => {
    startColumn: number
    endColumn: number
  }
}
type CancellationToken = { isCancellationRequested: boolean }
type UriLike = { fsPath?: string; path: string }
type SelectionLike = { startLineNumber?: number; startColumn?: number } | null | undefined

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
  onOpenDefinition: (path: string, line: number, column?: number) => void
): void {
  disposeLspProviders()

  const languages = ['typescript', 'javascript', 'python']

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
  }

  // Route Monaco go-to-definition into our tab opener (F12 / Ctrl+click)
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
