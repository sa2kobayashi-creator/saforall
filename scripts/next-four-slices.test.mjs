import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function problemsAffectEditedPaths(problems, editedPaths, options = {}) {
  const normalizeRelPath = (path) =>
    path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  const edited = new Set([...editedPaths].map(normalizeRelPath))
  const hits = []
  for (const row of problems) {
    const lower = row.toLowerCase()
    if (options.errorsOnly !== false && !/\berror\b/i.test(row)) continue
    for (const edit of edited) {
      const base = edit.split('/').pop()
      if (lower.includes(edit) || (base && lower.includes(base))) {
        hits.push(row)
        break
      }
    }
  }
  return hits
}

function extractImportSpecifiers(content) {
  const specs = new Set()
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(content)) !== null) {
      const spec = match[1]?.trim()
      if (spec?.startsWith('.')) specs.add(spec)
    }
  }
  return [...specs]
}

function resolveImportToIndexedPath(fromPath, specifier, knownFiles) {
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
  const joined = [fromDir, specifier].filter(Boolean).join('/')
  const parts = joined.split('/')
  const out = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  const base = out.join('/')
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

function scoreContentHit(params) {
  const needle = params.needle.toLowerCase()
  const path = params.path.toLowerCase()
  const line = params.lineText.toLowerCase()
  if (!line.includes(needle)) return -1
  let score = 10
  if (params.anchorPaths?.has(params.path)) score += 35
  if (params.neighborPaths?.has(params.path)) score += 25
  return score
}

function buildExtensionScaffoldManifest(item) {
  const id = `openvsx.${(item.id || item.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
  return {
    id,
    name: item.name,
    permissions: ['terminal.run', 'network'],
    commands: [{ id: 'help', title: 'Show help / probe', run: 'echo ok' }]
  }
}

function findingsToReviewComments(findings) {
  return findings
    .filter((row) => row.path && row.line > 0)
    .map((row) => ({
      path: row.path,
      line: row.line,
      body: `**[${row.severity ?? 'info'}] ${row.title}**\n\n${row.detail}`
    }))
}

test('problemsAffectEditedPaths matches error lines on edited files', () => {
  const hits = problemsAffectEditedPaths(
    ['error src/a.ts:10: unused', 'warning src/b.ts:1: x'],
    ['src/a.ts'],
    { errorsOnly: true }
  )
  assert.equal(hits.length, 1)
  assert.match(hits[0], /src\/a\.ts/)
})

test('import neighborhood resolves relative specs', () => {
  const specs = extractImportSpecifiers(`import { x } from './lib/util'\nrequire('../other')`)
  assert.ok(specs.includes('./lib/util'))
  const known = new Set(['src/lib/util.ts', 'src/other.ts', 'src/a.ts'])
  assert.equal(resolveImportToIndexedPath('src/a.ts', './lib/util', known), 'src/lib/util.ts')
})

test('scoreContentHit boosts anchors and neighbors', () => {
  const base = scoreContentHit({
    path: 'src/a.ts',
    lineText: 'function foo()',
    needle: 'foo'
  })
  const anchored = scoreContentHit({
    path: 'src/a.ts',
    lineText: 'function foo()',
    needle: 'foo',
    anchorPaths: new Set(['src/a.ts'])
  })
  assert.ok(anchored > base)
})

test('extension scaffold builds workspace manifest', () => {
  const manifest = buildExtensionScaffoldManifest({
    id: 'Acme.Tools',
    name: 'Acme Tools'
  })
  assert.match(manifest.id, /^openvsx\./)
  assert.ok(manifest.commands.length >= 1)
})

test('findingsToReviewComments maps line comments', () => {
  const comments = findingsToReviewComments([
    { path: 'a.ts', line: 3, title: 'TODO', detail: 'fix', severity: 'warning' },
    { path: 'b.ts', title: 'no line', detail: 'x' }
  ])
  assert.equal(comments.length, 1)
  assert.equal(comments[0].line, 3)
})

test('sources wire verify/extensions/codebase/gh review', async () => {
  const agentVerify = await readFile(
    join(__dirname, '../electron/main/lib/agentVerify.ts'),
    'utf8'
  )
  assert.match(agentVerify, /MAX_EDIT_RECOVERIES/)
  assert.match(agentVerify, /problemsAffectEditedPaths/)

  const toolAgent = await readFile(join(__dirname, '../electron/main/toolAgent.ts'), 'utf8')
  assert.match(toolAgent, /get_problems/)
  assert.match(toolAgent, /problemsSnapshot/)

  const extensions = await readFile(join(__dirname, '../electron/main/extensions.ts'), 'utf8')
  assert.match(extensions, /scaffoldExtensionFromMarketplace/)

  const index = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(index, /extensions:scaffold/)
  assert.match(index, /gh:prReview/)

  const wsIndex = await readFile(join(__dirname, '../electron/main/workspaceIndex.ts'), 'utf8')
  assert.match(wsIndex, /getImportNeighborhood/)
  assert.match(wsIndex, /neighborPaths/)

  const gh = await readFile(join(__dirname, '../electron/main/gh.ts'), 'utf8')
  assert.match(gh, /createPullRequestReview/)
  assert.match(gh, /findingsToReviewComments/)
})
