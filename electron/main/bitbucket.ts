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
