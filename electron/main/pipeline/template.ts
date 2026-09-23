import type { PipelineInput, RunContext, StepInput, StepOutput } from './types'

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

function readPath(ctx: RunContext, path: string): string {
  const parts = path.split('.')
  if (parts[0] === 'pipeline' && parts[1] === 'input') {
    const key = parts[2]
    if (key === 'task') return ctx.pipelineInput.task || ''
    if (key === 'workspacePath') return ctx.pipelineInput.workspacePath || ''
    if (key === 'notes') return ctx.pipelineInput.notes || ''
    if (key === 'targetPaths') return (ctx.pipelineInput.targetPaths || []).join(', ')
    return ''
  }
  if (parts[0] === 'steps' && parts.length >= 4 && parts[2] === 'output') {
    const stepId = parts[1]
    const out = ctx.steps[stepId]?.output
    if (!out) return ''
    if (parts[3] === 'text') return out.text || ''
    if (parts[3] === 'structured' && parts[4] === 'changedFiles') {
      return (out.structured?.changedFiles || []).join('\n')
    }
    if (parts[3] === 'provider') return out.provider || ''
    if (parts[3] === 'model') return out.model || ''
  }
  return ''
}

export function resolveTemplate(template: string, ctx: RunContext): string {
  return template.replace(TEMPLATE_RE, (_m, path: string) => readPath(ctx, String(path)))
}

export function defaultStepPrompt(
  stepId: string,
  ctx: RunContext,
  previousStepId: string | null
): string {
  const task = ctx.pipelineInput.task
  const prev = previousStepId ? ctx.steps[previousStepId]?.output?.text || '' : ''
  if (prev) {
    return `Task:\n${task}\n\nPrevious step (${previousStepId}) output:\n${prev}`
  }
  return `Task:\n${task}`
}

export function resolveStepInput(params: {
  template: string | undefined
  ctx: RunContext
  previousStepId: string | null
  stepId: string
}): StepInput {
  const text = params.template
    ? resolveTemplate(params.template, params.ctx)
    : defaultStepPrompt(params.stepId, params.ctx, params.previousStepId)
  return {
    text,
    fromStepId: params.previousStepId || undefined
  }
}

export function emptyRunContext(pipelineInput: PipelineInput): RunContext {
  return { pipelineInput, steps: {} }
}

export function putStepOutput(ctx: RunContext, stepId: string, output: StepOutput): RunContext {
  return {
    ...ctx,
    steps: {
      ...ctx.steps,
      [stepId]: { output }
    }
  }
}
