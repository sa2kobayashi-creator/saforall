/**
 * Pure helpers for Cursor-style chat file attachments (chips above the input).
 */

export function attachmentLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/** Add a path once; keeps insertion order. */
export function addAttachedPath(current: string[], path: string): string[] {
  const next = path.trim()
  if (!next) return current
  if (current.some((row) => row.toLowerCase() === next.toLowerCase())) return current
  return [...current, next]
}

export function removeAttachedPath(current: string[], path: string): string[] {
  const key = path.toLowerCase()
  return current.filter((row) => row.toLowerCase() !== key)
}

/**
 * Collect file paths from a drop / paste DataTransfer.
 * Electron exposes `File.path` for OS drops; text/uri-list is a fallback.
 */
export function pathsFromDataTransfer(
  data: DataTransfer | null | undefined,
  options?: { workspacePath?: string | null }
): string[] {
  if (!data) return []
  const found: string[] = []

  const files = data.files
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i) as (File & { path?: string }) | null
      const diskPath = file?.path?.trim()
      if (diskPath) found.push(diskPath)
    }
  }

  const uriList = data.getData?.('text/uri-list') ?? ''
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      if (trimmed.startsWith('file:')) {
        const url = new URL(trimmed)
        let pathname = decodeURIComponent(url.pathname)
        if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1)
        found.push(pathname.replace(/\//g, '\\'))
      }
    } catch {
      // ignore bad URI
    }
  }

  // Only treat plain text as an absolute filesystem path (Windows drive / UNC).
  // Broad "/ or \" matching blocked normal clipboard paste (URLs, code like a/b).
  // Unix absolute paths still arrive via File.path / text/uri-list / file://.
  const plain = (data.getData?.('text/plain') ?? '').trim()
  if (
    plain &&
    !plain.includes('\n') &&
    !/\s/.test(plain) &&
    (/^[A-Za-z]:[\\/]/.test(plain) || plain.startsWith('\\\\'))
  ) {
    found.push(plain)
  }

  const workspace = options?.workspacePath?.replace(/[/\\]+$/, '') ?? ''
  const unique: string[] = []
  for (const raw of found) {
    let path = raw.trim()
    if (!path) continue
    if (workspace && !/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith('/')) {
      const sep = workspace.includes('\\') ? '\\' : '/'
      path = `${workspace}${sep}${path.replace(/^[\\/]+/, '')}`
    }
    if (!unique.some((row) => row.toLowerCase() === path.toLowerCase())) {
      unique.push(path)
    }
  }
  return unique
}
