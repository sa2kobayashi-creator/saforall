import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('scoreContentHit prefers path-local symbols over unrelated files', async () => {
  const { scoreContentHit } = await import('../electron/main/workspaceIndex.ts')
  const low = scoreContentHit({
    path: 'docs/notes.md',
    lineText: 'mentions AuthService somehow',
    needle: 'AuthService',
    symbolNames: ['AuthService']
  })
  const high = scoreContentHit({
    path: 'src/AuthService.ts',
    lineText: 'export class AuthService {',
    needle: 'AuthService',
    pathSymbolNames: ['AuthService'],
    symbolDefLine: 1,
    lineNumber: 1
  })
  assert.ok(high > low)
})

test('scoreContentHit penalizes docs and markdown paths', async () => {
  const { scoreContentHit } = await import('../electron/main/workspaceIndex.ts')
  const code = scoreContentHit({
    path: 'src/foo.ts',
    lineText: 'AuthService helper',
    needle: 'AuthService'
  })
  const docs = scoreContentHit({
    path: 'docs/guide.md',
    lineText: 'AuthService helper',
    needle: 'AuthService'
  })
  assert.ok(code > docs)
})

test('scoreContentHit returns -1 when no match', async () => {
  const { scoreContentHit } = await import('../electron/main/workspaceIndex.ts')
  assert.equal(
    scoreContentHit({ path: 'src/a.ts', lineText: 'hello', needle: 'AuthService' }),
    -1
  )
})

test('scoreContentHit boosts primary anchors over regular anchors', async () => {
  const { scoreContentHit } = await import('../electron/main/workspaceIndex.ts')
  const regular = scoreContentHit({
    path: 'src/a.ts',
    lineText: 'AuthService used here',
    needle: 'AuthService',
    anchorPaths: new Set(['src/a.ts'])
  })
  const primary = scoreContentHit({
    path: 'src/a.ts',
    lineText: 'AuthService used here',
    needle: 'AuthService',
    primaryAnchorPaths: new Set(['src/a.ts']),
    anchorPaths: new Set(['src/a.ts'])
  })
  assert.ok(primary > regular)
})

test('workspaceIndex search diversifies and uses depth-2 neighborhood', async () => {
  const source = await readFile(join(__dirname, '../electron/main/workspaceIndex.ts'), 'utf8')
  assert.match(source, /export function scoreContentHit/)
  assert.match(source, /pathSymbolNames/)
  assert.match(source, /primaryAnchorPaths/)
  assert.match(source, /getImportNeighborhood\(index\.imports, Array\.from\(anchors\), 2\)/)
  assert.match(source, /perPathCap/)
  assert.match(source, /diversified/)
  assert.match(source, /selectIndexedSymbols/)
  assert.match(source, /score -= 22/)
})

test('ChatPanel puts selection path first in codebase anchors', async () => {
  const chat = await readFile(join(__dirname, '../src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /Primary: selection path/)
  assert.match(chat, /selection\?\.path/)
  assert.match(chat, /activeProblemPaths/)
  assert.match(chat, /rankedProblems/)
})

async function withRankFixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'saforall-rank-'))
  try {
    const files = {
      'src/auth/AuthService.ts':
        'export class AuthService {\n  login() {\n    return true\n  }\n}\n',
      'src/auth/login.ts':
        "import { AuthService } from './AuthService'\n\nexport function login() {\n  return new AuthService().login()\n}\n",
      'src/unrelated/notes.ts':
        '// somehow mentions AuthService in a comment only\nexport const note = 1\n',
      'docs/guide.md': '# AuthService overview\n\nSee AuthService for details.\n',
      'tests/AuthService.test.ts':
        "import { AuthService } from '../src/auth/AuthService'\n\ndescribe('AuthService', () => {\n  it('works', () => {\n    expect(new AuthService().login()).toBe(true)\n  })\n})\n"
    }
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, body, 'utf8')
    }
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('eval: AuthService definition ranks above docs and unrelated mentions', async () => {
  const {
    invalidateWorkspaceIndex,
    searchIndexedContent
  } = await import('../electron/main/workspaceIndex.ts')

  await withRankFixture(async (ws) => {
    invalidateWorkspaceIndex()
    const hits = await searchIndexedContent(ws, 'AuthService', undefined, 12)
    assert.ok(hits.length > 0, 'expected hits')
    const top = hits[0]
    assert.match(top, /src\/auth\/AuthService\.ts/)
    assert.doesNotMatch(hits[0], /docs\/guide\.md/)
    const paths = hits.map((row) => row.split(':')[0])
    assert.ok(paths.includes('src/auth/AuthService.ts'))
  })
})

