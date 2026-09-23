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
  pipelineId?: string
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

const FLAGSHIP_ID = 'flagship-spec-implement-verify'

function formatWhen(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function stepRole(step: PipelineStepDefinition): string {
  const key = `${step.id} ${step.name}`.toLowerCase()
  if (key.includes('spec')) return '仕様を整理する'
  if (key.includes('implement')) return '仕様をもとに実装する'
  if (key.includes('verify')) return '実装結果を確認する'
  if (key.includes('output')) return '作業結果をまとめる'
  if (step.type === 'AI') return 'AIが内容を整理・生成します'
  if (step.type === 'AGENT') return 'AIが実際に作業を行います'
  if (step.type === 'OUTPUT') return 'これまでの結果をまとめます'
  return 'この Pipeline の一作業'
}

function stepTypeLabel(type: PipelineStepType): { title: string; detail: string } {
  if (type === 'AI') {
    return { title: 'AI Step', detail: '文章や仕様など、結果テキストを生成します' }
  }
  if (type === 'AGENT') {
    return { title: 'Agent Step', detail: 'AIがツールを使い、実際に作業を進めます' }
  }
  return { title: 'Output Step', detail: 'これまでの Step 結果をまとめます' }
}

function stepIoHint(
  step: PipelineStepDefinition,
  index: number,
  total: number
): { input: string; output: string } {
  const key = `${step.id} ${step.name}`.toLowerCase()
  if (key.includes('spec')) {
    return { input: 'あなたが入力した Task', output: '整理された仕様' }
  }
  if (key.includes('implement')) {
    return { input: 'Spec の結果', output: '実装結果・変更内容' }
  }
  if (key.includes('verify')) {
    return { input: 'Spec と Implement の結果', output: '検証結果' }
  }
  if (key.includes('output')) {
    return { input: 'これまでの全 Step 結果', output: '最終まとめ' }
  }
  if (index === 0) return { input: 'Pipeline の Task', output: 'この Step の結果' }
  if (index === total - 1) return { input: '前の Step の結果', output: '最終まとめ' }
  return { input: '前の Step の結果', output: '次の Step へ渡す結果' }
}

function pipelineOneLiner(pipeline: PipelineDefinition): string {
  if (pipeline.id === FLAGSHIP_ID || /spec|implement|verify/i.test(pipeline.name)) {
    return 'コード変更を「仕様 → 実装 → 検証」まで一連の流れで実行します。'
  }
  if (pipeline.description?.trim()) return pipeline.description.trim()
  const names = [...pipeline.steps]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.name)
    .join(' → ')
  return names
    ? `「${names}」の順で AI の作業をつなぎ、同じ流れを再利用できます。`
    : 'AI の作業手順を保存し、何度でも実行できます。'
}

function stepMarker(status: StepRunStatus | undefined, isCurrent: boolean): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✕'
  if (status === 'cancelled' || status === 'cancelling') return '■'
  if (status === 'running' || isCurrent) return '●'
  return '○'
}

