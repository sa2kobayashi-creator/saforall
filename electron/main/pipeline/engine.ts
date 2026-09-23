import { randomUUID } from 'crypto'
import {
  beginChatAbort,
  cancelChatAbort,
  endChatAbort,
  isChatAbortError
} from '../chatAbort'
import type {
  PipelineDefinition,
  PipelineEvent,
  PipelineInput,
  PipelineRun,
  StepRun
} from './types'
import { emptyRunContext, putStepOutput, resolveStepInput } from './template'
import { savePipelineRun } from './store'
import { runAiStep } from './steps/aiStep'
import { runAgentStep } from './steps/agentStep'
import { runOutputStep } from './steps/outputStep'

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

const activeRuns = new Map<string, { abortRequestId: string }>()

export function isPipelineRunActive(runId: string): boolean {
  return activeRuns.has(runId)
}

export async function cancelPipelineRun(runId: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  return cancelChatAbort(active.abortRequestId)
}

export async function executePipelineRun(params: {
  pipeline: PipelineDefinition
  input: PipelineInput
  onEvent?: (event: PipelineEvent) => void
}): Promise<PipelineRun> {
  const emit = (event: PipelineEvent): void => {
    try {
      params.onEvent?.(event)
    } catch {
      // ignore
    }
  }

  const runId = newId('prun')
  const abortRequestId = `pipeline:${runId}`
  const signal = beginChatAbort(abortRequestId)
  activeRuns.set(runId, { abortRequestId })

  const steps = [...params.pipeline.steps].sort((a, b) => a.order - b.order)
  let run: PipelineRun = {
    id: runId,
    pipelineId: params.pipeline.id,
    pipelineVersion: params.pipeline.version,
    workspacePath: params.input.workspacePath,
    status: 'running',
    currentStepId: null,
    input: params.input,
    context: emptyRunContext(params.input),
    stepRuns: [],
    abortRequestId,
    startedAt: nowIso(),
    error: null
  }
  await savePipelineRun(run)
  emit({ type: 'run_started', runId, pipelineId: params.pipeline.id })

  let previousStepId: string | null = null

  try {
    for (const step of steps) {
      if (signal.aborted) {
        run = { ...run, status: 'cancelled', completedAt: nowIso(), currentStepId: step.id }
        await savePipelineRun(run)
        emit({ type: 'run_cancelled', runId })
        return run
      }

      const stepRunId = newId('srun')
      const input = resolveStepInput({
        template: step.promptTemplate,
        ctx: run.context,
        previousStepId,
        stepId: step.id
      })

      let stepRun: StepRun = {
        id: stepRunId,
        pipelineRunId: runId,
        stepId: step.id,
        type: step.type,
        status: 'running',
        input,
        output: null,
        startedAt: nowIso(),
        usageRefs: [],
        error: null
      }
      run = {
        ...run,
        currentStepId: step.id,
        stepRuns: [...run.stepRuns, stepRun]
      }
      await savePipelineRun(run)
      emit({ type: 'step_started', runId, stepId: step.id, stepRunId })

      try {
        let usageRefs: string[] = []
        let output = runOutputStep(run.context)

        if (step.type === 'AI') {
          const result = await runAiStep({
            step,
            input,
            pipelineRunId: runId,
            stepRunId
          })
          output = result.output
          usageRefs = result.usageRefs
        } else if (step.type === 'AGENT') {
          const result = await runAgentStep({
            step,
            input,
            workspacePath: params.input.workspacePath,
            pipelineRunId: runId,
            stepRunId,
            signal,
            onEvent: emit
          })
          output = result.output
          usageRefs = result.usageRefs
        } else {
          output = runOutputStep(run.context)
        }

        if (signal.aborted) {
          stepRun = { ...stepRun, status: 'cancelled', completedAt: nowIso(), usageRefs }
          run = {
            ...run,
            status: 'cancelled',
            completedAt: nowIso(),
            stepRuns: run.stepRuns.map((s) => (s.id === stepRunId ? stepRun : s)),
            context: putStepOutput(run.context, step.id, output)
          }
          await savePipelineRun(run)
          emit({ type: 'run_cancelled', runId })
          return run
        }

        stepRun = {
          ...stepRun,
          status: 'completed',
          output,
          completedAt: nowIso(),
          usageRefs
        }
        run = {
          ...run,
          context: putStepOutput(run.context, step.id, output),
          stepRuns: run.stepRuns.map((s) => (s.id === stepRunId ? stepRun : s))
        }
        await savePipelineRun(run)
        emit({ type: 'step_completed', runId, stepId: step.id, stepRunId, output })
        previousStepId = step.id
      } catch (error) {
        if (isChatAbortError(error) || signal.aborted) {
          stepRun = {
            ...stepRun,
            status: 'cancelled',
            completedAt: nowIso(),
            error: { code: 'CANCELLED', message: 'cancelled' }
          }
          run = {
            ...run,
            status: 'cancelled',
            completedAt: nowIso(),
            stepRuns: run.stepRuns.map((s) => (s.id === stepRunId ? stepRun : s))
          }
          await savePipelineRun(run)
          emit({ type: 'run_cancelled', runId })
          return run
        }
        const message = error instanceof Error ? error.message : String(error)
        const stepError = { code: 'STEP_FAILED', message }
        stepRun = {
          ...stepRun,
          status: 'failed',
          completedAt: nowIso(),
          error: stepError
        }
        run = {
          ...run,
          status: 'failed',
          completedAt: nowIso(),
          error: { code: 'PIPELINE_FAILED', message, stepId: step.id },
          stepRuns: run.stepRuns.map((s) => (s.id === stepRunId ? stepRun : s))
        }
        await savePipelineRun(run)
        emit({ type: 'step_failed', runId, stepId: step.id, stepRunId, error: stepError })
        emit({ type: 'run_failed', runId, error: run.error! })
        return run
      }
    }

    run = {
      ...run,
      status: 'completed',
      completedAt: nowIso(),
      currentStepId: null
    }
    await savePipelineRun(run)
    emit({ type: 'run_completed', runId })
    return run
  } finally {
    activeRuns.delete(runId)
    endChatAbort(abortRequestId)
  }
}
