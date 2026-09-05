export type BackgroundJob = {
  id: string
  kind: 'agent' | 'bugbot'
  title: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  createdAt: number
  finishedAt?: number
  summary?: string
  error?: string
  prompt: string
  cwd: string | null
}

const jobs = new Map<string, BackgroundJob>()
const MAX_JOBS = 40

type JobListener = (job: BackgroundJob) => void
const listeners = new Set<JobListener>()

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
}): BackgroundJob {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const job: BackgroundJob = {
    id,
    kind: input.kind,
    title: input.title.slice(0, 80) || 'Background Agent',
    status: 'queued',
    createdAt: Date.now(),
    prompt: input.prompt,
    cwd: input.cwd
  }
  jobs.set(id, job)
  prune()
  emit(job)
  return job
}

export function markBackgroundJobRunning(id: string): BackgroundJob | null {
  const job = jobs.get(id)
  if (!job || job.status === 'cancelled') return job ?? null
  job.status = 'running'
  emit(job)
  return job
}

export function completeBackgroundJob(
  id: string,
  result: { ok: boolean; summary?: string; error?: string }
): BackgroundJob | null {
  const job = jobs.get(id)
  if (!job || job.status === 'cancelled') return job ?? null
  job.status = result.ok ? 'done' : 'error'
  job.finishedAt = Date.now()
  job.summary = result.summary
  job.error = result.error
  emit(job)
  return job
}

export function cancelBackgroundJob(id: string): BackgroundJob | null {
  const job = jobs.get(id)
  if (!job) return null
  if (job.status === 'done' || job.status === 'error') return job
  job.status = 'cancelled'
  job.finishedAt = Date.now()
  job.summary = 'cancelled'
  emit(job)
  return job
}
