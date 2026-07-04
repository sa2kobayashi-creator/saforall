export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string; pathHint?: string }

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

function parseFenceMeta(meta: string): { language: string; pathHint?: string } {
  const trimmed = meta.trim()
  if (!trimmed) return { language: 'text' }

  // ```typescript path/to/file.ts
  // ```typescript:path/to/file.ts
  // ```path/to/file.ts
  const spaced = trimmed.match(/^([A-Za-z0-9_+#-]+)\s+(.+)$/)
  if (spaced) {
    return { language: spaced[1], pathHint: spaced[2].trim() }
  }

  const colon = trimmed.match(/^([A-Za-z0-9_+#-]+):(.+)$/)
  if (colon && (colon[2].includes('/') || colon[2].includes('\\') || colon[2].includes('.'))) {
    return { language: colon[1], pathHint: colon[2].trim() }
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { language: 'text', pathHint: trimmed }
  }

  return { language: trimmed }
}

export function parseMessageParts(content: string): MessagePart[] {
  const parts: MessagePart[] = []
  let lastIndex = 0
  const fenceRe = new RegExp(FENCE_RE.source, 'g')
  let match: RegExpExecArray | null

  while ((match = fenceRe.exec(content)) !== null) {
    const index = match.index
    if (index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, index) })
    }

    const meta = parseFenceMeta(match[1] ?? '')
    parts.push({
      type: 'code',
      language: meta.language,
      code: (match[2] ?? '').replace(/\n$/, ''),
      pathHint: meta.pathHint
    })

    lastIndex = index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: content })
  }

  return parts
}

export function joinPath(root: string, relative: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  const normalizedRelative = relative
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+/g, sep)
  return `${root.replace(/[\\/]+$/, '')}${sep}${normalizedRelative}`
}

export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}
