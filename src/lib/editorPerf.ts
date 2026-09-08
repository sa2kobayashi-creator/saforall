/**
 * Editor responsiveness helpers.
 *
 * Monaco slows down noticeably on big files: word wrap, minimap, folding and
 * inline suggestions all walk the whole model. These helpers pick a lighter
 * option set for large buffers and provide the debounce used by the hot paths
 * that run on every keystroke.
 */

export type EditorPerfTier = 'normal' | 'large' | 'huge'

export const LARGE_FILE_CHARS = 256_000
export const HUGE_FILE_CHARS = 1_500_000
export const LARGE_FILE_LINES = 5_000
export const HUGE_FILE_LINES = 30_000

/** Marker debounce: fast enough to feel live, slow enough to skip typing bursts. */
export const MARKER_DEBOUNCE_MS = 150
/** Outline refresh after edits. Must trail the 700ms LSP didChange debounce. */
export const OUTLINE_DEBOUNCE_MS = 900
/** Cap for a single LSP completion round trip before falling back to empty. */
export const COMPLETION_TIMEOUT_MS = 2_000

export type EditorPerfOptions = {
  fontSize: number
  fontFamily: string
  automaticLayout: boolean
  scrollBeyondLastLine: boolean
  tabSize: number
  glyphMargin: boolean
  largeFileOptimizations: boolean
  minimap: { enabled: boolean }
  wordWrap: 'on' | 'off'
  inlineSuggest: { enabled: boolean }
  folding: boolean
  bracketPairColorization: { enabled: boolean }
  occurrencesHighlight: 'off' | 'singleFile'
  renderWhitespace: 'none' | 'selection'
  quickSuggestions: boolean
  wordBasedSuggestions: 'off' | 'currentDocument'
  stickyScroll: { enabled: boolean }
}

/**
 * Counts newlines without allocating an array. `limit` lets callers stop early
 * once the answer can no longer change the tier.
 */
export function countLines(content: string, limit = Number.POSITIVE_INFINITY): number {
  let lines = 1
  let index = content.indexOf('\n')
  while (index !== -1) {
    lines += 1
    if (lines >= limit) return lines
    index = content.indexOf('\n', index + 1)
  }
  return lines
}

export function editorPerfTier(content: string | null | undefined): EditorPerfTier {
  const text = content ?? ''
  if (text.length >= HUGE_FILE_CHARS) return 'huge'
  const lines = countLines(text, HUGE_FILE_LINES)
  if (lines >= HUGE_FILE_LINES) return 'huge'
  if (text.length >= LARGE_FILE_CHARS || lines >= LARGE_FILE_LINES) return 'large'
  return 'normal'
}

export function editorOptionsForTier(tier: EditorPerfTier): EditorPerfOptions {
  const heavy = tier === 'normal'
  const huge = tier === 'huge'
  return {
    fontSize: 14,
    fontFamily: 'Cascadia Code, Consolas, monospace',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    tabSize: 2,
    glyphMargin: true,
    largeFileOptimizations: true,
    minimap: { enabled: heavy },
    wordWrap: heavy ? 'on' : 'off',
    inlineSuggest: { enabled: !huge },
    folding: heavy,
    bracketPairColorization: { enabled: heavy },
    occurrencesHighlight: heavy ? 'singleFile' : 'off',
    renderWhitespace: heavy ? 'selection' : 'none',
    quickSuggestions: !huge,
    wordBasedSuggestions: huge ? 'off' : 'currentDocument',
    stickyScroll: { enabled: heavy }
  }
}

export function editorOptionsForContent(content: string | null | undefined): EditorPerfOptions {
  return editorOptionsForTier(editorPerfTier(content))
}

export function perfNoticeForTier(tier: EditorPerfTier): string | null {
  if (tier === 'huge') return '軽量モード（巨大ファイル）: ミニマップ・折返し・補完を停止中'
  if (tier === 'large') return '軽量モード（大きいファイル）: ミニマップ・折返しを停止中'
  return null
}

const CONFLICT_HINT = '<<<<<<<'

/**
 * Cheap pre-check so the editor does not split the whole buffer on every
 * keystroke just to learn there are no conflict markers.
 */
export function hasConflictMarkers(content: string | null | undefined): boolean {
  const text = content ?? ''
  if (!text.includes(CONFLICT_HINT)) return false
  return /^<{7}/m.test(text)
}

export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  cancel: () => void
  flush: () => void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const run = (): void => {
    timer = null
    const args = pending
    pending = null
    if (args) fn(...args)
  }

  const wrapped = (...args: A): void => {
    pending = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(run, ms)
  }

  wrapped.cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = null
  }

  wrapped.flush = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    run()
  }

  return wrapped
}

/** Resolves `fallback` when `promise` takes longer than `ms`, without leaking the timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    promise
      .then((value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback)
      })
  })
}
