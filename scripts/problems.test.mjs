import assert from 'node:assert/strict'
import test from 'node:test'

/** Mirror of src/lib/problems.ts mergeRules for node:test without TS loader. */
function mergeProblems(items) {
  const rank = { error: 0, warning: 1, info: 2 }
  const seen = new Map()
  for (const item of items) {
    const key = [
      (item.path ?? '').replace(/\//g, '\\').toLowerCase(),
      String(item.line ?? 0),
      String(item.column ?? 0),
      item.message.trim()
    ].join('::')
    const existing = seen.get(key)
    if (!existing || rank[item.severity] < rank[existing.severity]) {
      seen.set(key, { ...item, id: key })
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byPath = (a.path ?? '').localeCompare(b.path ?? '', undefined, { sensitivity: 'base' })
    if (byPath !== 0) return byPath
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

test('mergeProblems dedupes monaco+lsp same message preferring error', () => {
  const merged = mergeProblems([
    {
      id: 'a',
      severity: 'warning',
      source: 'monaco',
      message: 'Cannot find name x',
      path: 'D:/a.ts',
      line: 3,
      column: 1
    },
    {
      id: 'b',
      severity: 'error',
      source: 'tsserver',
      message: 'Cannot find name x',
      path: 'D:\\a.ts',
      line: 3,
      column: 1
    }
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].severity, 'error')
  assert.equal(merged[0].source, 'tsserver')
})

test('mergeProblems sorts errors before warnings', () => {
  const merged = mergeProblems([
    { id: '1', severity: 'warning', source: 'a', message: 'w', path: 'b.ts', line: 2 },
    { id: '2', severity: 'error', source: 'a', message: 'e', path: 'a.ts', line: 1 }
  ])
  assert.equal(merged[0].severity, 'error')
  assert.equal(merged[1].severity, 'warning')
})
