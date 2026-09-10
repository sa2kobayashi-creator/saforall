import { readdir, readFile, stat, writeFile, mkdir, unlink } from 'fs/promises'
import { spawn } from 'child_process'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { searchIndexedContent } from './workspaceIndex'
import { readTextFile } from './textEncoding'
import { recordSearchFeedback } from './feedbackStore'

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
  const { text } = await readTextFile(absolute)
  const max = 80_000
  if (text.length > max) {
    return text.slice(0, max) + '\n\n... (truncated)'
  }
  return text
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

export async function toolSearch(
  workspaceRoot: string,
  query: string,
  globHint?: string,
  anchorPaths?: string[],
  source = 'toolSearch'
): Promise<string> {
  const needle = query.trim()
  if (needle.length < 2) {
    return 'query は 2 文字以上にしてください'
  }

  const finish = (resultText: string): string => {
    recordSearchFeedback({ source, query: needle, resultText })
    return resultText
  }

  try {
    const indexed = await searchIndexedContent(workspaceRoot, needle, globHint, 40, anchorPaths)
    if (indexed.length > 0) return finish(indexed.join('\n'))
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
  return finish(hits.length > 0 ? hits.join('\n') : '一致なし')
}

export type ReplaceInFilesResult = {
  ok: boolean
  dryRun: boolean
  query: string
  replacement: string
  filesChanged: number
  replacements: number
  files: Array<{ path: string; count: number }>
  error?: string
}

/** Workspace-wide literal replace (case-insensitive search, preserves match casing via exact substring). */
export async function replaceInWorkspace(
  workspaceRoot: string,
  query: string,
  replacement: string,
  options?: { dryRun?: boolean; maxFiles?: number; caseSensitive?: boolean }
): Promise<ReplaceInFilesResult> {
  const needle = query
  if (needle.length < 2) {
    return {
      ok: false,
      dryRun: Boolean(options?.dryRun),
      query,
      replacement,
      filesChanged: 0,
      replacements: 0,
      files: [],
      error: '検索語は 2 文字以上にしてください'
    }
  }
  const dryRun = Boolean(options?.dryRun)
  const maxFiles = options?.maxFiles ?? 80
  const caseSensitive = Boolean(options?.caseSensitive)
  const root = resolve(workspaceRoot)
  const files: Array<{ path: string; count: number }> = []
  let replacements = 0
  let filesChanged = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (filesChanged >= maxFiles || depth > 8) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (filesChanged >= maxFiles) break
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      const st = await stat(full).catch(() => null)
      if (!st || !st.isFile() || st.size > 400_000) continue
      let text = ''
      try {
        text = await readFile(full, 'utf-8')
      } catch {
        continue
      }
      if (caseSensitive) {
        if (!text.includes(needle)) continue
      } else if (!text.toLowerCase().includes(needle.toLowerCase())) {
        continue
      }

      let count = 0
      let next = text
      if (caseSensitive) {
        const parts = text.split(needle)
        count = parts.length - 1
        if (count <= 0) continue
        next = parts.join(replacement)
      } else {
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(escaped, 'gi')
        next = text.replace(re, () => {
          count += 1
          return replacement
        })
      }
      if (count <= 0) continue
      const rel = relative(root, full).split(/[/\\]/).join('/')
      files.push({ path: rel, count })
      replacements += count
      filesChanged += 1
      if (!dryRun) {
        await writeFile(full, next, 'utf-8')
      }
    }
  }

  await walk(root, 0)
  return {
    ok: true,
    dryRun,
    query,
    replacement,
    filesChanged,
    replacements,
    files
  }
}

