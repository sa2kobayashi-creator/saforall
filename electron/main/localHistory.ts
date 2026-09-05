import { mkdir, readdir, readFile, writeFile, unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, join, relative, resolve } from 'path'
import { resolveWorkspacePath } from './workspaceTools'

export type LocalHistoryEntry = {
  id: string
  path: string
  savedAt: number
  bytes: number
  label?: string
}

function historyRoot(workspaceRoot: string): string {
  return resolveWorkspacePath(workspaceRoot, '.saforall/history')
}

/** Pure helper for tests: build history file key. */
export function localHistoryFileKey(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16)
}

function toRel(workspaceRoot: string, relativeOrAbsolutePath: string): string {
  const absolute = resolveWorkspacePath(workspaceRoot, relativeOrAbsolutePath)
  return relative(resolve(workspaceRoot), absolute).split(/[/\\]/).join('/')
}

export async function recordLocalHistory(
  workspaceRoot: string,
  relativeOrAbsolutePath: string,
  content: string,
  label?: string
): Promise<LocalHistoryEntry> {
  const rel = toRel(workspaceRoot, relativeOrAbsolutePath)
  const dir = join(historyRoot(workspaceRoot), localHistoryFileKey(rel))
  await mkdir(dir, { recursive: true })
  const savedAt = Date.now()
  const id = `${savedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const meta: LocalHistoryEntry = {
    id,
    path: rel,
    savedAt,
    bytes: Buffer.byteLength(content, 'utf-8'),
    label
  }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta), 'utf-8')
  await writeFile(join(dir, `${id}.txt`), content, 'utf-8')
  await pruneHistoryDir(dir, 20)
  return meta
}

async function pruneHistoryDir(dir: string, keep: number): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const metas = entries.filter((name) => name.endsWith('.json')).sort()
  while (metas.length > keep) {
    const oldest = metas.shift()
    if (!oldest) break
    const id = oldest.replace(/\.json$/, '')
    await unlink(join(dir, oldest)).catch(() => undefined)
    await unlink(join(dir, `${id}.txt`)).catch(() => undefined)
  }
}

export async function listLocalHistory(
  workspaceRoot: string,
  relativeOrAbsolutePath?: string
): Promise<LocalHistoryEntry[]> {
  const rootDir = historyRoot(workspaceRoot)
  let dirs: string[] = []
  try {
    if (relativeOrAbsolutePath) {
      const rel = toRel(workspaceRoot, relativeOrAbsolutePath)
      dirs = [join(rootDir, localHistoryFileKey(rel))]
    } else {
      const rows = await readdir(rootDir, { withFileTypes: true })
      dirs = rows.filter((row) => row.isDirectory()).map((row) => join(rootDir, row.name))
    }
  } catch {
    return []
  }

  const out: LocalHistoryEntry[] = []
  for (const dir of dirs.slice(0, 40)) {
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, name), 'utf-8')
        const parsed = JSON.parse(raw) as LocalHistoryEntry
        if (parsed?.id && parsed.path) out.push(parsed)
      } catch {
        // skip
      }
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt).slice(0, 100)
}

export async function readLocalHistoryContent(
  workspaceRoot: string,
  entryId: string,
  relativePath: string
): Promise<string> {
  const dir = join(historyRoot(workspaceRoot), localHistoryFileKey(relativePath.replace(/\\/g, '/')))
  return readFile(join(dir, `${entryId}.txt`), 'utf-8')
}

export async function restoreLocalHistory(
  workspaceRoot: string,
  entryId: string,
  relativePath: string
): Promise<{ path: string; bytes: number }> {
  const content = await readLocalHistoryContent(workspaceRoot, entryId, relativePath)
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath)
  await mkdir(dirname(absolute), { recursive: true })
  try {
    const current = await readFile(absolute, 'utf-8')
    await recordLocalHistory(workspaceRoot, relativePath, current, 'before-restore')
  } catch {
    // new file
  }
  await writeFile(absolute, content, 'utf-8')
  return { path: relativePath, bytes: Buffer.byteLength(content, 'utf-8') }
}
