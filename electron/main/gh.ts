import { spawn } from 'child_process'
import { access } from 'fs/promises'

export type GhPrCreateInput = {
  title: string
  body?: string
  base?: string
  draft?: boolean
}

export type GhPrCreateResult = {
  ok: boolean
  url?: string
  stdout?: string
  error?: string
}

export type GhAuthStatusResult = {
  ok: boolean
  loggedIn: boolean
  account?: string
  host?: string
  stdout?: string
  error?: string
}

export function buildPrCreateArgs(input: GhPrCreateInput): string[] | { error: string } {
  const title = input.title.trim()
  if (!title) return { error: 'PR タイトルが必要です' }

  const args = ['pr', 'create', '--title', title]
  const body = (input.body ?? '').trim()
  if (body) {
    args.push('--body', body)
  } else {
    args.push('--body', '')
  }
  const base = (input.base ?? '').trim()
  if (base) args.push('--base', base)
  if (input.draft) args.push('--draft')
  return args
}

export function extractPrUrl(stdout: string, stderr = ''): string | null {
  const text = `${stdout}\n${stderr}`
  const match = text.match(/https?:\/\/[^\s]+\/pull\/\d+/i)
  return match ? match[0].replace(/[)\].,]+$/, '') : null
}

/** Best-effort parse of `gh auth status` output. */
export function parseAuthStatus(stdout: string, stderr = ''): {
  loggedIn: boolean
  account?: string
  host?: string
} {
  const text = `${stdout}\n${stderr}`
  const loggedIn = /Logged in to /i.test(text) && !/not logged in/i.test(text)
  const hostMatch = text.match(/Logged in to\s+(\S+)/i)
  const accountMatch =
    text.match(/account\s+(\S+)/i) ||
    text.match(/as\s+(\S+)/i) ||
    text.match(/✓\s+(\S+)/)
  return {
    loggedIn,
    host: hostMatch?.[1]?.replace(/[()]/g, ''),
    account: accountMatch?.[1]?.replace(/[()]/g, '')
  }
}

