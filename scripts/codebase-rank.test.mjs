import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function scoreContentHit({ path, lineText, needle, symbolNames = [] }) {
  const n = needle.toLowerCase()
  const p = path.toLowerCase()
  const line = lineText.toLowerCase()
  let score = 0
  if (!line.includes(n)) return -1
  score += 10
  if (p.includes(n)) score += 40
  const base = p.split('/').pop() ?? ''
  if (base.includes(n)) score += 30
  if (symbolNames.some((name) => name.toLowerCase() === n)) score += 50
  if (/^src\//.test(p)) score += 8
  if (/test|spec/.test(p)) score -= 5
  if (/^(export|function|class|const|type|interface)\b/.test(line.trim())) score += 12
  return score
}

test('scoreContentHit ranks symbol and src path higher', () => {
  const low = scoreContentHit({
    path: 'docs/notes.md',
    lineText: 'mentions AuthService somehow',
    needle: 'AuthService'
  })
  const high = scoreContentHit({
    path: 'src/AuthService.ts',
    lineText: 'export class AuthService {',
    needle: 'AuthService',
    symbolNames: ['AuthService']
  })
  assert.ok(high > low)
})

test('scoreContentHit returns -1 when no match', () => {
  assert.equal(
    scoreContentHit({ path: 'src/a.ts', lineText: 'hello', needle: 'AuthService' }),
    -1
  )
})

test('workspaceIndex exports scoreContentHit', async () => {
  const source = await readFile(join(__dirname, '../electron/main/workspaceIndex.ts'), 'utf8')
  assert.match(source, /export function scoreContentHit/)
  assert.match(source, /ranked\.sort/)
})