export async function loadProjectRules(workspaceRoot: string): Promise<string | null> {
  const maxTotal = 12_000
  const parts: string[] = []
  let used = 0

  const readBounded = async (absolute: string, budget: number): Promise<string | null> => {
    try {
      const content = await readFile(absolute, 'utf-8')
      if (!content.trim()) return null
      return content.length > budget ? `${content.slice(0, budget)}\n\n... (truncated)` : content
    } catch {
      return null
    }
  }

  const candidates = [
    '.saforall/rules.md',
    'SAFORALL.md',
    'AGENTS.md',
    '.cursorrules',
    '.cursor/rules.md'
  ]
  for (const rel of candidates) {
    if (used >= maxTotal) break
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, rel)
      const content = await readBounded(absolute, maxTotal - used)
      if (!content) continue
      parts.push(`### ${rel}\n${content}`)
      used += content.length
    } catch {
      // try next
    }
  }

  try {
    const rulesDir = resolveWorkspacePath(workspaceRoot, '.cursor/rules')
    const entries = await readdir(rulesDir, { withFileTypes: true })
    const files = entries
      .filter((row) => row.isFile() && /\.(mdc|md|txt)$/i.test(row.name))
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b))
    for (const name of files) {
      if (used >= maxTotal) break
      const content = await readBounded(join(rulesDir, name), Math.min(6_000, maxTotal - used))
      if (!content) continue
      parts.push(`### .cursor/rules/${name}\n${content}`)
      used += content.length
    }
  } catch {
    // no .cursor/rules
  }

  try {
    const rulesDir = resolveWorkspacePath(workspaceRoot, '.saforall/rules')
    const entries = await readdir(rulesDir, { withFileTypes: true })
    const files = entries
      .filter((row) => row.isFile() && /\.(mdc|md|txt)$/i.test(row.name))
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b))
    for (const name of files) {
      if (used >= maxTotal) break
      const content = await readBounded(join(rulesDir, name), Math.min(6_000, maxTotal - used))
      if (!content) continue
      parts.push(`### .saforall/rules/${name}\n${content}`)
      used += content.length
    }
  } catch {
    // no .saforall/rules dir
  }

  for (const rel of ['.saforall/memories.md', '.saforall/memories']) {
    if (used >= maxTotal) break
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, rel)
      const content = await readBounded(absolute, Math.min(4_000, maxTotal - used))
      if (!content) continue
      parts.push(`### memories\n${content}`)
      used += content.length
      break
    } catch {
      // try next
    }
  }

  if (parts.length === 0) return null
  const merged = parts.join('\n\n')
  return merged.length > maxTotal ? `${merged.slice(0, maxTotal)}\n\n... (truncated)` : merged
}

export type ProjectRuleFile = {
  path: string
  kind: 'rules' | 'agents' | 'memory'
  bytes: number
}

export async function listProjectRuleFiles(workspaceRoot: string): Promise<ProjectRuleFile[]> {
  const out: ProjectRuleFile[] = []
  const tryStat = async (rel: string, kind: ProjectRuleFile['kind']): Promise<void> => {
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, rel)
      const info = await stat(absolute)
      if (info.isFile()) out.push({ path: rel, kind, bytes: info.size })
    } catch {
      // missing
    }
  }
  await tryStat('.saforall/rules.md', 'rules')
  await tryStat('.saforall/rules', 'rules')
  await tryStat('AGENTS.md', 'agents')
  await tryStat('SAFORALL.md', 'agents')
  await tryStat('.cursorrules', 'rules')
  await tryStat('.cursor/rules.md', 'rules')
  await tryStat('.saforall/memories.md', 'memory')
  await tryStat('.saforall/memories', 'memory')
  for (const dirRel of ['.cursor/rules', '.saforall/rules']) {
    try {
      const rulesDir = resolveWorkspacePath(workspaceRoot, dirRel)
      const entries = await readdir(rulesDir, { withFileTypes: true })
      for (const row of entries) {
        if (!row.isFile() || !/\.(mdc|md|txt)$/i.test(row.name)) continue
        const rel = `${dirRel}/${row.name}`
        const info = await stat(join(rulesDir, row.name))
        out.push({ path: rel, kind: 'rules', bytes: info.size })
      }
    } catch {
      // no dir
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readProjectMemory(workspaceRoot: string): Promise<string> {
  for (const rel of ['.saforall/memories.md', '.saforall/memories']) {
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, rel)
      const { text } = await readTextFile(absolute)
      return text
    } catch {
      // try next
    }
  }
  return ''
}

export async function appendProjectMemory(
  workspaceRoot: string,
  note: string
): Promise<{ path: string; bytes: number }> {
  const trimmed = note.trim()
  if (!trimmed) throw new Error('memory が空です')
  const rel = '.saforall/memories.md'
  const absolute = resolveWorkspacePath(workspaceRoot, rel)
  await mkdir(dirname(absolute), { recursive: true })
  let existing = ''
  try {
    const { text } = await readTextFile(absolute)
    existing = text
  } catch {
    existing = ''
  }
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const block = `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}## ${stamp}\n\n${trimmed}\n`
  await writeFile(absolute, block, 'utf-8')
  return { path: rel, bytes: Buffer.byteLength(block, 'utf-8') }
}

