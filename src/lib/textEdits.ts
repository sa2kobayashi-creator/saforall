export type TextSpanEdit = {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

/** Apply LSP-style 1-based edits from bottom-to-top so offsets stay valid. */
export function applyTextEdits(source: string, edits: TextSpanEdit[]): string {
  const normalized = source.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  const ordered = [...edits].sort((a, b) => {
    if (a.startLine !== b.startLine) return b.startLine - a.startLine
    return b.startColumn - a.startColumn
  })

  for (const edit of ordered) {
    const startLine = Math.max(1, edit.startLine) - 1
    const endLine = Math.max(1, edit.endLine) - 1
    const startCol = Math.max(1, edit.startColumn) - 1
    const endCol = Math.max(1, edit.endColumn) - 1

    if (startLine >= lines.length) continue
    const before = lines[startLine].slice(0, startCol)
    const afterLine = lines[Math.min(endLine, lines.length - 1)] ?? ''
    const after = afterLine.slice(endCol)
    const inserted = edit.newText.replace(/\r\n/g, '\n').split('\n')
    const merged = [...inserted]
    merged[0] = before + (merged[0] ?? '')
    merged[merged.length - 1] = (merged[merged.length - 1] ?? '') + after
    lines.splice(startLine, endLine - startLine + 1, ...merged)
  }

  return lines.join('\n')
}
