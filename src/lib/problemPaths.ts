/** Resolve a Problems panel path to an absolute filesystem path. */
export function resolveProblemOpenPath(
  workspacePath: string | null | undefined,
  problemPath: string
): string {
  const raw = problemPath.trim()
  if (!raw) return raw
  const unified = raw.replace(/\\/g, '/')
  // Absolute Windows or POSIX
  if (/^[a-zA-Z]:\//.test(unified) || unified.startsWith('/')) {
    return problemPath
  }
  // file:// URI
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw)
      return decodeURIComponent(url.pathname.replace(/^\/([a-zA-Z]:)/, '$1'))
    } catch {
      // fall through
    }
  }
  const root = (workspacePath || '').replace(/[/\\]+$/, '')
  if (!root) return problemPath
  const sep = root.includes('\\') ? '\\' : '/'
  const rel = unified.replace(/^\.\//, '')
  return `${root}${sep}${rel.split('/').join(sep)}`
}
