import { spawn } from 'child_process'

export type BitbucketRemoteInfo = {
  host: string
  workspace: string
  repo: string
  url: string
}

/** Parse Bitbucket Cloud remote URLs (HTTPS or SSH). */
export function parseBitbucketRemoteUrl(remoteUrl: string): BitbucketRemoteInfo | null {
  const raw = remoteUrl.trim()
  if (!raw) return null

  // git@bitbucket.org:workspace/repo.git
  const ssh = raw.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (ssh && /bitbucket\.org/i.test(ssh[1]!)) {
    return {
      host: ssh[1]!,
      workspace: ssh[2]!,
      repo: ssh[3]!,
      url: raw
    }
  }

  // https://bitbucket.org/workspace/repo.git
  try {
    const normalized = raw.replace(/^git\+/, '')
    const u = new URL(normalized)
    if (!/bitbucket\.org$/i.test(u.hostname) && !/\.bitbucket\.org$/i.test(u.hostname)) {
      return null
    }
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/i, '').split('/').filter(Boolean)
    if (parts.length < 2) return null
    return {
      host: u.hostname,
      workspace: parts[0]!,
      repo: parts[1]!,
      url: raw
    }
  } catch {
    return null
  }
}

export function buildBitbucketPullRequestCreateUrl(
  info: BitbucketRemoteInfo,
  options?: { source?: string; dest?: string }
): string {
  const source = (options?.source ?? '').trim()
  const dest = (options?.dest ?? '').trim()
  const base = `https://${info.host}/${info.workspace}/${info.repo}/pull-requests/new`
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  if (dest) params.set('dest', dest)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, env: process.env })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(stdout.trim()))
  })
}

export async function detectBitbucketRemote(
  cwd: string
): Promise<BitbucketRemoteInfo | null> {
  const url = await runGit(['remote', 'get-url', 'origin'], cwd)
  return parseBitbucketRemoteUrl(url)
}

export async function detectCurrentBranchName(cwd: string): Promise<string | null> {
  const name = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return name && name !== 'HEAD' ? name : null
}

export type BitbucketAuthProbe = {
  ok: boolean
  remote: boolean
  message: string
  guideUrl: string
}

/** Lightweight auth probe: can we talk to origin without prompting forever? */
export async function probeBitbucketAuth(cwd: string): Promise<BitbucketAuthProbe> {
  const guideUrl = 'https://support.atlassian.com/bitbucket-cloud/docs/set-up-an-ssh-key/'
  const info = await detectBitbucketRemote(cwd)
  if (!info) {
    return {
      ok: false,
      remote: false,
      message: 'origin が Bitbucket ではありません',
      guideUrl
    }
  }
  const result = await runGitWithCode(
    ['ls-remote', '--heads', 'origin'],
    cwd,
    12_000
  )
  if (result.code === 0) {
    return {
      ok: true,
      remote: true,
      message: `認証 OK · ${info.workspace}/${info.repo}`,
      guideUrl
    }
  }
  const err = (result.stderr || result.stdout || '').toLowerCase()
  let message = 'Bitbucket へのアクセスに失敗しました'
  if (err.includes('authentication') || err.includes('permission') || err.includes('403')) {
    message = '認証エラーです。SSH 鍵または App Password を確認してください'
  } else if (err.includes('could not resolve') || err.includes('timed out')) {
    message = 'ネットワークまたはホスト名を確認してください'
  } else if (result.stderr) {
    message = result.stderr.slice(0, 180)
  }
  return { ok: false, remote: true, message, guideUrl }
}

function runGitWithCode(
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, env: process.env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolve({ code: 124, stdout, stderr: stderr || 'timeout' })
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
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}
