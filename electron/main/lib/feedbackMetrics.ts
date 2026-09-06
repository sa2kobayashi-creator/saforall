/** Pure helpers for search / Agent feedback metrics (no disk I/O). */

export type FeedbackKind = 'search' | 'tool' | 'agent_signal' | 'agent_outcome'

export type FeedbackEvent = {
  id: number
  at: string
  kind: FeedbackKind
  source: string
  ok?: boolean
  query?: string
  hitCount?: number
  topPaths?: string[]
  tool?: string
  phase?: string
  path?: string
  detail?: string
  editedPaths?: string[]
  searchTopPaths?: string[]
  topHit?: boolean
  sessionKey?: string
}

export type FeedbackSummary = {
  windowDays: number
  searches: number
  searchWithHits: number
  editsQueued: number
  editsRejected: number
  emptyToolRetries: number
  verifyIncomplete: number
  verifyPass: number
  agentRuns: number
  agentTopHit: number
  agentTopHitRate: number | null
  readRequired: number
  recent: Array<{
    at: string
    kind: FeedbackKind
    source: string
    detail?: string
    query?: string
    topHit?: boolean
  }>
}

function pathsFromHitLines(lines: string[], limit = 5): string[] {
  const out: string[] = []
  for (const line of lines) {
    const path = line.split(':')[0]?.replace(/\\/g, '/').trim()
    if (!path || path === '一致なし' || path.startsWith('query')) continue
    if (!out.includes(path)) out.push(path)
    if (out.length >= limit) break
  }
  return out
}

export function extractTopPathsFromSearchResult(resultText: string, limit = 5): string[] {
  const text = resultText.trim()
  if (!text || text === '一致なし' || text.startsWith('query')) return []
  return pathsFromHitLines(text.split(/\r?\n/).filter(Boolean), limit)
}

export function pathInTopHits(path: string, topPaths: string[]): boolean {
  const norm = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  const base = norm.split('/').pop() ?? norm
  return topPaths.some((row) => {
    const p = row.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    return p === norm || p.endsWith('/' + norm) || norm.endsWith('/' + p) || p.endsWith('/' + base)
  })
}

function parseEventTime(at: string): number {
  const normalized = at.includes('T') ? at : at.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : 0
}

export function summarizeFeedbackEvents(
  events: FeedbackEvent[],
  windowDays = 7,
  nowMs = Date.now()
): FeedbackSummary {
  const cutoff = nowMs - Math.max(1, windowDays) * 24 * 60 * 60 * 1000
  const recentWindow = events.filter((row) => {
    const t = parseEventTime(row.at)
    return t === 0 || t >= cutoff
  })

  let searches = 0
  let searchWithHits = 0
  let editsQueued = 0
  let editsRejected = 0
  let emptyToolRetries = 0
  let verifyIncomplete = 0
  let verifyPass = 0
  let agentRuns = 0
  let agentTopHit = 0
  let readRequired = 0

  for (const row of recentWindow) {
    if (row.kind === 'search') {
      searches += 1
      if ((row.hitCount ?? 0) > 0) searchWithHits += 1
    }
    if (row.kind === 'tool' && row.tool === 'edit_file') {
      if (row.ok) editsQueued += 1
      else {
        editsRejected += 1
        if (row.detail === 'read_required') readRequired += 1
      }
    }
    if (row.kind === 'agent_signal') {
      if (row.detail === 'empty_tool_calls') emptyToolRetries += 1
      if (row.detail === 'verify_incomplete') verifyIncomplete += 1
      if (row.detail === 'verify_pass') verifyPass += 1
    }
    if (row.kind === 'agent_outcome') {
      agentRuns += 1
      if (row.topHit) agentTopHit += 1
      if (row.detail === 'verify_pass') verifyPass += 1
      if (row.detail === 'verify_incomplete') verifyIncomplete += 1
    }
  }

  return {
    windowDays,
    searches,
    searchWithHits,
    editsQueued,
    editsRejected,
    emptyToolRetries,
    verifyIncomplete,
    verifyPass,
    agentRuns,
    agentTopHit,
    agentTopHitRate: agentRuns > 0 ? Math.round((agentTopHit / agentRuns) * 1000) / 10 : null,
    readRequired,
    recent: recentWindow
      .slice(-12)
      .reverse()
      .map((row) => ({
        at: row.at,
        kind: row.kind,
        source: row.source,
        detail: row.detail,
        query: row.query,
        topHit: row.topHit
      }))
  }
}
