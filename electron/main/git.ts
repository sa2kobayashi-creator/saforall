import { spawn } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'

export type GitFileStatus = {
  path: string
  index: string
  worktree: string
  status: string
  staged: boolean
  unstaged: boolean
}

export type GitStatusResult = {
  ok: boolean
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  raw?: string
  error?: string
}

export type GitCloneResult = {
  ok: boolean
  targetPath?: string
  error?: string
}

export type GitOpResult = {
  ok: boolean
  stdout?: string
  error?: string
}

function runGit(
  args: string[],
  cwd: string,
  timeoutMs = 60_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: process.env
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 1, stdout, stderr: stderr || 'git timed out' })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function mapStatus(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return '未追跡'
  if (index === 'A') return '追加'
  if (index === 'M' || worktree === 'M') return '変更'
  if (index === 'D' || worktree === 'D') return '削除'
  if (index === 'R') return 'リネーム'
  if (index === 'U' || worktree === 'U') return '競合'
  return `${index}${worktree}`.trim() || '変更'
}

function isStaged(index: string): boolean {
  return index !== ' ' && index !== '?'
}

function isUnstaged(index: string, worktree: string): boolean {
  if (index === '?' && worktree === '?') return true
  return worktree !== ' '
}

async function ensureRepo(cwd: string): Promise<GitOpResult | null> {
  try {
    await access(cwd)
  } catch {
    return { ok: false, error: 'ワークスペースがありません' }
  }
  const rev = await runGit(['rev-parse', '--is-inside-work-tree'], cwd, 10_000)
  if (rev.code !== 0 || !rev.stdout.includes('true')) {
    return { ok: false, error: 'このフォルダは Git リポジトリではありません' }
  }
  return null
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  try {
    await access(cwd)
  } catch {
    return {
      ok: false,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      error: 'ワークスペースがありません'
    }
  }

  const rev = await runGit(['rev-parse', '--is-inside-work-tree'], cwd, 10_000)
  if (rev.code !== 0 || !rev.stdout.includes('true')) {
    return {
      ok: true,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      error: 'このフォルダは Git リポジトリではありません'
    }
  }

  const branchResult = await runGit(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    cwd,
    10_000
  )
  const upstreamResult = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    cwd,
    10_000
  )
  const statusResult = await runGit(
    ['status', '--porcelain=v1', '-uall'],
    cwd,
    20_000
  )

  let ahead = 0
  let behind = 0
  if (upstreamResult.code === 0) {
    const counts = await runGit(
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      cwd,
      10_000
    )
    if (counts.code === 0) {
      const parts = counts.stdout.trim().split(/\s+/)
      ahead = Number(parts[0] ?? 0) || 0
      behind = Number(parts[1] ?? 0) || 0
    }
  }

  if (statusResult.code !== 0) {
    return {
      ok: false,
      isRepo: true,
      branch: branchResult.stdout.trim() || null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      error: statusResult.stderr || 'git status に失敗しました'
    }
  }

  const files: GitFileStatus[] = statusResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => {
      const index = line[0] ?? ' '
      const worktree = line[1] ?? ' '
      let path = line.slice(3).trim()
      if (path.includes(' -> ')) {
        path = path.split(' -> ').pop() ?? path
      }
      return {
        path,
        index,
        worktree,
        status: mapStatus(index, worktree),
        staged: isStaged(index),
        unstaged: isUnstaged(index, worktree)
      }
    })

  return {
    ok: true,
    isRepo: true,
    branch: branchResult.stdout.trim() || null,
    upstream:
      upstreamResult.code === 0 ? upstreamResult.stdout.trim() || null : null,
    ahead,
    behind,
    files,
    raw: statusResult.stdout
  }
}

export async function cloneRepository(
  url: string,
  parentDir: string,
  folderName?: string
): Promise<GitCloneResult> {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('git@')) {
    return { ok: false, error: 'GitHub / Bitbucket などの git URL を指定してください' }
  }

  let name = folderName?.trim()
  if (!name) {
    const base = trimmed.replace(/\.git$/i, '').split('/').pop() ?? 'repo'
    name = base.replace(/[^\w.-]+/g, '-')
  }

  const targetPath = join(parentDir, name)
  try {
    await access(targetPath)
    return { ok: false, error: `既に存在します: ${targetPath}` }
  } catch {
    // ok if missing
  }

  const result = await runGit(['clone', trimmed, name], parentDir, 300_000)
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || 'git clone に失敗しました'
    }
  }

  return { ok: true, targetPath }
}

export async function initRepository(cwd: string): Promise<GitOpResult> {
  const result = await runGit(['init'], cwd, 20_000)
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || 'git init に失敗しました' }
  }
  return { ok: true }
}

export async function stagePaths(
  cwd: string,
  paths: string[]
): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  if (paths.length === 0) return { ok: false, error: 'ステージするファイルがありません' }
  const result = await runGit(['add', '--', ...paths], cwd, 60_000)
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || 'git add に失敗しました' }
  }
  return { ok: true, stdout: result.stdout }
}

export async function stageAll(cwd: string): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  const result = await runGit(['add', '-A'], cwd, 60_000)
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || 'git add -A に失敗しました' }
  }
  return { ok: true, stdout: result.stdout }
}

export async function unstagePaths(
  cwd: string,
  paths: string[]
): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  if (paths.length === 0) return { ok: false, error: 'アンステージするファイルがありません' }
  const result = await runGit(['restore', '--staged', '--', ...paths], cwd, 60_000)
  if (result.code !== 0) {
    // older git fallback
    const fallback = await runGit(['reset', 'HEAD', '--', ...paths], cwd, 60_000)
    if (fallback.code !== 0) {
      return {
        ok: false,
        error: result.stderr || fallback.stderr || 'unstage に失敗しました'
      }
    }
  }
  return { ok: true }
}

export async function commitChanges(
  cwd: string,
  message: string
): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  const msg = message.trim()
  if (!msg) return { ok: false, error: 'コミットメッセージが空です' }
  const result = await runGit(['commit', '-m', msg], cwd, 60_000)
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || 'git commit に失敗しました'
    }
  }
  return { ok: true, stdout: result.stdout }
}

export async function pushRepository(cwd: string): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  const result = await runGit(['push'], cwd, 180_000)
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || 'git push に失敗しました'
    }
  }
  return { ok: true, stdout: result.stdout || result.stderr }
}

export async function pullRepository(cwd: string): Promise<GitOpResult> {
  const guard = await ensureRepo(cwd)
  if (guard) return guard
  const result = await runGit(['pull', '--ff-only'], cwd, 180_000)
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || 'git pull に失敗しました'
    }
  }
  return { ok: true, stdout: result.stdout || result.stderr }
}
