import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'path'
import type { ChatStreamEvent } from '../api'

/**
 * Agent Run Trace — metadata-only timeline for one mode=agent toolAgent execution.
 *
 * Run ID = chatStream requestId (NOT UsageEvent.requestId).
 * UsageEvent.requestId remains 1 provider attempt.
 *
 * Retention is intentionally unspecified (not copied from Usage 7日/10000件).
 * SAFETY_MAX_* are implementation guards only, not product policy.
 */

export type AgentRunStatus = 'running' | 'done' | 'error' | 'cancelled'

export type AgentRunTraceKind =
  | 'run_start'
  | 'phase'
  | 'tool_call'
  | 'tool_result'
  | 'checkpoint'
  | 'provider_attempt'
  | 'run_end'
  | 'run_error'
  | 'run_cancelled'

export type AgentRunTraceEvent = {
  at: string
  kind: AgentRunTraceKind
  phase?: string
  step?: number
  toolName?: string
  toolOk?: boolean
  checkpointStep?: number
  provider?: string
  model?: string
  usageRequestId?: string
  failoverId?: string | null
  errorCode?: string
}

export type AgentRunRecord = {
  runId: string
  sessionId: number | null
  mode: 'agent'
  engine: string
  model: string
  provider: string
  startedAt: string
  endedAt: string | null
  status: AgentRunStatus
  usageRequestIds: string[]
  failoverIds: string[]
  events: AgentRunTraceEvent[]
}

type AgentRunFile = {
  version: 1
  /** Product retention is TBD; do not treat as Usage 7/10000. */
  retentionPolicy: 'unspecified'
  runs: AgentRunRecord[]
}

/** Implementation safety cap — not a product retention policy. */
const SAFETY_MAX_AGENT_RUNS = 200
/** Implementation safety cap per run — not a product retention policy. */
const SAFETY_MAX_EVENTS_PER_RUN = 400

const runContext = new AsyncLocalStorage<string>()
const memory = new Map<string, AgentRunRecord>()
let loaded = false
let writeChain: Promise<void> = Promise.resolve()

function isoNow(): string {
  return new Date().toISOString()
}

function isTerminalStatus(status: AgentRunStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

function emptyFile(): AgentRunFile {
  return { version: 1, retentionPolicy: 'unspecified', runs: [] }
}

function agentRunsPath(getLocalDbRoot: () => string): string {
  return join(getLocalDbRoot(), 'agent-runs.json')
}

async function loadLocalDb() {
  const { ensureLocalDbReady, getLocalDbRoot, readJsonFile, writeJsonFile } = await import(
    '../localDb'
  )
  await ensureLocalDbReady()
  return { getLocalDbRoot, readJsonFile, writeJsonFile }
}

function cloneRun(run: AgentRunRecord): AgentRunRecord {
  return {
    ...run,
    usageRequestIds: [...run.usageRequestIds],
    failoverIds: [...run.failoverIds],
    events: run.events.map((event) => ({ ...event }))
  }
}

function applySafetyCaps(runs: AgentRunRecord[]): AgentRunRecord[] {
  const capped = runs.map((run) => {
    if (run.events.length <= SAFETY_MAX_EVENTS_PER_RUN) return run
    return { ...run, events: run.events.slice(-SAFETY_MAX_EVENTS_PER_RUN) }
  })
  if (capped.length <= SAFETY_MAX_AGENT_RUNS) return capped
  return capped
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .slice(-SAFETY_MAX_AGENT_RUNS)
}

async function persistNow(): Promise<void> {
  try {
    const { getLocalDbRoot, writeJsonFile } = await loadLocalDb()
    const file: AgentRunFile = {
      version: 1,
      retentionPolicy: 'unspecified',
      runs: applySafetyCaps(Array.from(memory.values()).map(cloneRun))
    }
    await writeJsonFile(agentRunsPath(getLocalDbRoot), file)
  } catch {
    // localDb 未初期化（単体テスト）ではメモリのみ
  }
}

function schedulePersist(): void {
  writeChain = writeChain.then(() => persistNow()).catch(() => undefined)
}

export async function flushAgentRunTrace(): Promise<void> {
  await writeChain
  await persistNow()
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const { getLocalDbRoot, readJsonFile } = await loadLocalDb()
    const file = await readJsonFile<AgentRunFile>(agentRunsPath(getLocalDbRoot), emptyFile())
    const runs = Array.isArray(file.runs) ? file.runs : []
    let dirty = false
    for (const raw of runs) {
      if (!raw || typeof raw.runId !== 'string' || !raw.runId) continue
      const run = normalizePersistedRun(raw)
      if (run.status === 'running') {
        run.status = 'error'
        run.endedAt = run.endedAt || isoNow()
        appendEvent(run, {
          at: run.endedAt,
          kind: 'run_error',
          errorCode: 'RUN_INCOMPLETE'
        })
        dirty = true
      }
      memory.set(run.runId, run)
    }
    if (dirty) schedulePersist()
  } catch {
    // keep empty memory
  }
}

