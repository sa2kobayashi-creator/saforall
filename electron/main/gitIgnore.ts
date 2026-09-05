import { readFile } from 'fs/promises'
import { join, relative, sep } from 'path'

const BUILTIN_DIR_IGNORES = [
  'node_modules/',
  '.git/',
  'dist/',
  'out/',
  'release/',
  'vendor/',
  '.next/',
  'coverage/'
]

type Rule = {
  negated: boolean
  directoryOnly: boolean
  pattern: string
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function globToRegExp(pattern: string): RegExp {
  let source = ''
  let i = 0
  const p = pattern.replace(/^\.\//, '')
  while (i < p.length) {
    const ch = p[i]
    if (ch === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        source += '(?:.*/)?'
        i += 3
      } else {
        source += '.*'
        i += 2
      }
      continue
    }
    if (ch === '*') {
      source += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      source += '[^/]'
      i += 1
      continue
    }
    if ('\\.()+^$[]{}|'.includes(ch)) {
      source += `\\${ch}`
      i += 1
      continue
    }
    source += ch
    i += 1
  }
  return new RegExp(`^${source}$`)
}

function parseGitIgnore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let negated = false
    let body = line
    if (body.startsWith('!')) {
      negated = true
      body = body.slice(1)
    }
    let directoryOnly = false
    if (body.endsWith('/')) {
      directoryOnly = true
      body = body.slice(0, -1)
    }
    if (body.startsWith('/')) body = body.slice(1)
    rules.push({ negated, directoryOnly, pattern: body })
  }
  return rules
}

function matchRule(relPosix: string, isDirectory: boolean, rule: Rule): boolean {
  const target = rule.directoryOnly
    ? isDirectory
      ? relPosix.replace(/\/$/, '')
      : null
    : relPosix
  if (target === null) {
    // directory-only rule also matches files under that directory
    const prefix = rule.pattern.endsWith('/**') ? rule.pattern : `${rule.pattern}/`
    if (relPosix === rule.pattern || relPosix.startsWith(prefix) || relPosix.startsWith(`${rule.pattern}/`)) {
      return true
    }
    const re = globToRegExp(rule.pattern)
    if (re.test(relPosix.split('/')[0] ?? '')) return false
  }
  const candidates = [relPosix]
  // basename match when pattern has no slash
  if (!rule.pattern.includes('/')) {
    const base = relPosix.split('/').pop() ?? relPosix
    candidates.push(base)
  }
  const re = globToRegExp(rule.pattern)
  for (const c of candidates) {
    if (re.test(c)) return true
    if (rule.directoryOnly && (c === rule.pattern || c.startsWith(`${rule.pattern}/`))) return true
  }
  // prefix directory match for patterns like node_modules/
  if (relPosix === rule.pattern || relPosix.startsWith(`${rule.pattern}/`)) return true
  return false
}

export type IgnoreMatcher = {
  ignores: (absolutePath: string, isDirectory: boolean) => boolean
}

export async function createWorkspaceIgnoreMatcher(workspaceRoot: string): Promise<IgnoreMatcher> {
  const root = workspaceRoot.replace(/[\\/]+$/, '')
  const rules: Rule[] = parseGitIgnore(BUILTIN_DIR_IGNORES.join('\n'))
  try {
    const text = await readFile(join(root, '.gitignore'), 'utf-8')
    rules.push(...parseGitIgnore(text))
  } catch {
    // no .gitignore
  }

  return {
    ignores(absolutePath: string, isDirectory: boolean) {
      const rel = toPosix(relative(root, absolutePath))
      if (!rel || rel.startsWith('..')) return false
      let ignored = false
      for (const rule of rules) {
        if (matchRule(rel, isDirectory, rule)) {
          ignored = !rule.negated
        }
      }
      return ignored
    }
  }
}

/** Resolve workspace root for ignore: prefer path containing .gitignore or .git */
export async function resolveIgnoreRoot(startDir: string, hintRoot?: string | null): Promise<string> {
  if (hintRoot) return hintRoot.replace(/[\\/]+$/, '')
  const { access } = await import('fs/promises')
  let current = startDir
  for (let i = 0; i < 12; i++) {
    try {
      await access(join(current, '.git'))
      return current
    } catch {
      // continue
    }
    try {
      await access(join(current, '.gitignore'))
      return current
    } catch {
      // continue
    }
    const parent = current.includes(sep)
      ? current.split(/[/\\]/).slice(0, -1).join(sep) || current
      : current
    if (parent === current) break
    current = parent
  }
  return startDir
}
