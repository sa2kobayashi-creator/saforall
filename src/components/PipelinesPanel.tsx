import { useCallback, useEffect, useMemo, useState } from 'react'
import './PipelinesPanel.css'

type PipelineStepType = 'AI' | 'AGENT' | 'OUTPUT'

type PipelineStepDefinition = {
  id: string
  type: PipelineStepType
  name: string
  order: number
}

type PipelineDefinition = {
  id: string
  name: string
  description?: string
  version: number
  steps: PipelineStepDefinition[]
  createdAt: string
  updatedAt: string
}

type StepRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'skipped'

type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'

type StepRun = {
  id: string
  stepId: string
  type: PipelineStepType
  status: StepRunStatus
  output: { text?: string } | null
  error?: { message?: string } | null
}

type PipelineRun = {
  id: string
  pipelineId: string
  status: PipelineRunStatus
  currentStepId: string | null
  stepRuns: StepRun[]
  startedAt?: string
  completedAt?: string
  error?: { message?: string; stepId?: string } | null
  input?: { task?: string }
}

type RunSummary = {
  id: string
  pipelineId: string
  status: string
  updatedAt: string
}

type PipelineEvent = {
  type: string
  runId?: string
  stepId?: string
  path?: string
  content?: string
  error?: { message?: string; stepId?: string }
}

type Props = {
  workspacePath: string | null
  width: number
  onOpenWorkspace: () => void
  onStatusMessage?: (message: string) => void
  onApplyCode?: (
    code: string,
    pathHint?: string,
    language?: string,
    options?: { auto?: boolean; review?: boolean; forceReplace?: boolean }
  ) => void | Promise<void>
}

function formatWhen(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function stepMarker(status: StepRunStatus | undefined, isCurrent: boolean): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✕'
  if (status === 'cancelled' || status === 'cancelling') return '■'
  if (status === 'running' || isCurrent) return '●'
  return '○'
}

function userFacingError(run: PipelineRun | null): string | null {
  if (!run?.error?.message) return null
  const step = run.stepRuns.find((s) => s.stepId === run.error?.stepId)
  const stepLabel = step ? step.stepId : run.error.stepId
  const reason = run.error.message.slice(0, 280)
  return stepLabel ? `Step: ${stepLabel}\nReason: ${reason}` : reason
}

function languageFromPath(path: string): string | undefined {
  const lower = path.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  return undefined
}