function normalizePersistedRun(raw: AgentRunRecord): AgentRunRecord {
  const status: AgentRunStatus =
    raw.status === 'done' || raw.status === 'error' || raw.status === 'cancelled'
      ? raw.status
      : 'running'
  return {
    runId: String(raw.runId),
    sessionId: typeof raw.sessionId === 'number' ? raw.sessionId : null,
    mode: 'agent',
    engine: String(raw.engine || ''),
    model: String(raw.model || ''),
    provider: String(raw.provider || raw.engine || ''),
    startedAt: String(raw.startedAt || isoNow()),
    endedAt: raw.endedAt ? String(raw.endedAt) : null,
    status,
    usageRequestIds: Array.isArray(raw.usageRequestIds)
      ? raw.usageRequestIds.map(String).filter(Boolean)
      : [],
    failoverIds: Array.isArray(raw.failoverIds)
      ? raw.failoverIds.map(String).filter(Boolean)
      : [],
    events: Array.isArray(raw.events) ? raw.events.map(sanitizeStoredEvent) : []
  }
}

function sanitizeStoredEvent(raw: AgentRunTraceEvent): AgentRunTraceEvent {
  const event: AgentRunTraceEvent = {
    at: String(raw.at || isoNow()),
    kind: raw.kind
  }
  if (raw.phase) event.phase = String(raw.phase)
  if (typeof raw.step === 'number') event.step = raw.step
  if (raw.toolName) event.toolName = String(raw.toolName)
  if (typeof raw.toolOk === 'boolean') event.toolOk = raw.toolOk
  if (typeof raw.checkpointStep === 'number') event.checkpointStep = raw.checkpointStep
  if (raw.provider) event.provider = String(raw.provider)
  if (raw.model) event.model = String(raw.model)
  if (raw.usageRequestId) event.usageRequestId = String(raw.usageRequestId)
  if (raw.failoverId) event.failoverId = String(raw.failoverId)
  if (raw.errorCode) event.errorCode = String(raw.errorCode)
  return event
}

function appendEvent(run: AgentRunRecord, event: AgentRunTraceEvent): void {
  if (run.events.length >= SAFETY_MAX_EVENTS_PER_RUN) {
    run.events.shift()
  }
  run.events.push(event)
}

function applyTerminalFromKind(run: AgentRunRecord, event: AgentRunTraceEvent): void {
  if (event.kind === 'run_end') {
    run.status = 'done'
    run.endedAt = event.at
  } else if (event.kind === 'run_error') {
    run.status = 'error'
    run.endedAt = event.at
  } else if (event.kind === 'run_cancelled') {
    run.status = 'cancelled'
    run.endedAt = event.at
  }
}

/**
 * Map existing ChatStreamEvent → metadata-only Trace event.
 * Never copies prompt / args / output / summary / note / message / content.
 */
