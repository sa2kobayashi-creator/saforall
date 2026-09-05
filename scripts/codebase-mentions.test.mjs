import assert from 'node:assert/strict'
import test from 'node:test'

function extractCodebaseNeedles(input) {
  const cleaned = input.replace(/@[^\s@]+/g, ' ')
  const words =
    cleaned.match(/[A-Za-z_][\w./-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}/g) ?? []
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'into',
    'please',
    'codebase',
    'file',
    'files'
  ])
  const out = []
  for (const word of words) {
    const key = word.toLowerCase()
    if (stop.has(key)) continue
    if (out.some((row) => row.toLowerCase() === key)) continue
    out.push(word)
    if (out.length >= 5) break
  }
  return out
}

test('extractCodebaseNeedles ignores mentions and stopwords', () => {
  const needles = extractCodebaseNeedles('@codebase please fix AuthService login flow')
  assert.ok(needles.some((row) => /AuthService/i.test(row)))
  assert.ok(!needles.some((row) => row.toLowerCase() === 'please'))
  assert.ok(!needles.some((row) => row.toLowerCase() === 'codebase'))
})
