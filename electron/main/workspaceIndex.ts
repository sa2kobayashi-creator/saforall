import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'

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

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|rs|go|java|kt|php|rb|vue|svelte|yml|yaml|toml|txt)$/i

export type CodeSymbol = {
  name: string
  kind: 'function' | 'class' | 'type' | 'const' | 'export'
  path: string
  line: number
}

export type WorkspaceIndex = {
  root: string
  builtAt: number
  files: string[]
  symbols: CodeSymbol[]
  /** relative path -> file text (capped) */
  texts: Map<string, string>
}

let active: WorkspaceIndex | null = null
let building: Promise<WorkspaceIndex> | null = null

export function extractSymbols(relPath: string, content: string): CodeSymbol[] {
  const out: CodeSymbol[] = []
  const lines = content.split(/\r?\n/)
  const patterns: Array<{ kind: CodeSymbol['kind']; re: RegExp }> = [
    { kind: 'class', re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/ },
    {
      kind: 'function',
      re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_][\w]*)/
    },
    {
      kind: 'const',
      re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=/
    },
    { kind: 'type', re: /^\s*(?:export\s+)?(?:type|interface)\s+([A-Za-z_][\w]*)/ },
    {
      kind: 'export',
      re: /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_][\w]*)/
    }
  ]
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    for (const pattern of patterns) {
      const match = line.match(pattern.re)
      if (match?.[1]) {
        out.push({ name: match[1], kind: pattern.kind, path: relPath, line: i + 1 })
        break
      }
    }
  }
  return out
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= 4000 || depth > 12) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= 4000) break
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (!TEXT_EXT.test(entry.name)) continue
      files.push(full)
    }
  }
  await walk(root, 0)
  return files
}

export async function buildWorkspaceIndex(workspaceRoot: string): Promise<WorkspaceIndex> {
  const root = resolve(workspaceRoot)
  const absFiles = await walkFiles(root)
  const texts = new Map<string, string>()
  const symbols: CodeSymbol[] = []
  const files: string[] = []

  for (const full of absFiles) {
    const rel = relative(root, full).split(sep).join('/')
    files.push(rel)
    const st = await stat(full).catch(() => null)
    if (!st || !st.isFile() || st.size > 500_000) continue
    let text = ''
    try {
      text = await readFile(full, 'utf-8')
    } catch {
      continue
    }
    if (text.length > 200_000) text = text.slice(0, 200_000)
    texts.set(rel, text)
    symbols.push(...extractSymbols(rel, text).slice(0, 80))
  }

  return { root, builtAt: Date.now(), files, symbols, texts }
}

export async function ensureWorkspaceIndex(
  workspaceRoot: string,
  force = false
): Promise<WorkspaceIndex> {
  const root = resolve(workspaceRoot)
  if (!force && active && active.root === root) return active
  if (building) return building
  building = buildWorkspaceIndex(root)
    .then((index) => {
      active = index
      building = null
      return index
    })
    .catch((error) => {
      building = null
      throw error
    })
  return building
}

export function invalidateWorkspaceIndex(workspaceRoot?: string): void {
  if (!active) return
  if (!workspaceRoot || resolve(workspaceRoot) === active.root) {
    active = null
  }
}

export async function searchIndexedContent(
  workspaceRoot: string,
  query: string,
  globHint?: string,
  limit = 40
): Promise<string[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const index = await ensureWorkspaceIndex(workspaceRoot)
  const hits: string[] = []
  for (const [rel, text] of Array.from(index.texts.entries())) {
    if (hits.length >= limit) break
    if (globHint) {
      const hint = globHint.replace(/^\*\./, '.').toLowerCase()
      if (hint.startsWith('.') && !rel.toLowerCase().endsWith(hint)) continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= limit) break
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      }
    }
  }
  return hits
}

export async function searchIndexedSymbols(
  workspaceRoot: string,
  query: string,
  limit = 30
): Promise<CodeSymbol[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const index = await ensureWorkspaceIndex(workspaceRoot)
  return index.symbols
    .filter((row) => row.name.toLowerCase().includes(needle))
    .slice(0, limit)
}

export async function getIndexSummary(workspaceRoot: string): Promise<{
  files: number
  symbols: number
  builtAt: number
}> {
  const index = await ensureWorkspaceIndex(workspaceRoot)
  return {
    files: index.files.length,
    symbols: index.symbols.length,
    builtAt: index.builtAt
  }
}
