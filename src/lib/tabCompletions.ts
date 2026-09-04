import type { Monaco } from '@monaco-editor/react'

type InlineRequest = {
  path: string
  language: string
  prefix: string
  suffix: string
}

let providerDisposable: { dispose: () => void } | null = null
let seq = 0

export function disposeTabCompletions(): void {
  providerDisposable?.dispose()
  providerDisposable = null
}

export function registerTabCompletions(
  monaco: Monaco,
  getMeta: () => { path: string; language: string } | null
): void {
  disposeTabCompletions()

  providerDisposable = monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' },
    {
      freeInlineCompletions: () => undefined,
      provideInlineCompletions: async (
        model: {
          getOffsetAt: (pos: { lineNumber: number; column: number }) => number
          getValue: () => string
          getLanguageId: () => string
        },
        position: { lineNumber: number; column: number },
        _context: unknown,
        token: { isCancellationRequested: boolean }
      ) => {
        const meta = getMeta()
        if (!meta) return { items: [] }

        const requestId = ++seq
        await delay(380)
        if (token.isCancellationRequested || requestId !== seq) {
          return { items: [] }
        }

        const offset = model.getOffsetAt(position)
        const full = model.getValue()
        const prefix = full.slice(Math.max(0, offset - 3500), offset)
        const suffix = full.slice(offset, Math.min(full.length, offset + 1200))

        if (prefix.trim().length < 8) {
          return { items: [] }
        }

        const payload: InlineRequest = {
          path: meta.path,
          language: meta.language || model.getLanguageId(),
          prefix,
          suffix
        }

        try {
          if (typeof window.saforall?.request !== 'function') {
            return { items: [] }
          }
          const result = await window.saforall.request<{ completion: string }>(
            'POST',
            '/ai/inline',
            payload,
            { timeoutMs: 12_000 }
          )
          if (token.isCancellationRequested || requestId !== seq) {
            return { items: [] }
          }
          if (!result.ok || !result.data?.completion) {
            return { items: [] }
          }

          const insertText = result.data.completion.replace(/\r\n/g, '\n')
          if (!insertText.trim()) return { items: [] }

          return {
            items: [
              {
                insertText,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                )
              }
            ]
          }
        } catch {
          return { items: [] }
        }
      }
    }
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
