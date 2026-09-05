import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function resolveProblemOpenPath(workspacePath, problemPath) {
  const raw = problemPath.trim()
  if (!raw) return raw
  const unified = raw.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(unified) || unified.startsWith('/')) {
    return problemPath
  }
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw)
      return decodeURIComponent(url.pathname.replace(/^\/([a-zA-Z]:)/, '$1'))
    } catch {
      // fall through
    }
  }
  const rootPath = (workspacePath || '').replace(/[/\\]+$/, '')
  if (!rootPath) return problemPath
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const rel = unified.replace(/^\.\//, '')
  return `${rootPath}${sep}${rel.split('/').join(sep)}`
}

function formatXamppHealthUrl(baseUrl) {
  const base = (baseUrl || 'http://localhost:8081/saforall/api').replace(/\/$/, '')
  return `${base}/health`
}

function buildAgentSuccessMemoryNote(input) {
  const files = (input.editedPaths || []).slice(0, 8).join(', ')
  return [
    'Agent 完了（自動）',
    files ? `変更候補: ${files}` : null,
    input.verifyCommand ? `検証: ${input.verifyCommand}` : null,
    input.summary ? String(input.summary).slice(0, 400) : null
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeJobsAfterLoad(jobsList, now = Date.now()) {
  return jobsList.map((job) => {
    if (job.status !== 'queued' && job.status !== 'running') return job
    return {
      ...job,
      status: 'cancelled',
      finishedAt: job.finishedAt ?? now,
      summary: job.summary || 'interrupted (app restart)'
    }
  })
}

function parseMcpResourceRows(serverId, result) {
  const rows = Array.isArray(result?.resources) ? result.resources : []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const uri = typeof row.uri === 'string' ? row.uri : ''
    if (!uri) continue
    out.push({
      uri,
      name: typeof row.name === 'string' ? row.name : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      mimeType: typeof row.mimeType === 'string' ? row.mimeType : undefined,
      serverId
    })
  }
  return out
}

function parseMcpPromptRows(serverId, result) {
  const rows = Array.isArray(result?.prompts) ? result.prompts : []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const name = typeof row.name === 'string' ? row.name : ''
    if (!name) continue
    out.push({
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      serverId
    })
  }
  return out
}

test('packaging: electron-builder.yml and scripts exist', async () => {
  await access(join(root, 'electron-builder.yml'), constants.F_OK)
  await access(join(root, 'docs/PACKAGING.md'), constants.F_OK)
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.dist, /electron-builder/)
  assert.match(pkg.scripts.pack, /electron-builder/)
  assert.ok(pkg.devDependencies['electron-builder'])
})

test('daily: resolveProblemOpenPath joins relative paths', () => {
  assert.equal(
    resolveProblemOpenPath('D:/ws', 'src/App.tsx').replace(/\\/g, '/'),
    'D:/ws/src/App.tsx'
  )
  assert.equal(resolveProblemOpenPath('D:/ws', 'D:/ws/abs.ts'), 'D:/ws/abs.ts')
})

test('daily: XAMPP health URL helper', () => {
  assert.equal(
    formatXamppHealthUrl('http://localhost:8081/saforall/api/'),
    'http://localhost:8081/saforall/api/health'
  )
})

test('memories: agent success note format', () => {
  const note = buildAgentSuccessMemoryNote({
    editedPaths: ['a.ts', 'b.ts'],
    verifyCommand: 'npm test',
    summary: 'ok'
  })
  assert.match(note, /Agent 完了/)
  assert.match(note, /a\.ts/)
  assert.match(note, /npm test/)
})

test('jobs: load normalizes in-flight as cancelled', () => {
  const [job] = normalizeJobsAfterLoad([
    {
      id: 'job-1',
      kind: 'agent',
      title: 't',
      status: 'running',
      createdAt: 1,
      prompt: 'p',
      cwd: null
    }
  ])
  assert.equal(job.status, 'cancelled')
  assert.match(job.summary, /interrupted/)
})

test('mcp: parse resources and prompts rows', () => {
  const resources = parseMcpResourceRows('srv', {
    resources: [{ uri: 'file:///a', name: 'A' }, { uri: '' }]
  })
  assert.equal(resources.length, 1)
  assert.equal(resources[0].uri, 'file:///a')
  const prompts = parseMcpPromptRows('srv', {
    prompts: [{ name: 'review' }, { name: '' }]
  })
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].name, 'review')
})

test('sources wire packaging + path + memory + mcp extras + jobs persist', async () => {
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /resolveProblemOpenPath/)
  assert.match(app, /buildBackendOfflineMessage/)
  const toolAgent = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(toolAgent, /appendProjectMemory/)
  assert.match(toolAgent, /buildAgentSuccessMemoryNote/)
  assert.match(toolAgent, /list_mcp_resources|read_mcp_resource/)
  const mcp = await readFile(join(root, 'electron/main/mcpClient.ts'), 'utf8')
  assert.match(mcp, /resources\/list/)
  assert.match(mcp, /prompts\/list/)
  const jobs = await readFile(join(root, 'electron/main/backgroundJobs.ts'), 'utf8')
  assert.match(jobs, /configureJobsPersistence|loadPersistedJobs/)
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /configureJobsPersistence|loadPersistedJobs/)
})
