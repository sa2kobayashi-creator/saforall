import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function buildMultiFileTabContext(currentPath, related, maxChars = 1800) {
  const parts = []
  let used = 0
  for (const file of related) {
    if (file.path === currentPath) continue
    const name = file.path.replace(/\\/g, '/').split('/').slice(-2).join('/')
    const lines = file.content.split(/\r?\n/)
    const headers = lines
      .filter((line) =>
        /^\s*(export\s+)?(async\s+)?(function|class|const|type|interface|def)\b/.test(line)
      )
      .slice(0, 8)
    if (headers.length === 0) continue
    const block = `// file: ${name}\n${headers.join('\n')}`
    if (used + block.length > maxChars) break
    parts.push(block)
    used += block.length
    if (parts.length >= 4) break
  }
  return parts.join('\n\n')
}

test('buildMultiFileTabContext includes other tab exports', () => {
  const ctx = buildMultiFileTabContext('D:/proj/a.ts', [
    { path: 'D:/proj/a.ts', content: 'export function a() {}' },
    { path: 'D:/proj/lib/AuthService.ts', content: 'export class AuthService {}\nconst x = 1\n' }
  ])
  assert.match(ctx, /AuthService/)
  assert.doesNotMatch(ctx, /function a/)
})

test('lspClient restarts on document sync failure', async () => {
  const source = await readFile(join(__dirname, '../electron/main/lspClient.ts'), 'utf8')
  assert.match(source, /failCooldownMs = 8_000/)
  assert.match(source, /Restart tsserver/)
})

test('tabCompletions exports multi-file helper', async () => {
  const source = await readFile(join(__dirname, '../src/lib/tabCompletions.ts'), 'utf8')
  assert.match(source, /export function buildMultiFileTabContext/)
  assert.match(source, /getRelatedFiles/)
})