export async function saveProjectMemory(
  workspaceRoot: string,
  content: string
): Promise<{ path: string; bytes: number }> {
  const rel = '.saforall/memories.md'
  const absolute = resolveWorkspacePath(workspaceRoot, rel)
  await mkdir(dirname(absolute), { recursive: true })
  const text = content.endsWith('\n') ? content : `${content}\n`
  await writeFile(absolute, text, 'utf-8')
  return { path: rel, bytes: Buffer.byteLength(text, 'utf-8') }
}

export async function readProjectRuleFile(
  workspaceRoot: string,
  relativePath: string
): Promise<string> {
  const allowedPrefixes = ['.saforall/', '.cursor/', 'AGENTS.md', 'SAFORALL.md', '.cursorrules']
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (
    !allowedPrefixes.some(
      (prefix) => rel === prefix || rel.startsWith(prefix) || prefix.endsWith(rel)
    ) &&
    rel !== 'AGENTS.md' &&
    rel !== 'SAFORALL.md' &&
    rel !== '.cursorrules'
  ) {
    throw new Error('許可されていない rules パスです')
  }
  const absolute = resolveWorkspacePath(workspaceRoot, rel)
  const { text } = await readTextFile(absolute)
  return text.length > 100_000 ? `${text.slice(0, 100_000)}\n\n... (truncated)` : text
}

function parseMarkdownFrontmatter(content: string): {
  meta: Record<string, string>
  body: string
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!row) continue
    meta[row[1]] = row[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: match[2] }
}

export type ProjectSkill = {
  id: string
  name: string
  description: string
  path: string
  bytes: number
}

async function collectSkillsFromDir(
  workspaceRoot: string,
  dirRel: string,
  out: ProjectSkill[]
): Promise<void> {
  try {
    const absoluteDir = resolveWorkspacePath(workspaceRoot, dirRel)
    const entries = await readdir(absoluteDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillRel = `${dirRel}/${entry.name}/SKILL.md`.replace(/\\/g, '/')
      try {
        const absolute = resolveWorkspacePath(workspaceRoot, skillRel)
        const info = await stat(absolute)
        if (!info.isFile()) continue
        const raw = await readFile(absolute, 'utf-8')
        const { meta } = parseMarkdownFrontmatter(raw)
        const id = (meta.name || entry.name).trim() || entry.name
        out.push({
          id,
          name: id,
          description: (meta.description || '').trim() || `${id} skill`,
          path: skillRel,
          bytes: info.size
        })
      } catch {
        // skip broken skill
      }
    }
  } catch {
    // dir missing
  }
}