export function PipelinesPanel({
  workspacePath,
  width,
  onOpenWorkspace,
  onStatusMessage,
  onApplyCode
}: Props) {
  const [pipelines, setPipelines] = useState<PipelineDefinition[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pipeline, setPipeline] = useState<PipelineDefinition | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [task, setTask] = useState('')
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('Spec → Implement → Verify')

  const refreshList = useCallback(async () => {
    if (typeof window.saforall.listPipelines !== 'function') {
      setPipelines([])
      return
    }
    if (typeof window.saforall.ensureFlagshipPipeline === 'function') {
      try {
        await window.saforall.ensureFlagshipPipeline()
      } catch {
        // ignore; list may still work
      }
    }
    const listed = (await window.saforall.listPipelines()) as PipelineDefinition[]
    setPipelines(Array.isArray(listed) ? listed : [])
  }, [])

  const refreshRuns = useCallback(async (pipelineId: string | null) => {
    if (!pipelineId || typeof window.saforall.listPipelineRuns !== 'function') {
      setRuns([])
      return
    }
    const all = (await window.saforall.listPipelineRuns()) as RunSummary[]
    const filtered = (Array.isArray(all) ? all : []).filter((r) => r.pipelineId === pipelineId)
    setRuns(filtered)
  }, [])

  const openPipeline = useCallback(
    async (id: string) => {
      setError(null)
      setSelectedId(id)
      const row = (await window.saforall.getPipeline(id)) as PipelineDefinition | null
      setPipeline(row)
      setNameDraft(row?.name || '')
      await refreshRuns(id)
    },
    [refreshRuns]
  )

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    if (typeof window.saforall.onPipelineEvent !== 'function') return
    return window.saforall.onPipelineEvent((raw) => {
      const event = raw as PipelineEvent
      if (
        event.type === 'edit_proposal' &&
        typeof event.path === 'string' &&
        typeof event.content === 'string' &&
        onApplyCode
      ) {
        void onApplyCode(event.content, event.path, languageFromPath(event.path), {
          auto: true,
          review: true,
          forceReplace: true
        })
      }
      if (!event.runId) return

      if (event.type === 'run_started') {
        setActiveRun((current) => {
          if (current?.id === event.runId) return current
          return {
            id: event.runId!,
            pipelineId: (event as { pipelineId?: string }).pipelineId || selectedId || '',
            status: 'running',
            currentStepId: null,
            stepRuns: []
          }
        })
      }

      void (async () => {
        const run = (await window.saforall.getPipelineRun(event.runId!)) as PipelineRun | null
        if (!run) return
        setActiveRun((current) => {
          if (current && current.id !== run.id && current.pipelineId !== run.pipelineId) {
            return current
          }
          return run
        })
        if (run.pipelineId === selectedId) {
          void refreshRuns(selectedId)
        }
        if (
          event.type === 'run_completed' ||
          event.type === 'run_failed' ||
          event.type === 'run_cancelled'
        ) {
          onStatusMessage?.(
            event.type === 'run_completed'
              ? `Pipeline completed: ${run.id}`
              : event.type === 'run_cancelled'
                ? `Pipeline cancelled: ${run.id}`
                : `Pipeline failed: ${run.id}`
          )
        }
      })()
    })
  }, [onApplyCode, onStatusMessage, refreshRuns, selectedId])

  const stepStatusMap = useMemo(() => {
    const map = new Map<string, StepRun>()
    for (const sr of activeRun?.stepRuns || []) {
      map.set(sr.stepId, sr)
    }
    return map
  }, [activeRun])

  const isRunning =
    activeRun?.status === 'running' ||
    activeRun?.status === 'queued' ||
    activeRun?.status === 'cancelling'

  const createPipeline = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = (await window.saforall.createPipeline({
        name: createName.trim() || undefined
      })) as PipelineDefinition
      setCreating(false)
      setCreateName('Spec → Implement → Verify')
      await refreshList()
      await openPipeline(created.id)
      onStatusMessage?.(`Pipeline を作成しました: ${created.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveName = async () => {
    if (!pipeline) return
    const nextName = nameDraft.trim()
    if (!nextName) {
      setError('Pipeline名を入力してください')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = (await window.saforall.savePipeline({
        ...pipeline,
        name: nextName
      })) as PipelineDefinition
      setPipeline(saved)
      setNameDraft(saved.name)
      await refreshList()
      onStatusMessage?.(`Pipeline を保存しました: ${saved.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runPipeline = async () => {
    if (!pipeline) return
    if (!workspacePath) {
      setError('先にワークスペースを開いてください')
      return
    }
    const taskText = task.trim()
    if (!taskText) {
      setError('Task を入力してください')
      return
    }
    setError(null)
    setBusy(true)
    onStatusMessage?.('Pipeline Running…')
    // Do not hold busy for the whole run — Cancel must stay clickable while startPipeline awaits.
    const pipelineId = pipeline.id
    void (async () => {
      try {
        const run = (await window.saforall.startPipeline({
          pipelineId,
          input: { task: taskText, workspacePath }
        })) as PipelineRun
        setActiveRun(run)
        await refreshRuns(pipelineId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    })()
    // Release the Start button lock once invoke is in flight; progress comes from events.
    window.setTimeout(() => setBusy(false), 0)
  }

  const cancelRun = async () => {
    if (!activeRun?.id) return
    try {
      await window.saforall.cancelPipeline(activeRun.id)
      const run = (await window.saforall.getPipelineRun(activeRun.id)) as PipelineRun | null
      if (run) setActiveRun(run)
      if (pipeline) await refreshRuns(pipeline.id)
      onStatusMessage?.('Pipeline Cancel を要求しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openRun = async (runId: string) => {
    const run = (await window.saforall.getPipelineRun(runId)) as PipelineRun | null
    if (run) {
      setActiveRun(run)
      if (run.input?.task) setTask(run.input.task)
    }
  }

  const sortedSteps = useMemo(() => {
    if (!pipeline) return []
    return [...pipeline.steps].sort((a, b) => a.order - b.order)
  }, [pipeline])

  return (
    <div className="pipelines-panel" style={{ width, minWidth: width }} aria-label="Pipelines">
      <div className="pipelines-header">
        <strong>Pipelines</strong>
        <div className="pipelines-header-actions">
          <button type="button" disabled={busy} onClick={() => void refreshList()}>
            ↻
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
              setPipeline(null)
              setActiveRun(null)
            }}
          >
            ＋ 新規
          </button>
        </div>
      </div>

      {error ? <p className="pipelines-error">{error}</p> : null}

      {!workspacePath ? (
        <div className="pipelines-empty">
          <p>Pipeline を実行するにはワークスペースが必要です。</p>
          <button type="button" onClick={onOpenWorkspace}>
            フォルダを開く
          </button>
        </div>
      ) : null}

      {creating ? (
        <div className="pipelines-create">
          <label>
            Pipeline Name
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Spec → Implement → Verify"
            />
          </label>
          <p className="pipelines-hint">
            Flagship テンプレート（Spec → Implement → Verify → Output）から作成します。
          </p>
          <div className="pipelines-actions">
            <button type="button" disabled={busy} onClick={() => void createPipeline()}>
              作成して保存
            </button>
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {!pipeline && !creating ? (
        <ul className="pipelines-list">
          {pipelines.length === 0 ? (
            <li className="pipelines-empty-row">Pipeline はまだありません</li>
          ) : (
            pipelines.map((row) => (
              <li key={row.id} className="pipelines-item">
                <div className="pipelines-item-main">
                  <strong>{row.name}</strong>
                  <span>
                    {row.steps?.length ?? 0} steps · {formatWhen(row.updatedAt)}
                  </span>
                </div>
                <div className="pipelines-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openPipeline(row.id)}
                  >
                    開く
                  </button>
                  <button
                    type="button"
                    disabled={busy || !workspacePath}
                    onClick={() => {
                      void (async () => {
                        await openPipeline(row.id)
                      })()
                    }}
                  >
                    Run…
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {pipeline ? (
        <div className="pipelines-detail">
          <div className="pipelines-actions">
            <button
              type="button"
              onClick={() => {
                setPipeline(null)
                setSelectedId(null)
                setActiveRun(null)
                setError(null)
                void refreshList()
              }}
            >
              ← 一覧
            </button>
          </div>

          <label className="pipelines-field">
            Pipeline Name
            <div className="pipelines-name-row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button type="button" disabled={busy} onClick={() => void saveName()}>
                保存
              </button>
            </div>
          </label>

          {pipeline.description ? (
            <p className="pipelines-hint">{pipeline.description}</p>
          ) : null}

          <div className="pipelines-section">
            <strong>Steps</strong>
            <ol className="pipelines-steps">
              {sortedSteps.map((step) => {
                const sr = stepStatusMap.get(step.id)
                const marker = stepMarker(
                  sr?.status,
                  activeRun?.currentStepId === step.id && isRunning
                )
                return (
                  <li key={step.id}>
                    <span className="pipelines-step-mark" aria-hidden>
                      {marker}
                    </span>
                    <div>
                      <strong>{step.name}</strong>
                      <em>Type: {step.type}</em>
                      {sr?.status ? <span className="pipelines-step-status">{sr.status}</span> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          <label className="pipelines-field">
            Task
            <textarea
              rows={4}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="example.ts に hello 関数を追加し、その実装を検証してください"
              disabled={isRunning}
            />
          </label>

          <div className="pipelines-actions">
            {isRunning ? (
              <button type="button" onClick={() => void cancelRun()}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !workspacePath}
                onClick={() => void runPipeline()}
              >
                {activeRun &&
                (activeRun.status === 'completed' ||
                  activeRun.status === 'failed' ||
                  activeRun.status === 'cancelled')
                  ? 'Run Again'
                  : 'Run'}
              </button>
            )}
          </div>

          {activeRun ? (
            <div className="pipelines-run">
              <div className="pipelines-run-head">
                <strong>
                  {isRunning
                    ? 'Pipeline Running…'
                    : activeRun.status === 'completed'
                      ? 'Completed'
                      : activeRun.status === 'cancelled'
                        ? 'Cancelled'
                        : activeRun.status === 'failed'
                          ? 'Pipeline Failed'
                          : activeRun.status}
                </strong>
                <code>{activeRun.id}</code>
              </div>
              {userFacingError(activeRun) ? (
                <pre className="pipelines-fail">{userFacingError(activeRun)}</pre>
              ) : null}
              {activeRun.status === 'completed' ? (
                <div className="pipelines-outputs">
                  {sortedSteps.map((step) => {
                    const sr = stepStatusMap.get(step.id)
                    const text = sr?.output?.text?.trim()
                    return (
                      <details key={step.id} open={step.type === 'OUTPUT'}>
                        <summary>
                          {step.name} ({sr?.status || '—'})
                        </summary>
                        <pre>{text || '(no text output)'}</pre>
                      </details>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="pipelines-section">
            <strong>Run 履歴</strong>
            {runs.length === 0 ? (
              <p className="pipelines-hint">まだ Run はありません</p>
            ) : (
              <ul className="pipelines-runs">
                {runs.slice(0, 20).map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => void openRun(row.id)}>
                      <code>{row.id}</code>
                      <span>{row.status}</span>
                      <em>{formatWhen(row.updatedAt)}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
