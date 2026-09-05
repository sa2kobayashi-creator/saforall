import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
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

/** Safe id fragment for filesystem. */
export function sanitizeExtensionId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * Scaffold a workspace tool manifest from an Open VSX browse hit.
 * Does NOT run VSIX — wraps as a terminal helper (+ optional npx hint).
 */
export function buildExtensionScaffoldManifest(item: {
  id: string
  name: string
  description?: string
  namespace?: string
  packageName?: string
  url?: string
}): WorkspaceExtension {
  const id = `openvsx.${sanitizeExtensionId(item.id || item.name)}`
  const pkg =
    item.namespace && item.packageName
      ? `${item.namespace}.${item.packageName}`
      : item.id
  const runHint =
    item.namespace && item.packageName
      ? `npx --yes ${item.namespace === 'vscode' ? `@${item.packageName}` : `${item.namespace}/${item.packageName}`} --help`
      : `echo "Open ${item.url || item.name} — VS Code 拡張は VSIX 未対応。必要なら commands.run を編集してください"`

  return {
    id,
    name: item.name || id,
    description:
      (item.description || '').slice(0, 400) ||
      `Open VSX scaffold for ${pkg}. Edit .saforall/extensions to customize.`,
    permissions: ['terminal.run', 'network'],
    commands: [
      {
        id: 'help',
        title: 'Show help / probe',
        run: runHint,
        permissions: ['terminal.run', 'network']
      },
      {
        id: 'open-page',
        title: 'Print marketplace URL',
        run: `echo ${JSON.stringify(item.url || `https://open-vsx.org/extension/${pkg}`)}`,
        permissions: ['terminal.run']
      }
    ]
  }
}

export async function scaffoldExtensionFromMarketplace(
  workspaceRoot: string,
  item: {
    id: string
    name: string
    description?: string
    namespace?: string
    packageName?: string
    url?: string
  }
): Promise<{ ok: true; extension: WorkspaceExtension; path: string } | { ok: false; error: string }> {
  try {
    const manifest = buildExtensionScaffoldManifest(item)
    const dir = resolveWorkspacePath(workspaceRoot, '.saforall/extensions')
    await mkdir(dir, { recursive: true })
    const fileName = `${sanitizeExtensionId(manifest.id)}.json`
    const absolute = join(dir, fileName)
    await writeFile(absolute, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
    return {
      ok: true,
      extension: manifest,
      path: `.saforall/extensions/${fileName}`
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
