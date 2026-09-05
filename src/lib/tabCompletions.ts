import type { Monaco } from '@monaco-editor/react'

type InlineRequest = {
  path: string
  language: string
  prefix: string
  suffix: string
  nearby?: string
}

let providerDisposable: { dispose: () => void } | null = null
let seq = 0
let lastKey = ''
let lastCompletion = ''
let lastAt = 0

export function disposeTabCompletions(): void {
  providerDisposable?.dispose()
  providerDisposable = null
}

function cacheKey(path: string, prefix: string, suffix: string, offset: number): string {
  return `${path}::${offset}::${prefix.slice(-120)}::${suffix.slice(0, 40)}`
}

function extractNearbyContext(full: string, offset: number): string {
  const start = Math.max(0, offset - 900)
  const end = Math.min(full.length, offset + 400)
  const window = full.slice(start, end)
  const lines = window.split(/\r?\n/)
  // Prefer recent function/class headers for better completions
  const headers = lines
    .filter((line) =>
      /^\s*(export\s+)?(async\s+)?(function|class|const|let|type|interface|def)\b/.test(line)
    )
    .slice(-6)
  if (headers.length === 0) return ''
  return headers.join('\n').slice(0, 600)
}

export function registerTabCompletions(
  monaco: Monaco,
  getMeta: () => { path: string; language: string } | null,
  options?: {
    isBackendConnected?: () => boolean
  }
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
          getLineContent: (line: number) => string
        },
        position: { lineNumber: number; column: number },
        context: { triggerKind?: number },
        token: { isCancellationRequested: boolean }
      ) => {
        const meta = getMeta()
        if (!meta) return { items: [] }
        if (options?.isBackendConnected && !options.isBackendConnected()) {
          return { items: [] }
        }

        const requestId = ++seq
        // Adaptive debounce: faster when continuing to type in the same line.
        const waitMs = context?.triggerKind === 1 ? 180 : 280
        await delay(waitMs)
        if (token.isCancellationRequested || requestId !== seq) {
          return { items: [] }
        }

        const offset = model.getOffsetAt(position)
        const full = model.getValue()
        const line = model.getLineContent(position.lineNumber)
        const before = line.slice(0, Math.max(0, position.column - 1))

        // Skip empty / comment-only / just-closed string contexts
        if (before.trim().length < 2) return { items: [] }
        if (/^\s*(\/\/|#)/.test(before) && !/[`'"({[]/.test(before.slice(-1))) {
          return { items: [] }
        }

        const prefix = full.slice(Math.max(0, offset - 4500), offset)
        const suffix = full.slice(offset, Math.min(full.length, offset + 1600))
        if (prefix.trim().length < 6) return { items: [] }

        const key = cacheKey(meta.path, prefix, suffix, offset)
        if (key === lastKey && lastCompletion && Date.now() - lastAt < 8_000) {
          return {
            items: [
              {
                insertText: lastCompletion,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                )
              }
            ]
          }
        }

        const nearby = extractNearbyContext(full, offset)
        const payload: InlineRequest = {
          path: meta.path,
          language: meta.language || model.getLanguageId(),
          prefix,
          suffix,
          nearby: nearby || undefined
        }

        try {
          if (typeof window.saforall?.request !== 'function') {
            return { items: [] }
          }
          const result = await window.saforall.request<{ completion: string }>(
            'POST',
            '/ai/inline',
            payload,
            { timeoutMs: 10_000 }
          )
          if (token.isCancellationRequested || requestId !== seq) {
            return { items: [] }
          }
          if (!result.ok || !result.data?.completion) {
            return { items: [] }
          }

          let insertText = result.data.completion.replace(/\r\n/g, '\n')
          // Avoid repeating the token the user already typed
          const typed = before.match(/[A-Za-z0-9_$]+$/)?.[0] ?? ''
          if (typed && insertText.startsWith(typed)) {
            insertText = insertText.slice(typed.length)
          }
          // Prefer single-line continuations when the model dumps a huge block
          if (insertText.split('\n').length > 16) {
            insertText = insertText.split('\n').slice(0, 12).join('\n')
          }
          if (!insertText.trim()) return { items: [] }

          lastKey = key
          lastCompletion = insertText
          lastAt = Date.now()

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
