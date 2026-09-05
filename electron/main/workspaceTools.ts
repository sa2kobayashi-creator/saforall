import { readdir, readFile, stat, writeFile, mkdir, unlink } from 'fs/promises'
import { spawn } from 'child_process'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { searchIndexedContent } from './workspaceIndex'
import { readTextFile } from './textEncoding'

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
    '.saforall/rules',
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

export function truncateShellOutput(text: string, max = 12_000): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.65)
  const tail = max - head - 40
  return `${text.slice(0, head)}\n\n... (truncated ${text.length - max} chars) ...\n\n${text.slice(-tail)}`
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
  options?: { cwd?: string; timeoutMs?: number }
): Promise<ShellRunResult> {
  assertSafeShellCommand(command)
  const cwdRel = options?.cwd?.trim() || '.'
  const cwd = resolveWorkspacePath(workspaceRoot, cwdRel)
  const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 60_000, 5_000), 180_000)

  return await new Promise((resolvePromise) => {
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
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
      if (stdout.length > 200_000) stdout = truncateShellOutput(stdout, 180_000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
      if (stderr.length > 200_000) stderr = truncateShellOutput(stderr, 180_000)
    })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
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

export async function suggestVerifyCommand(workspaceRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(resolveWorkspacePath(workspaceRoot, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    if (scripts.test) return 'npm test'
    if (scripts.typecheck) return 'npm run typecheck'
    if (scripts.lint) return 'npm run lint'
    if (scripts.build) return 'npm run build'
  } catch {
    // ignore
  }
  try {
    await stat(resolveWorkspacePath(workspaceRoot, 'pyproject.toml'))
    return 'python -m pytest -q'
  } catch {
    // ignore
  }
  try {
    await stat(resolveWorkspacePath(workspaceRoot, 'Cargo.toml'))
    return 'cargo test'
  } catch {
    // ignore
  }
  return null
}
