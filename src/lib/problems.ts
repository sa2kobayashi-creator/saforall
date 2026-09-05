export type ProblemSeverity = 'error' | 'warning' | 'info'

export type ProblemLike = {
  id: string
  severity: ProblemSeverity
  source: string
  message: string
  path?: string
  line?: number
  column?: number
}

const SEVERITY_RANK: Record<ProblemSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2
}

function dedupeKey(item: ProblemLike): string {
  return [
    (item.path ?? '').replace(/\//g, '\\').toLowerCase(),
    String(item.line ?? 0),
    String(item.column ?? 0),
    item.message.trim()
  ].join('::')
}

/** Merge Monaco + LSP (+ other) problems: dedupe, prefer higher severity, sort. */
export function mergeProblems(items: ProblemLike[]): ProblemLike[] {
  const seen = new Map<string, ProblemLike>()
  for (const item of items) {
    const key = dedupeKey(item)
    const existing = seen.get(key)
    if (!existing || SEVERITY_RANK[item.severity] < SEVERITY_RANK[existing.severity]) {
      seen.set(key, { ...item, id: key })
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byPath = (a.path ?? '').localeCompare(b.path ?? '', undefined, { sensitivity: 'base' })
    if (byPath !== 0) return byPath
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

export type ProblemGroup = {
  path: string
  items: ProblemLike[]
}

export function groupProblemsByPath(items: ProblemLike[]): ProblemGroup[] {
  const map = new Map<string, ProblemLike[]>()
  const general: ProblemLike[] = []
  for (const item of items) {
    if (!item.path) {
      general.push(item)
      continue
    }
    const key = item.path
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  const groups: ProblemGroup[] = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([path, rows]) => ({ path, items: rows }))
  if (general.length > 0) {
    groups.unshift({ path: '(workspace)', items: general })
  }
  return groups
}
