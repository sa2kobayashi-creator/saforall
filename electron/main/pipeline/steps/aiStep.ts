import { executeAi } from '../../ai/router'
import type { PipelineStepDefinition, StepInput, StepOutput } from '../types'
import { resolveEngineRuntime } from '../resolveEngine'

export async function runAiStep(params: {
  step: PipelineStepDefinition
  input: StepInput
  pipelineRunId: string
  stepRunId: string
}): Promise<{ output: StepOutput; usageRefs: string[] }> {
  const routing = params.step.routing || { mode: 'auto' as const }
  const runtime = resolveEngineRuntime(
    routing.mode === 'fixed' ? routing.provider : undefined,
    routing.mode
  )
  const model = routing.model || runtime.model
  const provider =
    routing.mode === 'fixed' && routing.provider ? routing.provider : 'auto'

  const response = await executeAi({
    provider: provider as 'auto' | 'openai' | 'claude' | 'gemini' | 'grok' | 'deepseek',
    routingMode: routing.mode === 'fixed' ? 'manual' : 'auto',
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are the Spec step of a coding pipeline. Reply in Japanese with a concise, actionable implementation spec.'
      },
      { role: 'user', content: params.input.text }
    ],
    metadata: {
      pipelineRunId: params.pipelineRunId,
      stepRunId: params.stepRunId,
      stepId: params.step.id
    }
  })

  return {
    output: {
      text: response.content || '',
      provider: response.provider,
      model: response.model
    },
    usageRefs: response.requestId ? [response.requestId] : []
  }
}
