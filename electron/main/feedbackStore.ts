import { join } from 'path'
import {
  ensureLocalDbReady,
  getLocalDbRoot,
  isoNow,
  nextLocalId,
  readJsonFile,
  writeJsonFile
} from './localDb'
import {
  extractTopPathsFromSearchResult,
  pathInTopHits,
  summarizeFeedbackEvents,
  type FeedbackEvent,
  type FeedbackKind,
  type FeedbackSummary
} from './lib/feedbackMetrics'

export type { FeedbackEvent, FeedbackKind, FeedbackSummary }
export { extractTopPathsFromSearchResult, pathInTopHits, summarizeFeedbackEvents }

type FeedbackFile = {
  version: 1
  events: FeedbackEvent[]
}

const MAX_EVENTS = 500

function feedbackPath(): string {
  return join(getLocalDbRoot(), 'feedback-events.json')
}

function counterPath(): string {
  return join(getLocalDbRoot(), 'feedback-id.json')
}

async function loadFile(): Promise<FeedbackFile> {
  await ensureLocalDbReady()
  const file = await readJsonFile<FeedbackFile>(feedbackPath(), { version: 1, events: [] })
  if (!Array.isArray(file.events)) return { version: 1, events: [] }
  return { version: 1, events: file.events }
}

/** Fire-and-forget safe append. Never throws to callers. */
export function recordFeedback(
  partial: Omit<FeedbackEvent, 'id' | 'at'> & { at?: string }
): void {
  void appendFeedback(partial).catch(() => {
    // feedback must not break search / agent
  })
}

export async function appendFeedback(
  partial: Omit<FeedbackEvent, 'id' | 'at'> & { at?: string }
): Promise<FeedbackEvent | null> {
  try {
    const file = await loadFile()
    const id = await nextLocalId(counterPath())
    const event: FeedbackEvent = {
      id,
      at: partial.at ?? isoNow(),
      kind: partial.kind,
      source: partial.source,
      ok: partial.ok,
      query: partial.query?.slice(0, 120),
      hitCount: partial.hitCount,
      topPaths: partial.topPaths?.slice(0, 8),
      tool: partial.tool,
      phase: partial.phase,
      path: partial.path?.replace(/\\/g, '/').slice(0, 260),
      detail: partial.detail?.slice(0, 200),
      editedPaths: partial.editedPaths?.slice(0, 20),
      searchTopPaths: partial.searchTopPaths?.slice(0, 12),
      topHit: partial.topHit,
      sessionKey: partial.sessionKey?.slice(0, 80)
    }
    file.events.push(event)
    if (file.events.length > MAX_EVENTS) {
      file.events = file.events.slice(-MAX_EVENTS)
    }
    await writeJsonFile(feedbackPath(), file)
    return event
  } catch {
    return null
  }
}

export function recordSearchFeedback(params: {
  source: string
  query: string
  resultText: string
  sessionKey?: string
}): void {
  const text = params.resultText.trim()
  const lines =
    !text || text === '一致なし' || text.startsWith('query')
      ? []
      : text.split(/\r?\n/).filter(Boolean)
  const tops = extractTopPathsFromSearchResult(params.resultText, 5)
  recordFeedback({
    kind: 'search',
    source: params.source,
    query: params.query,
    hitCount: lines.length,
    topPaths: tops,
    ok: lines.length > 0,
    sessionKey: params.sessionKey
  })
}

export async function getFeedbackSummary(windowDays = 7): Promise<FeedbackSummary> {
  const file = await loadFile()
  return summarizeFeedbackEvents(file.events, windowDays)
}
