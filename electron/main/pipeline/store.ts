import { join } from 'path'
import { mkdir } from 'fs/promises'
import { ensureLocalDbReady, getLocalDbRoot, readJsonFile, writeJsonFile } from '../localDb'
import type { PipelineDefinition, PipelineRun } from './types'
import { createFlagshipPipeline } from './seed'

type PipelinesFile = {
  version: 1
  pipelines: PipelineDefinition[]
}

type RunsIndex = {
  version: 1
  runs: Array<{ id: string; pipelineId: string; status: string; updatedAt: string }>
}

function pipelinesPath(): string {
  return join(getLocalDbRoot(), 'pipelines.json')
}

function runsIndexPath(): string {
  return join(getLocalDbRoot(), 'pipeline-runs-index.json')
}

function runFilePath(runId: string): string {
  return join(getLocalDbRoot(), 'pipeline-runs', `${runId}.json`)
}

export async function ensurePipelineStoreReady(): Promise<void> {
  await ensureLocalDbReady()
  await mkdir(join(getLocalDbRoot(), 'pipeline-runs'), { recursive: true })
  const file = await readJsonFile<PipelinesFile>(pipelinesPath(), { version: 1, pipelines: [] })
  if (!Array.isArray(file.pipelines) || file.pipelines.length === 0) {
    const seed = createFlagshipPipeline()
    await writeJsonFile(pipelinesPath(), { version: 1, pipelines: [seed] } satisfies PipelinesFile)
  }
}

export async function listPipelines(): Promise<PipelineDefinition[]> {
  await ensurePipelineStoreReady()
  const file = await readJsonFile<PipelinesFile>(pipelinesPath(), { version: 1, pipelines: [] })
  return Array.isArray(file.pipelines) ? file.pipelines : []
}

export async function getPipeline(id: string): Promise<PipelineDefinition | null> {
  const list = await listPipelines()
  return list.find((p) => p.id === id) || null
}

export async function savePipeline(pipeline: PipelineDefinition): Promise<PipelineDefinition> {
  await ensurePipelineStoreReady()
  const file = await readJsonFile<PipelinesFile>(pipelinesPath(), { version: 1, pipelines: [] })
  const pipelines = Array.isArray(file.pipelines) ? [...file.pipelines] : []
  const idx = pipelines.findIndex((p) => p.id === pipeline.id)
  const next = { ...pipeline, updatedAt: new Date().toISOString() }
  if (idx >= 0) pipelines[idx] = next
  else pipelines.push(next)
  await writeJsonFile(pipelinesPath(), { version: 1, pipelines } satisfies PipelinesFile)
  return next
}

export async function savePipelineRun(run: PipelineRun): Promise<void> {
  await ensurePipelineStoreReady()
  await writeJsonFile(runFilePath(run.id), run)
  const index = await readJsonFile<RunsIndex>(runsIndexPath(), { version: 1, runs: [] })
  const rows = Array.isArray(index.runs) ? [...index.runs] : []
  const summary = {
    id: run.id,
    pipelineId: run.pipelineId,
    status: run.status,
    updatedAt: new Date().toISOString()
  }
  const i = rows.findIndex((r) => r.id === run.id)
  if (i >= 0) rows[i] = summary
  else rows.unshift(summary)
  await writeJsonFile(runsIndexPath(), {
    version: 1,
    runs: rows.slice(0, 200)
  } satisfies RunsIndex)
}

export async function getPipelineRun(runId: string): Promise<PipelineRun | null> {
  await ensurePipelineStoreReady()
  return readJsonFile<PipelineRun | null>(runFilePath(runId), null)
}

export async function listPipelineRunSummaries(): Promise<RunsIndex['runs']> {
  await ensurePipelineStoreReady()
  const index = await readJsonFile<RunsIndex>(runsIndexPath(), { version: 1, runs: [] })
  return Array.isArray(index.runs) ? index.runs : []
}
