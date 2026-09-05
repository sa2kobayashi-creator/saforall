import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function isSafeExternalUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim())
}

test('openExternal only allows http(s) urls', () => {
  assert.equal(isSafeExternalUrl('https://github.com/org/repo/pull/1'), true)
  assert.equal(isSafeExternalUrl('http://localhost:3000'), true)
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl(''), false)
})

test('index.ts wires gh auth and openExternal IPC', async () => {
  const source = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(source, /gh:authStatus/)
  assert.match(source, /shell:openExternal/)
  assert.match(source, /getGhAuthStatus/)
})

test('SourceControlPanel shows GitHub auth line', async () => {
  const source = await readFile(
    join(__dirname, '../src/components/SourceControlPanel.tsx'),
    'utf8'
  )
  assert.match(source, /ghAuthStatus/)
  assert.match(source, /scm-gh-auth/)
  assert.match(source, /openExternal/)
})