function runGh(
  args: string[],
  cwd: string,
  timeoutMs = 90_000
): Promise<{ code: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, {
      cwd,
      windowsHide: true,
      env: process.env,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 1, stdout, stderr: stderr || 'gh timed out' })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      const message =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'gh CLI が見つかりません。GitHub CLI をインストールし、PATH に追加してください。'
          : error.message
      resolve({ code: 1, stdout, stderr: message, error: message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function createPullRequest(
  cwd: string,
  input: GhPrCreateInput
): Promise<GhPrCreateResult> {
  try {
    await access(cwd)
  } catch {
    return { ok: false, error: 'ワークスペースがありません' }
  }

  const built = buildPrCreateArgs(input)
  if ('error' in built) return { ok: false, error: built.error }

  const result = await runGh(built, cwd)
  if (result.code !== 0) {
    return {
      ok: false,
      stdout: result.stdout,
      error: result.error || result.stderr.trim() || result.stdout.trim() || 'gh pr create に失敗しました'
    }
  }

  const url = extractPrUrl(result.stdout, result.stderr) ?? undefined
  return {
    ok: true,
    url,
    stdout: result.stdout.trim()
  }
}

export type GhReviewComment = {
  path: string
  line: number
  body: string
  side?: 'LEFT' | 'RIGHT'
}

export function findingsToReviewComments(
  findings: Array<{ path: string; line?: number; title: string; detail: string; severity?: string }>
): GhReviewComment[] {
  return findings
    .filter((row) => row.path && typeof row.line === 'number' && row.line > 0)
    .slice(0, 30)
    .map((row) => ({
      path: row.path.replace(/\\/g, '/'),
      line: row.line!,
      side: 'RIGHT' as const,
      body: `**[${row.severity ?? 'info'}] ${row.title}**\n\n${row.detail}`
    }))
}

export function buildPullRequestReviewArgs(
  ownerRepo: string,
  prNumber: number,
  comments: GhReviewComment[],
  body = 'Bugbot findings'
): string[] | { error: string } {
  if (!ownerRepo.includes('/')) return { error: 'owner/repo が不正です' }
  if (!Number.isFinite(prNumber) || prNumber <= 0) return { error: 'PR 番号が不正です' }
  if (comments.length === 0) return { error: 'コメントが空です' }
  const payload = {
    event: 'COMMENT',
    body,
    comments: comments.map((row) => ({
      path: row.path,
      line: row.line,
      side: row.side ?? 'RIGHT',
      body: row.body
    }))
  }
  return [
    'api',
    `repos/${ownerRepo}/pulls/${prNumber}/reviews`,
    '--method',
    'POST',
    '--input',
    '-'
  ]
  // input via stdin handled in createPullRequestReview
}

export async function resolveGithubOwnerRepo(cwd: string): Promise<string | null> {
  const view = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd, 20_000)
  const name = view.stdout.trim()
  if (view.code === 0 && /^[^/\s]+\/[^/\s]+$/.test(name)) return name
  return null
}

export async function resolveCurrentPrNumber(cwd: string): Promise<number | null> {
  const view = await runGh(['pr', 'view', '--json', 'number', '-q', '.number'], cwd, 20_000)
  const n = Number(view.stdout.trim())
  return view.code === 0 && Number.isFinite(n) && n > 0 ? n : null
}

export async function createPullRequestReview(
  cwd: string,
  input: {
    prNumber?: number
    comments: GhReviewComment[]
    body?: string
  }
): Promise<{ ok: boolean; prNumber?: number; error?: string; stdout?: string }> {
  try {
    await access(cwd)
  } catch {
    return { ok: false, error: 'ワークスペースがありません' }
  }
  if (!input.comments.length) return { ok: false, error: 'コメントが空です' }

  const ownerRepo = await resolveGithubOwnerRepo(cwd)
  if (!ownerRepo) return { ok: false, error: 'gh repo view で owner/repo を取得できません' }

  const prNumber = input.prNumber ?? (await resolveCurrentPrNumber(cwd))
  if (!prNumber) return { ok: false, error: '現在のブランチの PR が見つかりません（gh pr view）' }

  const payload = JSON.stringify({
    event: 'COMMENT',
    body: input.body ?? 'Bugbot findings',
    comments: input.comments.map((row) => ({
      path: row.path,
      line: row.line,
      side: row.side ?? 'RIGHT',
      body: row.body
    }))
  })

  const result = await runGhWithStdin(
    ['api', `repos/${ownerRepo}/pulls/${prNumber}/reviews`, '--method', 'POST', '--input', '-'],
    cwd,
    payload
  )
  if (result.code !== 0) {
    // Fallback: single summary comment on the PR
    const summary = [
      input.body ?? 'Bugbot findings',
      '',
      ...input.comments.slice(0, 20).map(
        (row, i) => `${i + 1}. \`${row.path}:${row.line}\` — ${row.body.replace(/\n+/g, ' ').slice(0, 200)}`
      )
    ].join('\n')
    const fallback = await runGh(['pr', 'comment', String(prNumber), '--body', summary], cwd)
    if (fallback.code !== 0) {
      return {
        ok: false,
        prNumber,
        error:
          result.error ||
          result.stderr.trim() ||
          fallback.stderr.trim() ||
          'gh PR レビュー投稿に失敗しました'
      }
    }
    return { ok: true, prNumber, stdout: fallback.stdout.trim() }
  }
  return { ok: true, prNumber, stdout: result.stdout.trim() }
}

function runGhWithStdin(
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs = 90_000
): Promise<{ code: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, {
      cwd,
      windowsHide: true,
      env: process.env,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolve({ code: 1, stdout, stderr, error: 'gh api timeout' })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      const message =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'gh コマンドが見つかりません（GitHub CLI をインストールしてください）'
          : error.message
      resolve({ code: 1, stdout, stderr: message, error: message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

export async function getGhAuthStatus(cwd?: string): Promise<GhAuthStatusResult> {
  const result = await runGh(['auth', 'status'], cwd && cwd.trim() !== '' ? cwd : process.cwd(), 20_000)
  if (result.error && /見つかりません/.test(result.error)) {
    return { ok: false, loggedIn: false, error: result.error }
  }
  const parsed = parseAuthStatus(result.stdout, result.stderr)
  // gh auth status often exits 0 when logged in; non-zero when not
  const loggedIn = parsed.loggedIn || (result.code === 0 && /Logged in to/i.test(result.stdout + result.stderr))
  return {
    ok: true,
    loggedIn,
    account: parsed.account,
    host: parsed.host,
    stdout: (result.stdout || result.stderr).trim(),
    error: loggedIn ? undefined : (result.stderr.trim() || 'GitHub にログインしていません（gh auth login）')
  }
}
