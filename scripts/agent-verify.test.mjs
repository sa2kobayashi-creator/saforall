import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

test('excerptShellFailure prefers the tail', async () => {
  // Keep local copy — importing workspaceTools pulls heavy deps in node --test.
  function excerptShellFailure(stderr, stdout, max = 5000) {
    const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
    if (!combined) return '(no output)'
    if (combined.length <= max) return combined
    const head = Math.floor(max * 0.25)
    const tail = max - head - 48
    return `${combined.slice(0, head)}\n\n... (truncated ${combined.length - max} chars; showing head+tail) ...\n\n${combined.slice(-tail)}`
  }
  const head = 'warning line\n'.repeat(200)
  const tail = 'ERROR: real failure at end'
  const excerpt = excerptShellFailure('', head + tail, 400)
  assert.match(excerpt, /ERROR: real failure at end/)
  assert.match(excerpt, /truncated/)
})

test('suggestVerifyCommands prefers typecheck before test', async () => {
  const scripts = { typecheck: 'tsc -p .', test: 'npm run typecheck && node --test' }
  let primary = null
  const fallbacks = []
  if (scripts.typecheck) {
    primary = 'npm run typecheck'
    if (scripts.test) fallbacks.push('npm test')
  } else if (scripts.test) {
    primary = 'npm test'
  }
  assert.equal(primary, 'npm run typecheck')
  assert.deepEqual(fallbacks, ['npm test'])
})

test('prioritizeProblemsByPaths elevates active file diagnostics', async () => {
  const { prioritizeProblemsByPaths } = await import('../electron/main/lib/agentVerify.ts')
  const rows = [
    'error: src/other.ts:1 unrelated',
    'error: electron/main/toolAgent.ts:10 real bug',
    'warning: docs/guide.md:2 noise'
  ]
  const ordered = prioritizeProblemsByPaths(rows, ['electron/main/toolAgent.ts'], 10)
  assert.match(ordered[0], /toolAgent\.ts/)
})

test('formatProblemsForAgent uses preferred path order', async () => {
  const { formatProblemsForAgent } = await import('../electron/main/lib/agentVerify.ts')
  const text = formatProblemsForAgent(
    ['error: a.ts:1 x', 'error: b.ts:2 y'],
    10,
    ['b.ts']
  )
  assert.ok(text.indexOf('b.ts') < text.indexOf('a.ts'))
})

test('extractAgentRuntimeContext collects problems and anchors', async () => {
  const { extractAgentRuntimeContext } = await import('../electron/main/lib/agentContext.ts')
  const ctx = extractAgentRuntimeContext({
    context: {
      path: 'src/App.tsx',
      problems: ['error: src/App.tsx:1 x', 12],
      selection: { path: 'src/App.tsx', text: 'hi' },
      files: [{ path: 'src/other.ts' }]
    }
  })
  assert.deepEqual(ctx.problems, ['error: src/App.tsx:1 x'])
  assert.ok(ctx.anchors.includes('src/App.tsx'))
  assert.ok(ctx.anchors.includes('src/other.ts'))
})

test('toolAgent requires read_file before edit_file and retries empty tool_calls', async () => {
  const src = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  assert.match(src, /read_required/)
  assert.match(src, /Call read_file on this path before edit_file/)
  assert.match(src, /MAX_EMPTY_TOOL_RETRIES/)
  assert.match(src, /tool_calls が空です/)
  assert.match(src, /Array\.from\(searchAnchors\)/)
  assert.match(src, /anchorPaths/)
})

test('api and directLlm pass problems and anchors into runToolAgent', async () => {
  const api = await readFile(join(root, 'electron/main/api.ts'), 'utf8')
  const direct = await readFile(join(root, 'electron/main/directLlm.ts'), 'utf8')
  assert.match(api, /extractAgentRuntimeContext/)
  assert.match(api, /anchorPaths: agentCtx\.anchors/)
  assert.match(api, /problems: agentCtx\.problems/)
  assert.match(direct, /extractAgentRuntimeContext/)
  assert.match(direct, /anchorPaths: agentCtx\.anchors/)
})
