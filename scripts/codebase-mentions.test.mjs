import assert from 'node:assert/strict'
import test from 'node:test'

test('extractCodebaseNeedles ignores mentions and stopwords', async () => {
  const { extractCodebaseNeedles } = await import('../src/lib/chatMentions.ts')
  const needles = extractCodebaseNeedles('@codebase please fix AuthService login flow')
  assert.ok(needles.some((row) => /AuthService/i.test(row)))
  assert.ok(!needles.some((row) => row.toLowerCase() === 'please'))
  assert.ok(!needles.some((row) => row.toLowerCase() === 'codebase'))
})

test('extractCodebaseNeedles drops common Japanese filler', async () => {
  const { extractCodebaseNeedles } = await import('../src/lib/chatMentions.ts')
  const needles = extractCodebaseNeedles('scoreContentHit を修正してください')
  assert.ok(needles.some((row) => /scoreContentHit/i.test(row)))
  assert.ok(!needles.some((row) => row === 'ください'))
  assert.ok(!needles.some((row) => row === '修正'))
})
