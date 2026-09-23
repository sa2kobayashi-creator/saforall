import {
  createFlagshipPipeline,
  FLAGSHIP_PIPELINE_ID
} from './seed'
import { resolveTemplate, emptyRunContext, putStepOutput } from './template'
import { ensurePipelineStoreReady, getPipeline, savePipeline } from './store'

/** Offline self-check: seed + template data-passing (no Provider calls). */
export async function pipelineSelfCheck(): Promise<{
  ok: boolean
  checks: Record<string, { status: 'PASS' | 'FAIL'; detail?: string }>
}> {
  const checks: Record<string, { status: 'PASS' | 'FAIL'; detail?: string }> = {}
  try {
    await ensurePipelineStoreReady()
    let pipeline = await getPipeline(FLAGSHIP_PIPELINE_ID)
    if (!pipeline) {
      pipeline = await savePipeline(createFlagshipPipeline())
    }
    checks.seed = {
      status: pipeline?.id === FLAGSHIP_PIPELINE_ID ? 'PASS' : 'FAIL',
      detail: pipeline?.id
    }
    checks.steps = {
      status:
        pipeline.steps.map((s) => s.id).join('>') === 'spec>implement>verify>output'
          ? 'PASS'
          : 'FAIL',
      detail: pipeline.steps.map((s) => `${s.id}:${s.type}`).join(',')
    }

    let ctx = emptyRunContext({
      task: 'add hello()',
      workspacePath: 'D:/tmp/ws'
    })
    const specTpl = pipeline.steps.find((s) => s.id === 'spec')?.promptTemplate || ''
    const specPrompt = resolveTemplate(specTpl, ctx)
    checks.specTemplate = {
      status: specPrompt.includes('add hello()') ? 'PASS' : 'FAIL'
    }
    ctx = putStepOutput(ctx, 'spec', { text: 'SPEC: implement hello in src/example.ts' })
    const implTpl = pipeline.steps.find((s) => s.id === 'implement')?.promptTemplate || ''
    const implPrompt = resolveTemplate(implTpl, ctx)
    checks.dataPassing = {
      status: implPrompt.includes('SPEC: implement hello') ? 'PASS' : 'FAIL',
      detail: implPrompt.slice(0, 120)
    }
  } catch (error) {
    checks.error = {
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
  const ok = Object.values(checks).every((c) => c.status === 'PASS')
  return { ok, checks }
}
