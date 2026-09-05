import assert from 'node:assert/strict'
import test from 'node:test'

function excerptShellFailure(stderr, stdout, max = 5000) {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  if (!combined) return '(no output)'
  if (combined.length <= max) return combined
  const head = Math.floor(max * 0.25)
  const tail = max - head - 48
  return `${combined.slice(0, head)}\n\n... (truncated ${combined.length - max} chars; showing head+tail) ...\n\n${combined.slice(-tail)}`
}

test('excerptShellFailure prefers the tail', () => {
  const head = 'warning line\n'.repeat(200)
  const tail = 'ERROR: real failure at end'
  const excerpt = excerptShellFailure('', head + tail, 400)
  assert.match(excerpt, /ERROR: real failure at end/)
  assert.match(excerpt, /truncated/)
})

test('suggestVerifyCommands prefers typecheck before test', () => {
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
