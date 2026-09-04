import assert from 'node:assert/strict'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'

function resolveWorkspacePath(workspaceRoot, targetPath) {
  const root = resolve(workspaceRoot)
  const absolute = resolve(isAbsolute(targetPath) ? targetPath : join(root, targetPath))
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('ワークスペース外のパスにはアクセスできません')
  }
  return absolute
}

/** Mirror of electron/main/toolAgent.ts repairToolArguments */
function repairToolArguments(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return '{}'
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // continue
  }

  let candidate = trimmed
  const quoteCount = (candidate.match(/"/g) ?? []).length
  if (quoteCount % 2 === 1) candidate += '"'
  const openCurly = (candidate.match(/\{/g) ?? []).length
  const closeCurly = (candidate.match(/\}/g) ?? []).length
  if (openCurly > closeCurly) candidate += '}'.repeat(openCurly - closeCurly)
  const openSquare = (candidate.match(/\[/g) ?? []).length
  const closeSquare = (candidate.match(/\]/g) ?? []).length
  if (openSquare > closeSquare) candidate += ']'.repeat(openSquare - closeSquare)

  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return '{}'
  }
}

test('resolveWorkspacePath allows children', () => {
  const root = resolve('D:/tmp/project')
  const child = resolveWorkspacePath(root, 'src/App.tsx')
  assert.equal(child, resolve(root, 'src/App.tsx'))
})

test('resolveWorkspacePath blocks escape', () => {
  const root = resolve('D:/tmp/project')
  assert.throws(() => resolveWorkspacePath(root, '../secret.txt'))
})

test('repairToolArguments keeps valid JSON', () => {
  const raw = '{"path":"a.ts","content":"x"}'
  assert.equal(repairToolArguments(raw), raw)
})

test('repairToolArguments closes truncated object', () => {
  const repaired = repairToolArguments('{"path":"a.ts","content":"hello')
  const parsed = JSON.parse(repaired)
  assert.equal(parsed.path, 'a.ts')
  assert.equal(typeof parsed.content, 'string')
})
