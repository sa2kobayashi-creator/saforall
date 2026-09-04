import { readdir, readFile, stat } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { searchIndexedContent } from './workspaceIndex'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  'vendor',
  '.next',
  'coverage'
])

export function resolveWorkspacePath(workspaceRoot: string, targetPath: string): string {
  const root = resolve(workspaceRoot)
  const absolute = resolve(isAbsolute(targetPath) ? targetPath : join(root, targetPath))
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('ワークスペース外のパスにはアクセスできません')
  }
  return absolute
}

export async function toolReadFile(workspaceRoot: string, pathArg: string): Promise<string> {
  const absolute = resolveWorkspacePath(workspaceRoot, pathArg)
  const content = await readFile(absolute, 'utf-8')
  const max = 80_000
  if (content.length > max) {
    return content.slice(0, max) + '\n\n... (truncated)'
  }
  return content
}

export async function toolListDir(workspaceRoot: string, pathArg = '.'): Promise<string> {
  const absolute = resolveWorkspacePath(workspaceRoot, pathArg || '.')
  const entries = await readdir(absolute, { withFileTypes: true })
  const lines = entries
    .filter((entry) => !entry.name.startsWith('.'))
    .slice(0, 200)
    .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}\t${entry.name}`)
  return lines.join('\n') || '(empty)'
}

export async function toolSearch(workspaceRoot: string, query: string, globHint?: string): Promise<string> {
  const needle = query.trim()
  if (needle.length < 2) {
    return 'query は 2 文字以上にしてください'
  }

  try {
    const indexed = await searchIndexedContent(workspaceRoot, needle, globHint, 40)
    if (indexed.length > 0) return indexed.join('\n')
  } catch {
    // fall through to walk
  }

  const root = resolve(workspaceRoot)
  const hits: string[] = []
  const maxHits = 40

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= maxHits || depth > 8) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= maxHits) break
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (globHint) {
        const lower = entry.name.toLowerCase()
        const hint = globHint.replace(/^\*\./, '.').toLowerCase()
        if (hint.startsWith('.') && !lower.endsWith(hint)) continue
      }
      const st = await stat(full).catch(() => null)
      if (!st || !st.isFile() || st.size > 400_000) continue
      let text = ''
      try {
        text = await readFile(full, 'utf-8')
      } catch {
        continue
      }
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        if (hits.length >= maxHits) break
        if (lines[i].toLowerCase().includes(needle.toLowerCase())) {
          const rel = relative(root, full)
          hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
        }
      }
    }
  }

  await walk(root, 0)
  return hits.length > 0 ? hits.join('\n') : '一致なし'
}

export async function loadProjectRules(workspaceRoot: string): Promise<string | null> {
  const candidates = [
    '.saforall/rules',
    '.saforall/rules.md',
    'SAFORALL.md',
    'AGENTS.md',
    '.cursorrules'
  ]
  for (const rel of candidates) {
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, rel)
      const content = await readFile(absolute, 'utf-8')
      if (content.trim()) {
        const max = 12_000
        return content.length > max ? content.slice(0, max) + '\n\n... (truncated)' : content
      }
    } catch {
      // try next
    }
  }
  return null
}

export async function searchFilesByName(
  workspaceRoot: string,
  query: string,
  limit = 40
): Promise<string[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const root = resolve(workspaceRoot)
  const hits: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= limit || depth > 10) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= limit) break
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (entry.name.toLowerCase().includes(needle)) {
        hits.push(relative(root, full).split(sep).join('/'))
      }
    }
  }

  await walk(root, 0)
  return hits
}
