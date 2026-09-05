import { mkdir, writeFile, readFile } from 'fs/promises'
import { dirname } from 'path'

export type BackgroundJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type BackgroundJob = {
  id: string
  kind: 'agent' | 'bugbot'
  title: string
  status: BackgroundJobStatus
  createdAt: number
  finishedAt?: number
  summary?: string
  error?: string
  prompt: string
  cwd: string | null
  contextNote?: string
}

export type JobTransitionEvent =
  | { type: 'start' }
  | { type: 'complete'; ok: boolean; summary?: string; error?: string }
  | { type: 'cancel' }

/** Pure state transition for Background jobs (testable without Electron). */
export function applyJobTransition(
  job: BackgroundJob,
  event: JobTransitionEvent,
  now = Date.now()
): BackgroundJob {
  if (job.status === 'cancelled' || job.status === 'done' || job.status === 'error') {
    return job
  }
  if (event.type === 'start') {
    if (job.status !== 'queued' && job.status !== 'running') return job
    return { ...job, status: 'running' }
  }
  if (event.type === 'cancel') {
    return {
      ...job,
      status: 'cancelled',
      finishedAt: now,
      summary: 'cancelled'
    }
  }
  // complete
  return {
    ...job,
    status: event.ok ? 'done' : 'error',
    finishedAt: now,
    summary: event.summary,
    error: event.error
  }
}

/** Mark in-flight jobs as cancelled for disk restore after restart. */
export function normalizeJobsAfterLoad(
  jobsList: BackgroundJob[],
  now = Date.now()
): BackgroundJob[] {
  return jobsList.map((job) => {
    if (job.status !== 'queued' && job.status !== 'running') return job
    return {
      ...job,
      status: 'cancelled' as const,
      finishedAt: job.finishedAt ?? now,
      summary: job.summary || 'interrupted (app restart)'
    }
  })
}

export function serializeJobsForPersist(jobsList: BackgroundJob[], now = Date.now()): string {
  return JSON.stringify({ version: 1, savedAt: now, jobs: jobsList }, null, 2)
}

const jobs = new Map<string, BackgroundJob>()
const MAX_JOBS = 40

type JobListener = (job: BackgroundJob) => void
const listeners = new Set<JobListener>()

let persistPath: string | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

export function configureJobsPersistence(filePath: string): void {
  persistPath = filePath
}

function schedulePersist(): void {
  if (!persistPath) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void flushJobsPersist()
  }, 200)
}

export async function flushJobsPersist(): Promise<void> {
  if (!persistPath) return
  const path = persistPath
  try {
    await mkdir(dirname(path), { recursive: true })
    const payload = serializeJobsForPersist(listBackgroundJobs())
    await writeFile(path, payload, 'utf-8')
  } catch {
    // ignore disk errors
  }
}

export async function loadPersistedJobs(): Promise<number> {
  if (!persistPath) return 0
  try {
    const raw = await readFile(persistPath, 'utf-8')
    const parsed = JSON.parse(raw) as { jobs?: BackgroundJob[] }
    const rows = Array.isArray(parsed.jobs) ? parsed.jobs : []
    jobs.clear()
    for (const job of normalizeJobsAfterLoad(rows)) {
      if (!job?.id) continue
      jobs.set(job.id, job)
    }
    prune()
    return jobs.size
  } catch {
    return 0
  }
}

export function onBackgroundJobChange(listener: JobListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(job: BackgroundJob): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(job)
    } catch {
      // ignore
    }
  }
  schedulePersist()
}

function prune(): void {
  if (jobs.size <= MAX_JOBS) return
  const sorted = Array.from(jobs.values()).sort((a, b) => a.createdAt - b.createdAt)
  while (sorted.length > MAX_JOBS) {
    const old = sorted.shift()
    if (old) jobs.delete(old.id)
  }
}

export function listBackgroundJobs(): BackgroundJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export function getBackgroundJob(id: string): BackgroundJob | null {
  return jobs.get(id) ?? null
}

export function enqueueBackgroundJob(input: {
  kind: 'agent' | 'bugbot'
  title: string
  prompt: string
  cwd: string | null
  contextNote?: string
}): BackgroundJob {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const job: BackgroundJob = {
    id,
    kind: input.kind,
    title: input.title.slice(0, 80) || 'Background Agent',
    status: 'queued',
    createdAt: Date.now(),
    prompt: input.prompt,
    cwd: input.cwd,
    contextNote: input.contextNote
  }
  jobs.set(id, job)
  prune()
  emit(job)
  return job
}

export function markBackgroundJobRunning(id: string): BackgroundJob | null {
  const current = jobs.get(id)
  if (!current) return null
  const next = applyJobTransition(current, { type: 'start' })
  jobs.set(id, next)
  emit(next)
  return next
}

export function completeBackgroundJob(
  id: string,
  result: { ok: boolean; summary?: string; error?: string }
): BackgroundJob | null {
  const current = jobs.get(id)
  if (!current) return null
  const next = applyJobTransition(current, {
    type: 'complete',
    ok: result.ok,
    summary: result.summary,
    error: result.error
  })
  jobs.set(id, next)
  emit(next)
  return next
}

export function cancelBackgroundJob(id: string): BackgroundJob | null {
  const current = jobs.get(id)
  if (!current) return null
  const next = applyJobTransition(current, { type: 'cancel' })
  jobs.set(id, next)
  emit(next)
  return next
}

/** Extract job id from a Background Agent chat prompt prefix. */
export function extractBackgroundJobId(prompt: string): string | null {
  const match = prompt.match(/【Background Agent · (job-[a-z0-9-]+)】/i)
  return match?.[1] ?? null
}
