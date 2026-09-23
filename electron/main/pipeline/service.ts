import { BrowserWindow } from 'electron'
import type {
  PipelineDefinition,
  PipelineInput,
  PipelineRun,
  StartPipelineRunParams
} from './types'
import {
  ensurePipelineStoreReady,
  getPipeline,
  getPipelineRun,
  listPipelineRunSummaries,
  listPipelines,
  savePipeline
} from './store'
import { createFlagshipPipeline, FLAGSHIP_PIPELINE_ID } from './seed'
import { cancelPipelineRun, executePipelineRun, isPipelineRunActive } from './engine'

function broadcast(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('pipeline:event', event)
  }
}

export async function pipelineList(): Promise<Awaited<ReturnType<typeof listPipelines>>> {
  await ensurePipelineStoreReady()
  return listPipelines()
}

export async function pipelineGet(id: string) {
  return getPipeline(id)
}

export async function pipelineEnsureFlagship() {
  await ensurePipelineStoreReady()
  const existing = await getPipeline(FLAGSHIP_PIPELINE_ID)
  if (existing) return existing
  return savePipeline(createFlagshipPipeline())
}

/** Persist a pipeline definition (create or update). Reuses pipelines.json. */
export async function pipelineSave(pipeline: PipelineDefinition): Promise<PipelineDefinition> {
  if (!pipeline?.id?.trim()) throw new Error('pipeline.id is required')
  if (!pipeline?.name?.trim()) throw new Error('pipeline.name is required')
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
    throw new Error('pipeline.steps is required')
  }
  return savePipeline(pipeline)
}

/**
 * Create a user Pipeline from the Flagship template (new id; does not overwrite flagship).
 */
export async function pipelineCreate(params?: {
  name?: string
}): Promise<PipelineDefinition> {
  const template = createFlagshipPipeline()
  const now = new Date().toISOString()
  const name = (params?.name || '').trim() || template.name
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return savePipeline({
    id,
    name,
    description: template.description,
    version: 1,
    createdAt: now,
    updatedAt: now,
    steps: template.steps.map((step) => ({
      ...step,
      routing: step.routing ? { ...step.routing } : undefined
    }))
  })
}

export async function pipelineStart(params: StartPipelineRunParams): Promise<PipelineRun> {
  await ensurePipelineStoreReady()
  let pipeline = await getPipeline(params.pipelineId)
  if (!pipeline && params.pipelineId === FLAGSHIP_PIPELINE_ID) {
    pipeline = await pipelineEnsureFlagship()
  }
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${params.pipelineId}`)
  }
  if (!params.input?.task?.trim()) {
    throw new Error('pipeline input.task is required')
  }
  if (!params.input?.workspacePath?.trim()) {
    throw new Error('pipeline input.workspacePath is required')
  }

  return executePipelineRun({
    pipeline,
    input: params.input,
    onEvent: (event) => broadcast(event)
  })
}

export async function pipelineCancel(runId: string): Promise<{ ok: boolean; active: boolean }> {
  const active = isPipelineRunActive(runId)
  const ok = await cancelPipelineRun(runId)
  return { ok, active }
}

export async function pipelineGetRun(runId: string) {
  return getPipelineRun(runId)
}

export async function pipelineListRuns() {
  return listPipelineRunSummaries()
}

export async function pipelineRunFlagship(input: PipelineInput): Promise<PipelineRun> {
  await pipelineEnsureFlagship()
  return pipelineStart({
    pipelineId: FLAGSHIP_PIPELINE_ID,
    input
  })
}