/** Cursor-compatible project skills: .saforall/skills/<id>/SKILL.md and .cursor/skills/<id>/SKILL.md */
export async function listProjectSkills(workspaceRoot: string): Promise<ProjectSkill[]> {
  const out: ProjectSkill[] = []
  await collectSkillsFromDir(workspaceRoot, '.saforall/skills', out)
  await collectSkillsFromDir(workspaceRoot, '.cursor/skills', out)
  const seen = new Set<string>()
  return out
    .filter((row) => {
      const key = row.id.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function readProjectSkill(
  workspaceRoot: string,
  idOrPath: string
): Promise<{ id: string; name: string; description: string; path: string; content: string }> {
  const needle = idOrPath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!needle) throw new Error('skill id が空です')
  const listed = await listProjectSkills(workspaceRoot)
  const hit =
    listed.find((row) => row.id.toLowerCase() === needle.toLowerCase()) ||
    listed.find((row) => row.path.replace(/\\/g, '/') === needle) ||
    listed.find((row) => row.path.replace(/\\/g, '/').endsWith(`/${needle}/SKILL.md`))
  if (!hit) throw new Error(`skill が見つかりません: ${needle}`)
  const absolute = resolveWorkspacePath(workspaceRoot, hit.path)
  const raw = await readFile(absolute, 'utf-8')
  const { meta, body } = parseMarkdownFrontmatter(raw)
  const content = body.trim() || raw
  return {
    id: hit.id,
    name: (meta.name || hit.name).trim() || hit.name,
    description: (meta.description || hit.description).trim() || hit.description,
    path: hit.path,
    content: content.length > 80_000 ? `${content.slice(0, 80_000)}\n\n... (truncated)` : content
  }
}

/** Compact catalog for Agent system prompt / @skills. */
export async function formatSkillsCatalog(workspaceRoot: string): Promise<string | null> {
  const skills = await listProjectSkills(workspaceRoot)
  if (skills.length === 0) return null
  const lines = skills.slice(0, 40).map((row) => {
    const desc = row.description.replace(/\s+/g, ' ').slice(0, 160)
    return `- ${row.id}: ${desc} (${row.path})`
  })
  return [
    '利用可能な Skills（必要なら read_skill で本文を読む）:',
    ...lines
  ].join('\n')
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

const DANGEROUS_SHELL =
  /\b(format\s+[a-z]:|mkfs\b|diskpart\b|shutdown(\s|\/)|reboot\b|rm\s+-rf\s+\/(?=\s|$)|del\s+\/[sq]\b|rd\s+\/s\b|reg\s+delete\b|Remove-Item\b.*-Recurse\b|Invoke-WebRequest\b.*\|\s*iex\b|curl\b.*\|\s*sh\b)/i

export function assertSafeShellCommand(command: string): void {
  const trimmed = command.trim()
  if (!trimmed) throw new Error('command が空です')
  if (trimmed.length > 2000) throw new Error('command が長すぎます')
  if (DANGEROUS_SHELL.test(trimmed)) {
    throw new Error('危険な可能性があるコマンドはブロックしました')
  }
}

/**
 * Dev servers / watchers never exit — useless (and confusing) for Agent verify.
 * Detect common start/dev/serve patterns so we can fail fast with a clear message.
 */
export function isLongRunningShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return false
  const segments = normalized.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean)
  return segments.some((part) => {
    if (/^(npm|pnpm|yarn|bun)(\s+run)?\s+(start|dev|serve|watch)(\s|$)/.test(part)) return true
    if (/^(npm|pnpm|yarn|bun)\s+start(\s|$)/.test(part)) return true
    if (/\bvite\s+build\b/.test(part) || /\bnext\s+build\b/.test(part)) return false
    if (/\b(next\s+dev|nuxt\s+dev|remix\s+dev|astro\s+dev|ng\s+serve)\b/.test(part)) return true
    if (/(^|\s)vite(\s|$)/.test(part)) return true
    if (/\b(webpack-dev-server|nodemon)\b/.test(part)) return true
    if (/^(npx|pnpm\s+dlx|yarn\s+dlx)\s+(serve|http-server|vite|next)(\s|$)/.test(part)) return true
    if (/^(python|py|python3)\s+(-m\s+)?(http\.server|uvicorn)\b/.test(part)) return true
    if (/^(flask\s+run|php\s+-s)\b/.test(part)) return true
    return false
  })
}

export function explainLongRunningShellCommand(
  command: string,
  preferredVerify?: string | null
): string {
  const cmd = command.trim() || '(empty)'
  const hint = preferredVerify?.trim()
    ? `代わりに「${preferredVerify.trim()}」など、終わって結果が返るコマンドを使ってください。`
    : '代わりに typecheck / test / lint など、終わって結果が返るコマンドを使ってください。'
  return (
    `「${cmd}」はアプリを起動したまま終了しないコマンドです。` +
    `検証では使えません（ずっと待ち続けてタイムアウトになります）。${hint}`
  )
}

export function truncateShellOutput(text: string, max = 12_000): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.65)
  const tail = max - head - 40
  return `${text.slice(0, head)}\n\n... (truncated ${text.length - max} chars) ...\n\n${text.slice(-tail)}`
}

/** Prefer the tail (where real errors usually appear) for failure excerpts. */
export function excerptShellFailure(stderr: string, stdout: string, max = 5_000): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  if (!combined) return '(no output)'
  if (combined.length <= max) return combined
  const head = Math.floor(max * 0.25)
  const tail = max - head - 48
  return `${combined.slice(0, head)}\n\n... (truncated ${combined.length - max} chars; showing head+tail) ...\n\n${combined.slice(-tail)}`
}

export type VerifySuggestion = {
  primary: string
  fallbacks: string[]
}