function stepFlowLabel(status: StepRunStatus | undefined, isCurrent: boolean): string {
  if (status === 'completed') return '完了'
  if (status === 'failed') return '失敗'
  if (status === 'cancelled' || status === 'cancelling') return '取消'
  if (status === 'running' || isCurrent) return '実行中'
  return '待機'
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
  const [showValueHelp, setShowValueHelp] = useState(true)

  const refreshList = useCallback(async () => {
    if (typeof window.saforall.listPipelines !== 'function') {
      setPipelines([])
      return
    }
    if (typeof window.saforall.ensureFlagshipPipeline === 'function') {
      try {
        await window.saforall.ensureFlagshipPipeline()
      } catch {
        // ignore
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
    setRuns((Array.isArray(all) ? all : []).filter((r) => r.pipelineId === pipelineId))
  }, [])

  const openPipeline = useCallback(
    async (id: string) => {
      setError(null)
      setCreating(false)
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
            pipelineId: event.pipelineId || selectedId || '',
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
        if (run.pipelineId === selectedId) void refreshRuns(selectedId)
        if (
          event.type === 'run_completed' ||
          event.type === 'run_failed' ||
          event.type === 'run_cancelled'
        ) {
          onStatusMessage?.(
            event.type === 'run_completed'
              ? `Pipeline 完了: ${run.id}`
              : event.type === 'run_cancelled'
                ? `Pipeline 取消: ${run.id}`
                : `Pipeline 失敗: ${run.id}`
          )
        }
      })()
    })
  }, [onApplyCode, onStatusMessage, refreshRuns, selectedId])

  const stepStatusMap = useMemo(() => {
    const map = new Map<string, StepRun>()
    for (const sr of activeRun?.stepRuns || []) map.set(sr.stepId, sr)
    return map
  }, [activeRun])

  const isRunning =
    activeRun?.status === 'running' ||
    activeRun?.status === 'queued' ||
    activeRun?.status === 'cancelling'

  const sortedSteps = useMemo(() => {
    if (!pipeline) return []
    return [...pipeline.steps].sort((a, b) => a.order - b.order)
  }, [pipeline])

  const flowPreview = sortedSteps.map((s) => s.name).join(' → ')
  const canRunAgain =
    !!activeRun &&
    (activeRun.status === 'completed' ||
      activeRun.status === 'failed' ||
      activeRun.status === 'cancelled')

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

  const startFromSample = async () => {
    setBusy(true)
    setError(null)
    try {
      if (typeof window.saforall.ensureFlagshipPipeline === 'function') {
        await window.saforall.ensureFlagshipPipeline()
      }
      await refreshList()
      await openPipeline(FLAGSHIP_ID)
      onStatusMessage?.('サンプル Pipeline を開きました')
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
      setError('Task（やらせたい仕事）を入力してください')
      return
    }
    setError(null)
    setBusy(true)
    onStatusMessage?.('Pipeline を実行しています…')
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
    window.setTimeout(() => setBusy(false), 0)
  }

  const cancelRun = async () => {
    if (!activeRun?.id) return
    try {
      await window.saforall.cancelPipeline(activeRun.id)
      const run = (await window.saforall.getPipelineRun(activeRun.id)) as PipelineRun | null
      if (run) setActiveRun(run)
      if (pipeline) await refreshRuns(pipeline.id)
      onStatusMessage?.('Pipeline の取消を要求しました')
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

  const backToList = () => {
    setPipeline(null)
    setSelectedId(null)
    setActiveRun(null)
    setError(null)
    void refreshList()
  }

  return (
    <div className="pipelines-panel" style={{ width, minWidth: width }} aria-label="Pipeline">
      <div className="pipelines-header">
        <strong>Pipeline</strong>
        <div className="pipelines-header-actions">
          <button type="button" disabled={busy} onClick={() => void refreshList()} title="再読込">
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
            ＋ 新しいPipeline
          </button>
        </div>
      </div>

      {!pipeline && !creating ? (
        <div className="pipelines-intro">
          <p className="pipelines-intro-lead">
            AI に行わせる仕事の<strong>手順を保存</strong>し、同じ作業を何度でも実行できます。
          </p>
          <p className="pipelines-hint">
            複数の AI 作業を順番につなぎ、前の結果を次へ自動的に渡せます。どの Provider / Model
            を使うかは Router の役割で、Pipeline とは別です。
          </p>
          {showValueHelp ? (
            <div className="pipelines-value-card">
              <div className="pipelines-compare">
                <div>
                  <strong>Chat</strong>
                  <p>指示 → 結果 → 次の指示…と、毎回あなたがつなぎます。</p>
                </div>
                <div>
                  <strong>Pipeline</strong>
                  <p>一度手順を決めると、同じ流れを再利用できます。</p>
                </div>
              </div>
              <p className="pipelines-hint">
                <strong>一度作った作業の流れを、同じ手順で繰り返し実行できます。</strong>
              </p>
              <ul className="pipelines-can-list">
                <li>AI の作業を複数 Step につなげる</li>
                <li>Step 間で結果を自動的に渡す</li>
                <li>Pipeline を保存・再利用・実行する</li>
                <li>実行結果を確認し、もう一度実行する</li>
              </ul>
              <p className="pipelines-example">
                例: 「仕様を書いて → 実装して → 検証する」を Pipeline にしておけば、Task
                を変えるだけで同じ流れを回せます。
              </p>
              <button
                type="button"
                className="pipelines-linkish"
                onClick={() => setShowValueHelp(false)}
              >
                説明を閉じる
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="pipelines-linkish"
              onClick={() => setShowValueHelp(true)}
            >
              Pipeline とは？を再表示
            </button>
          )}
        </div>
      ) : null}

      {error ? <p className="pipelines-error">{error}</p> : null}

      {!workspacePath ? (
        <div className="pipelines-empty">
          <p>Pipeline を実行するには、先にフォルダ（ワークスペース）を開いてください。</p>
          <button type="button" onClick={onOpenWorkspace}>
            フォルダを開く
          </button>
        </div>
      ) : null}

      {creating ? (
        <div className="pipelines-create">
          <h3 className="pipelines-section-title">新しい Pipeline</h3>
          <p className="pipelines-hint">
            Pipeline は「AI にやらせる仕事の手順」です。例: 仕様作成 → 実装 → 検証 →
            結果整理。この手順を保存しておけば、次回から同じ流れをもう一度実行できます。
          </p>
          <label className="pipelines-field">
            Pipeline 名
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Spec → Implement → Verify"
            />
          </label>
          <p className="pipelines-hint">
            作成時は Flagship テンプレート（Spec → Implement → Verify →
            Output）を使います。各 Step の役割は作成後に確認できます。
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
        pipelines.length === 0 ? (
          <div className="pipelines-empty-state">
            <h3 className="pipelines-section-title">Pipeline で AI の仕事を自動化しましょう</h3>
            <p className="pipelines-hint">
              Pipeline は、「AI に何をどの順番でやらせるか」を保存しておく機能です。
            </p>
            <ol className="pipelines-flow-preview">
              <li>
                <strong>仕様作成</strong>
                <span>やりたいことを整理</span>
              </li>
              <li>
                <strong>実装</strong>
                <span>コードを書く</span>
              </li>
              <li>
                <strong>検証</strong>
                <span>結果を確認</span>
              </li>
              <li>
                <strong>結果整理</strong>
                <span>まとめを出力</span>
              </li>
            </ol>
            <p className="pipelines-hint">一度作れば、次回から同じ流れを実行できます。</p>
            <div className="pipelines-actions">
              <button type="button" disabled={busy} onClick={() => void startFromSample()}>
                サンプル Pipeline から始める
              </button>
              <button type="button" disabled={busy} onClick={() => setCreating(true)}>
                新しい Pipeline を作る
              </button>
            </div>
          </div>
        ) : (
          <ul className="pipelines-list">
            {pipelines.map((row) => (
              <li key={row.id} className="pipelines-item">
                <div className="pipelines-item-main">
                  <strong>{row.name}</strong>
                  <p className="pipelines-item-blurb">{pipelineOneLiner(row)}</p>
                  <span>
                    {row.steps?.length ?? 0} Steps · 更新 {formatWhen(row.updatedAt)}
                  </span>
                </div>
                <div className="pipelines-actions">
                  <button type="button" disabled={busy} onClick={() => void openPipeline(row.id)}>
                    開く
                  </button>
                  <button
                    type="button"
                    disabled={busy || !workspacePath}
                    onClick={() => void openPipeline(row.id)}
                  >
                    実行…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {pipeline ? (
        <div className="pipelines-detail">
          <div className="pipelines-actions">
            <button type="button" onClick={backToList}>
              ← 一覧
            </button>
          </div>

          <label className="pipelines-field">
            Pipeline 名
            <div className="pipelines-name-row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button type="button" disabled={busy} onClick={() => void saveName()}>
                保存
              </button>
            </div>
          </label>

          <div className="pipelines-value-card">
            <strong>この Pipeline でできること</strong>
            <p className="pipelines-item-blurb">{pipelineOneLiner(pipeline)}</p>
            {flowPreview ? <p className="pipelines-flow-line">{flowPreview}</p> : null}
            <p className="pipelines-hint">
              前の Step の結果は、次の Step へ自動的に渡されます。どの AI Provider
              を使うかは Router が決めます（Pipeline 自体ではありません）。
            </p>
          </div>

          <div className="pipelines-section">
            <strong className="pipelines-section-title">この Pipeline の流れ</strong>
            <ol className="pipelines-steps">
              {sortedSteps.map((step, index) => {
                const sr = stepStatusMap.get(step.id)
                const isCurrent = activeRun?.currentStepId === step.id && isRunning
                const typeInfo = stepTypeLabel(step.type)
                const io = stepIoHint(step, index, sortedSteps.length)
                return (
                  <li key={step.id}>
                    <span className="pipelines-step-mark" aria-hidden>
                      {stepMarker(sr?.status, isCurrent)}
                    </span>
                    <div>
                      <strong>
                        {index + 1}. {step.name}
                      </strong>
                      <em className="pipelines-step-role">{stepRole(step)}</em>
                      <span className="pipelines-step-meta">
                        {typeInfo.title} — {typeInfo.detail}
                      </span>
                      <span className="pipelines-step-meta">
                        入力: {io.input} → 出力: {io.output}
                      </span>
                      {sr?.status ? (
                        <span className="pipelines-step-status">
                          {stepFlowLabel(sr.status, isCurrent)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="pipelines-run-prep">
            <strong>この Pipeline を実行すると</strong>
            <p className="pipelines-hint">
              {flowPreview || '各 Step'} の順番で AI が作業します。Task
              に「何をしてほしいか」を書いてから実行してください。
            </p>
          </div>

          <label className="pipelines-field">
            Task（やらせたい仕事）
            <textarea
              rows={4}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="例: example.ts に hello 関数を追加し、その実装を検証してください"
              disabled={isRunning}
            />
          </label>

          <div className="pipelines-actions">
            {isRunning ? (
              <button type="button" onClick={() => void cancelRun()}>
                実行を取消
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !workspacePath}
                onClick={() => void runPipeline()}
              >
                {canRunAgain ? 'もう一度実行' : 'この Pipeline を実行'}
              </button>
            )}
          </div>

          {activeRun ? (
            <div className="pipelines-run">
              <div className="pipelines-run-head">
                <strong>
                  {isRunning
                    ? 'Pipeline を実行しています'
                    : activeRun.status === 'completed'
                      ? 'Pipeline 完了'
                      : activeRun.status === 'cancelled'
                        ? 'Pipeline 取消'
                        : activeRun.status === 'failed'
                          ? 'Pipeline 失敗'
                          : activeRun.status}
                </strong>
                <code>Run: {activeRun.id}</code>
              </div>

              <ol className="pipelines-steps pipelines-steps-live">
                {sortedSteps.map((step, index) => {
                  const sr = stepStatusMap.get(step.id)
                  const isCurrent = activeRun.currentStepId === step.id && isRunning
                  return (
                    <li key={step.id}>
                      <span className="pipelines-step-mark" aria-hidden>
                        {stepMarker(sr?.status, isCurrent)}
                      </span>
                      <div>
                        <strong>
                          {step.name}
                          {isCurrent ? ' — 現在ここ' : ''}
                        </strong>
                        <em className="pipelines-step-role">
                          {stepRole(step)}
                          {sr?.status === 'completed' ? '（完了）' : ''}
                        </em>
                        <span className="pipelines-step-status">
                          {stepFlowLabel(sr?.status, isCurrent)}
                        </span>
                      </div>
                      {index < sortedSteps.length - 1 ? (
                        <span className="pipelines-flow-arrow" aria-hidden>
                          ↓
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ol>

              {userFacingError(activeRun) ? (
                <pre className="pipelines-fail">{userFacingError(activeRun)}</pre>
              ) : null}

              {activeRun.status === 'completed' ? (
                <div className="pipelines-outputs">
                  <p className="pipelines-hint">各 Step の役割と結果:</p>
                  {sortedSteps.map((step) => {
                    const sr = stepStatusMap.get(step.id)
                    const text = sr?.output?.text?.trim()
                    return (
                      <details key={step.id} open={step.type === 'OUTPUT'}>
                        <summary>
                          {step.name} — {stepRole(step)}
                        </summary>
                        <pre>{text || '（テキスト結果なし）'}</pre>
                      </details>
                    )
                  })}
                  <div className="pipelines-actions">
                    <button
                      type="button"
                      disabled={busy || !workspacePath}
                      onClick={() => void runPipeline()}
                    >
                      もう一度実行
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="pipelines-section">
            <strong>実行履歴</strong>
            {runs.length === 0 ? (
              <p className="pipelines-hint">
                まだ実行はありません。Task を入れて実行してみてください。
              </p>
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