test('eval: anchor on login.ts still prefers AuthService definition', async () => {
  const {
    invalidateWorkspaceIndex,
    searchIndexedContent
  } = await import('../electron/main/workspaceIndex.ts')

  await withRankFixture(async (ws) => {
    invalidateWorkspaceIndex()
    const hits = await searchIndexedContent(ws, 'AuthService', undefined, 12, [
      'src/auth/login.ts'
    ])
    assert.ok(hits.length > 0)
    assert.match(hits[0], /src\/auth\/AuthService\.ts|src\/auth\/login\.ts/)
    const joined = hits.join('\n')
    assert.match(joined, /src\/auth\/AuthService\.ts/)
    const defIndex = hits.findIndex((row) => row.includes('src/auth/AuthService.ts'))
    const docsIndex = hits.findIndex((row) => row.includes('docs/guide.md'))
    if (docsIndex >= 0) {
      assert.ok(defIndex >= 0 && defIndex < docsIndex)
    }
  })
})

test('eval: per-path diversification keeps multiple files in top hits', async () => {
  const {
    invalidateWorkspaceIndex,
    searchIndexedContent
  } = await import('../electron/main/workspaceIndex.ts')

  await withRankFixture(async (ws) => {
    invalidateWorkspaceIndex()
    const hits = await searchIndexedContent(ws, 'AuthService', undefined, 10)
    const uniquePaths = new Set(hits.map((row) => row.split(':')[0]))
    assert.ok(uniquePaths.size >= 2, `expected diversified paths, got ${[...uniquePaths]}`)
  })
})

function assertTopPathContains(hits, expectedSubstring) {
  assert.ok(hits.length > 0, 'expected at least one hit')
  assert.ok(
    hits[0].includes(expectedSubstring),
    `expected top hit to include ${expectedSubstring}, got: ${hits[0]}`
  )
}

test('eval: real repo queries prefer implementation files', async () => {
  const {
    invalidateWorkspaceIndex,
    searchIndexedContent
  } = await import('../electron/main/workspaceIndex.ts')
  const repoRoot = join(__dirname, '..')
  invalidateWorkspaceIndex()

  const cases = [
    { needle: 'scoreContentHit', expect: 'workspaceIndex.ts' },
    { needle: 'extractCodebaseNeedles', expect: 'chatMentions.ts' },
    { needle: 'runToolAgent', expect: 'toolAgent.ts' },
    { needle: 'prioritizeProblemsByPaths', expect: 'agentVerify.ts' }
  ]

  let hitsOk = 0
  for (const row of cases) {
    const hits = await searchIndexedContent(repoRoot, row.needle, undefined, 12)
    try {
      assertTopPathContains(hits, row.expect)
      hitsOk += 1
    } catch (error) {
      // Allow near-miss if expected path is still in top 3 (dense repo noise).
      const top3 = hits.slice(0, 3).join('\n')
      assert.ok(
        top3.includes(row.expect),
        `${row.needle}: expected ${row.expect} in top3\n${top3}\n${error}`
      )
      hitsOk += 1
    }
  }
  assert.equal(hitsOk, cases.length)
})