export function toAgentRunTraceEvent(event: ChatStreamEvent): AgentRunTraceEvent | null {
  const at = isoNow()
  switch (event.type) {
    case 'agent_phase':
      return { at, kind: 'phase', phase: event.phase }
    case 'tool_call':
      return { at, kind: 'tool_call', toolName: event.name }
    case 'tool_result':
      return { at, kind: 'tool_result', toolName: event.name, toolOk: event.ok }
    case 'agent_checkpoint':
      return { at, kind: 'checkpoint', checkpointStep: event.step, phase: event.phase }
    case 'done':
      return { at, kind: 'run_end' }
    case 'error':
      return { at, kind: 'run_error', errorCode: event.code }
    case 'cancelled':
      return { at, kind: 'run_cancelled' }
    default:
      return null
  }
}

export async function beginAgentRun(input: {
  runId: string
  sessionId?: number | null
  engine: string
  model: string
  provider?: string
}): Promise<AgentRunRecord | null> {
  const runId = String(input.runId || '').trim()
  if (!runId) return null
  await ensureLoaded()
  const startedAt = isoNow()
  const run: AgentRunRecord = {
    runId,
    sessionId: typeof input.sessionId === 'number' ? input.sessionId : null,
    mode: 'agent',
    engine: String(input.engine || ''),
    model: String(input.model || ''),
    provider: String(input.provider || input.engine || ''),
    startedAt,
    endedAt: null,
    status: 'running',
    usageRequestIds: [],
    failoverIds: [],
    events: [{ at: startedAt, kind: 'run_start' }]
  }
  memory.set(runId, run)
  await persistNow()
  return cloneRun(run)
}

export async function observeAgentStreamEvent(
  runId: string,
  event: ChatStreamEvent
): Promise<void> {
  const traced = toAgentRunTraceEvent(event)
  if (!traced) return
  await ensureLoaded()
  const run = memory.get(runId)
  if (!run || isTerminalStatus(run.status)) return
  appendEvent(run, traced)
  applyTerminalFromKind(run, traced)
  await persistNow()
}

export async function noteAgentRunProviderAttempt(input: {
  usageRequestId: string
  provider: string
  model: string
  status: 'ok' | 'error'
  failoverId?: string | null
}): Promise<void> {
  const runId = runContext.getStore()
  if (!runId) return
  await ensureLoaded()
  const run = memory.get(runId)
  if (!run || isTerminalStatus(run.status)) return
  const usageRequestId = String(input.usageRequestId || '')
  if (usageRequestId && !run.usageRequestIds.includes(usageRequestId)) {
    run.usageRequestIds.push(usageRequestId)
  }
  const failoverId = input.failoverId ? String(input.failoverId) : null
  if (failoverId && !run.failoverIds.includes(failoverId)) {
    run.failoverIds.push(failoverId)
  }
  appendEvent(run, {
    at: isoNow(),
    kind: 'provider_attempt',
    provider: String(input.provider || ''),
    model: String(input.model || ''),
    usageRequestId: usageRequestId || undefined,
    failoverId
  })
  await persistNow()
}

export async function finalizeAgentRunIfOpen(
  runId: string,
  fallback: 'error' | 'cancelled' = 'error'
): Promise<void> {
  await ensureLoaded()
  const run = memory.get(runId)
  if (!run || isTerminalStatus(run.status)) return
  const at = isoNow()
  const kind = fallback === 'cancelled' ? 'run_cancelled' : 'run_error'
  appendEvent(run, {
    at,
    kind,
    errorCode: fallback === 'error' ? 'RUN_INCOMPLETE' : undefined
  })
  run.status = fallback
  run.endedAt = at
  await persistNow()
}

export async function runInAgentRunContext<T>(
  runId: string,
  fn: () => Promise<T>
): Promise<T> {
  return runContext.run(runId, fn)
}

export function getActiveAgentRunId(): string | undefined {
  return runContext.getStore()
}

export async function listAgentRuns(): Promise<AgentRunRecord[]> {
  await ensureLoaded()
  return Array.from(memory.values())
    .map(cloneRun)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
}

export async function getAgentRun(runId: string): Promise<AgentRunRecord | null> {
  await ensureLoaded()
  const run = memory.get(runId)
  return run ? cloneRun(run) : null
}

export async function resetAgentRunTraceForTests(): Promise<void> {
  memory.clear()
  loaded = false
  writeChain = Promise.resolve()
}
