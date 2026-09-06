import { join } from 'path'
import {
  ensureLocalDbReady,
  getLocalDbRoot,
  isoNow,
  nextLocalId,
  readJsonFile,
  writeJsonFile
} from './localDb'

export type LocalWorkspace = {
  id: number
  path: string
  name: string
  last_opened_at: string
}

type WorkspacesFile = { workspaces: LocalWorkspace[] }

function workspacesPath(): string {
  return join(getLocalDbRoot(), 'workspaces.json')
}

function counterPath(): string {
  return join(getLocalDbRoot(), 'workspace-counter.json')
}

export async function upsertWorkspaceByPath(
  path: string,
  name?: string
): Promise<LocalWorkspace> {
  await ensureLocalDbReady()
  const file = await readJsonFile<WorkspacesFile>(workspacesPath(), { workspaces: [] })
  const normalized = path.replace(/[\\/]+$/, '')
  const existing = file.workspaces.find((row) => row.path === normalized)
  const now = isoNow()
  if (existing) {
    existing.last_opened_at = now
    if (name && name.trim()) existing.name = name.trim()
    await writeJsonFile(workspacesPath(), file)
    return existing
  }
  const row: LocalWorkspace = {
    id: await nextLocalId(counterPath()),
    path: normalized,
    name: (name && name.trim()) || normalized.split(/[/\\]/).pop() || normalized,
    last_opened_at: now
  }
  file.workspaces.unshift(row)
  await writeJsonFile(workspacesPath(), file)
  return row
}
