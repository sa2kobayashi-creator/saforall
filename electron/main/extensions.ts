import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { resolveWorkspacePath } from './workspaceTools'

export type ExtensionPermission =
  | 'terminal.run'
  | 'terminal.run.dangerous'
  | 'fs.read'
  | 'fs.write'
  | 'network'

export type ExtensionCommand = {
  id: string
  title: string
  run: string
  permissions?: ExtensionPermission[]
}

export type WorkspaceExtension = {
  id: string
  name: string
  description?: string
  permissions?: ExtensionPermission[]
  commands: ExtensionCommand[]
}

const KNOWN: ExtensionPermission[] = [
  'terminal.run',
  'terminal.run.dangerous',
  'fs.read',
  'fs.write',
  'network'
]

function normalizePermissions(raw: unknown): ExtensionPermission[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ExtensionPermission[] = []
  for (const row of raw) {
    if (typeof row === 'string' && (KNOWN as string[]).includes(row)) {
      out.push(row as ExtensionPermission)
    }
  }
  return out.length > 0 ? out : undefined
}

export async function loadWorkspaceExtensions(
  workspaceRoot: string
): Promise<WorkspaceExtension[]> {
  const dir = resolveWorkspacePath(workspaceRoot, '.saforall/extensions')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: WorkspaceExtension[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      const json = JSON.parse(raw) as Partial<WorkspaceExtension>
      if (!json.id || !json.name || !Array.isArray(json.commands)) continue
      const commands = json.commands
        .filter(
          (row): row is ExtensionCommand =>
            !!row &&
            typeof row.id === 'string' &&
            typeof row.title === 'string' &&
            typeof row.run === 'string'
        )
        .map((row) => ({
          ...row,
          permissions: normalizePermissions(row.permissions)
        }))
        .slice(0, 40)
      if (commands.length === 0) continue
      out.push({
        id: json.id,
        name: json.name,
        description: typeof json.description === 'string' ? json.description : undefined,
        permissions: normalizePermissions(json.permissions),
        commands
      })
    } catch {
      // skip invalid extension manifests
    }
  }
  return out
}
