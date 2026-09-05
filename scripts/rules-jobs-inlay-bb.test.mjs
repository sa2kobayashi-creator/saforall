import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseBitbucketRemoteUrl(remoteUrl) {
  const raw = remoteUrl.trim()
  if (!raw) return null
  const ssh = raw.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (ssh && /bitbucket\.org/i.test(ssh[1])) {
    return { host: ssh[1], workspace: ssh[2], repo: ssh[3], url: raw }
  }
  try {
    const u = new URL(raw.replace(/^git\+/, ''))
    if (!/bitbucket\.org$/i.test(u.hostname) && !/\.bitbucket\.org$/i.test(u.hostname)) {
      return null
    }
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/i, '').split('/').filter(Boolean)
    if (parts.length < 2) return null
    return { host: u.hostname, workspace: parts[0], repo: parts[1], url: raw }
  } catch {
    return null
  }
}

function buildBitbucketPullRequestCreateUrl(info, options = {}) {
  const source = (options.source ?? '').trim()
  const dest = (options.dest ?? '').trim()
  const base = `https://${info.host}/${info.workspace}/${info.repo}/pull-requests/new`
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  if (dest) params.set('dest', dest)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function formatInlayLabel(label) {
  if (typeof label === 'string') return label
  if (Array.isArray(label)) {
    return label
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof part.value === 'string') return part.value
        return ''
      })
      .join('')
  }
  return ''
}

test('parseBitbucketRemoteUrl supports ssh and https', () => {
  const ssh = parseBitbucketRemoteUrl('git@bitbucket.org:acme/app.git')
  assert.equal(ssh.workspace, 'acme')
  assert.equal(ssh.repo, 'app')
  const https = parseBitbucketRemoteUrl('https://bitbucket.org/acme/app.git')
  assert.equal(https.workspace, 'acme')
  assert.equal(https.repo, 'app')
  assert.equal(parseBitbucketRemoteUrl('https://github.com/acme/app.git'), null)
})

test('buildBitbucketPullRequestCreateUrl includes source branch', () => {
  const url = buildBitbucketPullRequestCreateUrl(
    { host: 'bitbucket.org', workspace: 'acme', repo: 'app', url: 'x' },
    { source: 'feature/x' }
  )
  assert.match(url, /pull-requests\/new/)
  assert.match(url, /source=feature%2Fx/)
})

test('formatInlayLabel flattens parts', () => {
  assert.equal(formatInlayLabel([{ value: ':' }, { value: 'string' }]), ':string')
})

test('rules / inlay / bitbucket / jobs wired in sources', async () => {
  const tools = await readFile(join(__dirname, '../electron/main/workspaceTools.ts'), 'utf8')
  assert.match(tools, /export async function appendProjectMemory/)
  assert.match(tools, /export async function listProjectRuleFiles/)

  const lsp = await readFile(join(__dirname, '../electron/main/lspClient.ts'), 'utf8')
  assert.match(lsp, /textDocument\/inlayHint/)
  assert.match(lsp, /async inlayHints/)

  const index = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(index, /rules:appendMemory/)
  assert.match(index, /bitbucket:remote/)
  assert.match(index, /lsp:inlayHints/)

  const providers = await readFile(join(__dirname, '../src/lib/lspProviders.ts'), 'utf8')
  assert.match(providers, /registerInlayHintsProvider/)

  const activity = await readFile(join(__dirname, '../src/components/ActivityBar.tsx'), 'utf8')
  assert.match(activity, /'rules'/)

  const bottom = await readFile(join(__dirname, '../src/components/BottomPanel.tsx'), 'utf8')
  assert.match(bottom, /JobsPanel/)
})