export async function suggestVerifyCommands(
  workspaceRoot: string
): Promise<VerifySuggestion | null> {
  try {
    const raw = await readFile(resolveWorkspacePath(workspaceRoot, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const fallbacks: string[] = []
    let primary: string | null = null

    // Prefer fast typecheck first. Avoid chaining `npm test` when it already embeds typecheck
    // (common monorepo pattern) — that makes run_shell look hung for minutes.
    if (scripts.typecheck) {
      primary = 'npm run typecheck'
      const testScript = String(scripts.test || '')
      if (scripts.test && !/\btypecheck\b/.test(testScript)) {
        fallbacks.push('npm test')
      }
    } else if (scripts.test) {
      primary = 'npm test'
    }
    if (scripts.lint && primary !== 'npm run lint') fallbacks.push('npm run lint')
    // build is often very slow — keep it last and only if nothing else is available
    if (
      scripts.build &&
      !fallbacks.includes('npm run build') &&
      primary !== 'npm run build' &&
      fallbacks.length === 0
    ) {
      fallbacks.push('npm run build')
    }
    if (primary) return { primary, fallbacks: fallbacks.slice(0, 2) }
  } catch {
    // ignore
  }
  try {
    await stat(resolveWorkspacePath(workspaceRoot, 'pyproject.toml'))
    return { primary: 'python -m pytest -q', fallbacks: [] }
  } catch {
    // ignore
  }
  try {
    await stat(resolveWorkspacePath(workspaceRoot, 'Cargo.toml'))
    return { primary: 'cargo test', fallbacks: ['cargo check'] }
  } catch {
    // ignore
  }
  return null
}

export async function suggestVerifyCommand(workspaceRoot: string): Promise<string | null> {
  const suggestion = await suggestVerifyCommands(workspaceRoot)
  return suggestion?.primary ?? null
}

export function nextVerifyFallback(
  failedCommand: string,
  hint: VerifySuggestion | null | undefined,
  tried: string[]
): string | null {
  if (!hint) return null
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
  const chain = [hint.primary, ...hint.fallbacks].map(norm).filter(Boolean)
  if (chain.length === 0) return null
  const triedSet = new Set(tried.map(norm))
  const failed = norm(failedCommand)
  triedSet.add(failed)
  const isVerifyRelated = chain.some(
    (cmd) => failed === cmd || failed.startsWith(cmd) || cmd.startsWith(failed)
  )
  if (!isVerifyRelated) return null
  for (const cmd of chain) {
    if (!triedSet.has(cmd)) return cmd
  }
  return null
}

export type ShellRunResult = {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  cwd: string
  command: string
}

export async function toolRunShell(
  workspaceRoot: string,
  command: string,
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal | null }
): Promise<ShellRunResult> {
  assertSafeShellCommand(command)
  const cwdRel = options?.cwd?.trim() || '.'
  const cwd = resolveWorkspacePath(workspaceRoot, cwdRel)
  const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 45_000, 5_000), 120_000)
  const signal = options?.signal

  if (signal?.aborted) {
    const err = new Error('Chat cancelled by user')
    err.name = 'AbortError'
    throw err
  }

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false

    const killChild = (): void => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } else {
          child.kill('SIGTERM')
          setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              // ignore
            }
          }, 800)
        }
      } catch {
        try {
          child.kill()
        } catch {
          // ignore
        }
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChild()
    }, timeoutMs)

    const onAbort = (): void => {
      aborted = true
      killChild()
      // Some Windows shells never emit close after taskkill — fail closed.
      setTimeout(() => {
        if (!settled) finish(null)
      }, 2000)
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
      if (stdout.length > 200_000) stdout = truncateShellOutput(stdout, 180_000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
      if (stderr.length > 200_000) stderr = truncateShellOutput(stderr, 180_000)
    })

    const cleanup = (): void => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      cleanup()
      if (aborted || signal?.aborted) {
        const err = new Error('Chat cancelled by user')
        err.name = 'AbortError'
        rejectPromise(err)
        return
      }
      resolvePromise({
        ok: !timedOut && exitCode === 0,
        exitCode,
        stdout: truncateShellOutput(stdout),
        stderr: truncateShellOutput(stderr),
        timedOut,
        cwd: relative(resolve(workspaceRoot), cwd) || '.',
        command
      })
    }

    child.on('error', (error) => {
      if (aborted || signal?.aborted) {
        finish(null)
        return
      }
      stderr += (stderr ? '\n' : '') + error.message
      finish(1)
    })
    child.on('close', (code) => finish(timedOut ? null : code))
  })
}

/** Temporarily write pending edits, run work, then restore originals. */
export async function withMaterializedEdits<T>(
  workspaceRoot: string,
  pendingEdits: Map<string, string>,
  work: () => Promise<T>
): Promise<T> {
  if (pendingEdits.size === 0) return work()

  const backups = new Map<string, string | null>()
  for (const [relPath, content] of Array.from(pendingEdits.entries())) {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath)
    try {
      backups.set(relPath, await readFile(absolute, 'utf-8'))
    } catch {
      backups.set(relPath, null)
    }
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf-8')
  }

  try {
    return await work()
  } finally {
    for (const [relPath, original] of Array.from(backups.entries())) {
      const absolute = resolveWorkspacePath(workspaceRoot, relPath)
      try {
        if (original === null) await unlink(absolute)
        else await writeFile(absolute, original, 'utf-8')
      } catch {
        // best-effort restore
      }
    }
  }
}

