import type { ChatStreamEvent } from '../../api'
import { runToolAgent } from '../../toolAgent'
import type { PipelineEvent, PipelineStepDefinition, StepInput, StepOutput } from '../types'
import { resolveEngineRuntime } from '../resolveEngine'

export async function runAgentStep(params: {
  step: PipelineStepDefinition
  input: StepInput
  workspacePath: string
  pipelineRunId: string
  stepRunId: string
  signal: AbortSignal
  onEvent: (event: PipelineEvent) => void
}): Promise<{ output: StepOutput; usageRefs: string[] }> {
  const routing = params.step.routing || { mode: 'auto' as const }
  const runtime = resolveEngineRuntime(
    routing.mode === 'fixed' ? routing.provider : undefined,
    routing.mode
  )
  const model = routing.model || runtime.model
  const changedFiles: string[] = []
  let finalText = ''
  let deltaBuf = ''

  const onStreamEvent = (event: ChatStreamEvent): void => {
    if (event.type === 'delta' && typeof event.text === 'string') {
      deltaBuf += event.text
      params.onEvent({
        type: 'agent_delta',
        runId: params.pipelineRunId,
        stepId: params.step.id,
        text: event.text
      })
    }
    if (event.type === 'edit_proposal' && typeof event.path === 'string') {
      changedFiles.push(event.path)
      params.onEvent({
        type: 'edit_proposal',
        runId: params.pipelineRunId,
        stepId: params.step.id,
        path: event.path,
        content: typeof event.content === 'string' ? event.content : ''
      })
    }
  }

  await runToolAgent({
    workspacePath: params.workspacePath,
    baseUrl: runtime.baseUrl,
    model,
    extraHeaders: runtime.extraHeaders,
    messages: [
      {
        role: 'system',
        content:
          params.step.id === 'verify'
            ? 'You are the Verify step of a coding pipeline. Validate and fix using tools. Summarize in Japanese.'
            : 'You are the Implement step of a coding pipeline. Use tools to edit code. Do not stop at explanations.'
      },
      { role: 'user', content: params.input.text }
    ],
    engine: runtime.engine,
    taskType: params.step.id === 'verify' ? 'verify' : 'edit',
    sessionId: 0,
    signal: params.signal,
    onEvent: onStreamEvent,
    complete: async (content) => {
      finalText = content || deltaBuf
      return {
        assistant_message: {
          role: 'assistant',
          content: finalText
        }
      }
    }
  })

  if (!finalText) finalText = deltaBuf
  return {
    output: {
      text: finalText || `(${params.step.name} completed)`,
      artifacts: changedFiles.map((path) => ({ kind: 'file' as const, path })),
      structured: {
        changedFiles: Array.from(new Set(changedFiles)),
        acceptedEditCount: changedFiles.length
      },
      provider: runtime.provider,
      model
    },
    usageRefs: []
  }
}
