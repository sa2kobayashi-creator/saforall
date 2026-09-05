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
  /** relative path -> imported relative paths (resolved best-effort) */
  imports: Map<string, string[]>
}

let active: WorkspaceIndex | null = null
let building: Promise<WorkspaceIndex> | null = null

/** Extract relative import/require targets from source text (no node_modules). */
export function extractImportSpecifiers(content: string): string[] {
  const specs = new Set<string>()
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g
  ]
  for (const re of patterns) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(content)) !== null) {
      const spec = match[1]?.trim()
      if (!spec || !spec.startsWith('.')) continue
      specs.add(spec)
    }
  }
  return Array.from(specs)
}

export function resolveImportToIndexedPath(
  fromPath: string,
  specifier: string,
  knownFiles: Set<string>
): string | null {
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const joined = [fromDir, specifier].filter(Boolean).join('/')
  const parts = joined.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  const base = out.join('/')
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`
  ]
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

export function getImportNeighborhood(
  imports: Map<string, string[]>,
  seeds: string[],
  depth = 1
): Set<string> {
  const out = new Set(seeds.map((row) => row.replace(/\\/g, '/')))
  let frontier = Array.from(out)
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = []
    for (const path of frontier) {
      for (const dep of imports.get(path) ?? []) {
        if (!out.has(dep)) {
          out.add(dep)
          next.push(dep)
        }
      }
      for (const [importer, deps] of Array.from(imports.entries())) {
        if (deps.includes(path) && !out.has(importer)) {
          out.add(importer)
          next.push(importer)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return out
}

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
  const imports = new Map<string, string[]>()

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

  const known = new Set(files)
  for (const [rel, text] of Array.from(texts.entries())) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(rel)) continue
    const resolved: string[] = []
    for (const spec of extractImportSpecifiers(text).slice(0, 40)) {
      const target = resolveImportToIndexedPath(rel, spec, known)
      if (target && target !== rel) resolved.push(target)
    }
    if (resolved.length > 0) imports.set(rel, Array.from(new Set(resolved)))
  }

  return { root, builtAt: Date.now(), files, symbols, texts, imports }
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

export type RankedHit = {
  path: string
  line: number
  preview: string
  score: number
}

/** Higher score = more relevant for @codebase / Search. */
export function scoreContentHit(params: {
  path: string
  lineText: string
  needle: string
  symbolNames?: string[]
  /** Open / seed files — boosted. */
  anchorPaths?: Set<string>
  /** 1-hop import neighborhood of anchors. */
  neighborPaths?: Set<string>
}): number {
  const needle = params.needle.toLowerCase()
  const path = params.path.toLowerCase()
  const line = params.lineText.toLowerCase()
  let score = 0
  if (!line.includes(needle)) return -1
  score += 10
  if (path.includes(needle)) score += 40
  const base = path.split('/').pop() ?? ''
  if (base.includes(needle)) score += 30
  if (line.trim().startsWith(needle) || new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(line)) {
    score += 20
  }
  if (/^src\//.test(path) || /^electron\//.test(path) || /^server\//.test(path)) score += 8
  if (/test|spec|mock|fixture/.test(path)) score -= 5
  if (params.symbolNames?.some((name) => name.toLowerCase() === needle)) score += 50
  if (params.symbolNames?.some((name) => name.toLowerCase().includes(needle))) score += 15
  if (/^(export|function|class|const|type|interface)\b/.test(line.trim())) score += 12
  const rel = params.path.replace(/\\/g, '/')
  if (params.anchorPaths?.has(rel) || params.anchorPaths?.has(path)) score += 35
  if (params.neighborPaths?.has(rel) || params.neighborPaths?.has(path)) score += 25
  if (params.anchorPaths && params.anchorPaths.size > 0) {
    for (const anchor of Array.from(params.anchorPaths)) {
      const aDir = anchor.includes('/') ? anchor.slice(0, anchor.lastIndexOf('/')) : ''
      const pDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      if (aDir && aDir === pDir) {
        score += 10
        break
      }
    }
  }
  return score
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatRankedHit(hit: RankedHit): string {
  return `${hit.path}:${hit.line}: ${hit.preview}`
}

export async function searchIndexedContent(
  workspaceRoot: string,
  query: string,
  globHint?: string,
  limit = 40,
  anchorPaths?: string[]
): Promise<string[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const index = await ensureWorkspaceIndex(workspaceRoot)
  const symbolNames = index.symbols.map((row) => row.name)
  const anchors = new Set(
    (anchorPaths ?? []).map((row) => row.replace(/\\/g, '/').replace(/^\.\//, ''))
  )
  const neighbors =
    anchors.size > 0 ? getImportNeighborhood(index.imports, Array.from(anchors), 1) : new Set<string>()
  const ranked: RankedHit[] = []

  for (const [rel, text] of Array.from(index.texts.entries())) {
    if (globHint) {
      const hint = globHint.replace(/^\*\./, '.').toLowerCase()
      if (hint.startsWith('.') && !rel.toLowerCase().endsWith(hint)) continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const score = scoreContentHit({
        path: rel,
        lineText: lines[i],
        needle,
        symbolNames,
        anchorPaths: anchors,
        neighborPaths: neighbors
      })
      if (score < 0) continue
      ranked.push({
        path: rel,
        line: i + 1,
        preview: lines[i].trim().slice(0, 200),
        score
      })
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
  return ranked.slice(0, limit).map(formatRankedHit)
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
