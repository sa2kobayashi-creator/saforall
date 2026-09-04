export type BackgroundJob = {
  id: string
  kind: 'agent' | 'bugbot'
  title: string
  status: 'queued' | 'running' | 'done' | 'error'
  createdAt: number
  finishedAt?: number
  summary?: string
  error?: string
}

const jobs = new Map<string, BackgroundJob>()

export function listBackgroundJobs(): BackgroundJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
}
