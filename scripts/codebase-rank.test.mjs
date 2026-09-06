import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
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
})

test('ChatPanel puts selection path first in codebase anchors', async () => {
  const chat = await readFile(join(__dirname, '../src/components/ChatPanel.tsx'), 'utf8')
  assert.match(chat, /Primary: selection path/)
  assert.match(chat, /selection\?\.path/)
})
