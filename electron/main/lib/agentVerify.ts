/** Pure helpers for Agent verify loop (Problems-aware). */

export const MAX_EDIT_RECOVERIES = 5

export function extractProblemPath(line: string): string | null {
  const match = line.match(/(?:^|\s)([A-Za-z]:)?[^\s:]+\.[A-Za-z0-9]+(?=:\d+|])/i)
  if (match?.[0]) {
    return match[0].trim().replace(/^[\[(]/, '').replace(/\\/g, '/')
  }
  const pathOnly = line.match(/([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|php))(?::\d+)?/i)
  return pathOnly?.[1]?.replace(/\\/g, '/') ?? null
}

export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/** True when any problem line references an edited path (error severity preferred). */
export function problemsAffectEditedPaths(
  problems: string[],
  editedPaths: Iterable<string>,
  options?: { errorsOnly?: boolean }
): string[] {
  const edited = new Set(Array.from(editedPaths).map(normalizeRelPath))
  const hits: string[] = []
  for (const row of problems) {
    const lower = row.toLowerCase()
    if (options?.errorsOnly !== false) {
      if (!/\berror\b|❌|severity:\s*error/i.test(row) && !lower.includes('[error]')) {
        // still match if path clearly edited and message looks serious
        if (!/\berror\b/i.test(row)) continue
      }
    }
    const path = extractProblemPath(row)
    if (!path) {
      for (const edit of Array.from(edited)) {
        if (lower.includes(edit) || lower.includes(edit.split('/').pop() ?? '')) {
          hits.push(row)
          break
        }
      }
      continue
    }
    const norm = normalizeRelPath(path)
    const base = norm.split('/').pop() ?? norm
    for (const edit of Array.from(edited)) {
      if (edit === norm || edit.endsWith('/' + norm) || edit.endsWith(base) || norm.endsWith(edit)) {
        hits.push(row)
        break
      }
    }
  }
  return hits.slice(0, 40)
}

export function formatProblemsForAgent(problems: string[], limit = 30): string {
  if (!problems.length) return ''
  return problems.slice(0, limit).join('\n')
}
