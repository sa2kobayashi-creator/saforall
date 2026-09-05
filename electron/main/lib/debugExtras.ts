/** Exception pause policy shared by CDP (Node) and DAP (Python). */
export type ExceptionBreakMode = 'none' | 'uncaught' | 'all'

export function normalizeExceptionBreakMode(value: unknown): ExceptionBreakMode {
  if (value === 'all' || value === 'uncaught' || value === 'none') return value
  return 'uncaught'
}

/** Chrome DevTools Protocol Debugger.setPauseOnExceptions state. */
export function toCdpPauseOnExceptions(mode: ExceptionBreakMode): 'none' | 'uncaught' | 'all' {
  return mode
}

/**
 * debugpy / DAP setExceptionBreakpoints filters.
 * 'raised' = all, 'uncaught' only when uncaught, empty = none.
 */
export function toDapExceptionFilters(mode: ExceptionBreakMode): string[] {
  if (mode === 'none') return []
  if (mode === 'all') return ['raised', 'uncaught']
  return ['uncaught']
}

/**
 * Thin source-map support: also try compiled sibling paths when breaking on .ts/.tsx.
 * Does not parse source maps; helps when CDP resolves compiled URLs.
 */
export function expandSourceMapBreakpointPaths(filePath: string): string[] {
  const path = filePath.trim()
  if (!path) return []
  const out = [path]
  if (/\.tsx$/i.test(path)) {
    out.push(path.replace(/\.tsx$/i, '.js'))
    out.push(path.replace(/\.tsx$/i, '.jsx'))
  } else if (/\.ts$/i.test(path)) {
    out.push(path.replace(/\.ts$/i, '.js'))
    out.push(path.replace(/\.ts$/i, '.mjs'))
  }
  return out
}
