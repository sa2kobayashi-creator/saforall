import { useCallback, useEffect, useState } from 'react'
import './JobsPanel.css'

export type JobRow = {
  id: string
  kind: 'agent' | 'bugbot'
  title: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  createdAt: number
  finishedAt?: number
  summary?: string
  error?: string
  prompt?: string
}

type Props = {
  onOpenPrompt?: (job: JobRow) => void
}

export function JobsPanel({ onOpenPrompt }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (typeof window.saforall.listJobs !== 'function') {
      setJobs([])
      return
    }
    const listed = await window.saforall.listJobs()
    setJobs(listed as JobRow[])
  }, [])

  useEffect(() => {
    void refresh()
    const unsubUpdated =
      typeof window.saforall.onJobsUpdated === 'function'
        ? window.saforall.onJobsUpdated(() => {
            void refresh()
          })
        : null
    const unsubRun =
      typeof window.saforall.onJobRun === 'function'
        ? window.saforall.onJobRun(() => {
            void refresh()
          })
        : null
    const timer = window.setInterval(() => {
      void refresh()
    }, 4000)
    return () => {
      unsubUpdated?.()
      unsubRun?.()
      window.clearInterval(timer)
    }
  }, [refresh])

  const cancel = async (id: string) => {
    setBusyId(id)
    try {
      await window.saforall.cancelJob(id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="jobs-panel" aria-label="Background Jobs">
      <div className="jobs-head">
        <strong>Jobs</strong>
        <button type="button" onClick={() => void refresh()}>
          ↻
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="jobs-empty">Background / Bugbot ジョブはまだありません</p>
      ) : (
        <ul className="jobs-list">
          {jobs.map((job) => (
            <li key={job.id} className={`jobs-item status-${job.status}`}>
              <div className="jobs-main">
                <span className="jobs-kind">{job.kind}</span>
                <strong>{job.title}</strong>
                <em>{job.status}</em>
              </div>
              <div className="jobs-meta">
                <code>{job.id}</code>
                {job.summary ? <span>{job.summary}</span> : null}
                {job.error ? <span className="jobs-error">{job.error}</span> : null}
              </div>
              <div className="jobs-actions">
                {onOpenPrompt ? (
                  <button type="button" onClick={() => onOpenPrompt(job)}>
                    詳細
                  </button>
                ) : null}
                {(job.status === 'queued' || job.status === 'running') && (
                  <button
                    type="button"
                    disabled={busyId === job.id}
                    onClick={() => void cancel(job.id)}
                  >
                    取消
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
