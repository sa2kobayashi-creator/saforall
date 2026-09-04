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

function computeDiffStats(original, modified) {
  const a = original.replace(/\r\n/g, '\n').split('\n')
  const b = modified.replace(/\r\n/g, '\n').split('\n')
  const setA = new Map()
  for (const line of a) setA.set(line, (setA.get(line) ?? 0) + 1)
  const setB = new Map()
  for (const line of b) setB.set(line, (setB.get(line) ?? 0) + 1)
  let removed = 0
  let added = 0
  for (const [line, count] of setA) {
    const next = setB.get(line) ?? 0
    if (count > next) removed += count - next
  }
  for (const [line, count] of setB) {
    const prev = setA.get(line) ?? 0
    if (count > prev) added += count - prev
  }
  return { added, removed }
}

function buildRunFileCommand(filePath, inspect = false) {
  const lower = filePath.toLowerCase()
  const quoted = `"${filePath.replace(/"/g, '\\"')}"`
  if (lower.endsWith('.js')) return inspect ? `node --inspect ${quoted}` : `node ${quoted}`
  if (lower.endsWith('.ts')) {
    return inspect ? `npx --yes tsx --inspect ${quoted}` : `npx --yes tsx ${quoted}`
  }
  return null
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

test('computeDiffStats counts added/removed lines', () => {
  const stats = computeDiffStats('a\nb\n', 'a\nc\n')
  assert.equal(stats.added, 1)
  assert.equal(stats.removed, 1)
})

test('buildRunFileCommand supports node inspect', () => {
  assert.match(buildRunFileCommand('D:/app/index.js', true), /node --inspect/)
})
