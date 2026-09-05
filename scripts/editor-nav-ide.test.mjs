import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/** Mirrors electron/main/gitIgnore.ts basename / directory prefix rules for tests. */
function ignoresByPatterns(relPosix, isDirectory, patterns) {
  let ignored = false
  for (const raw of patterns) {
    let negated = false
    let body = raw.trim()
    if (!body || body.startsWith('#')) continue
    if (body.startsWith('!')) {
      negated = true
      body = body.slice(1)
    }
    let directoryOnly = false
    if (body.endsWith('/')) {
      directoryOnly = true
      body = body.slice(0, -1)
    }
    const base = relPosix.split('/').pop() ?? relPosix
    const hit =
      relPosix === body ||
      relPosix.startsWith(`${body}/`) ||
      (!body.includes('/') && base === body) ||
      (directoryOnly && isDirectory && (relPosix === body || relPosix.startsWith(`${body}/`)))
    if (hit) ignored = !negated
  }
  return ignored
}

test('sources wire symbol pickers, peek, split, gitignore', async () => {
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /SymbolPickerDialog/)
  assert.match(app, /go:symbolInFile/)
  assert.match(app, /go:workspaceSymbol/)
  assert.match(app, /view:splitEditor/)
  assert.match(app, /splitPath/)
  assert.match(app, /peekDefinitionTrigger/)

  const menu = await readFile(join(root, 'electron/main/menu.ts'), 'utf8')
  assert.match(menu, /CmdOrCtrl\+Shift\+O/)
  assert.match(menu, /CmdOrCtrl\+T/)
  assert.match(menu, /view:splitEditor/)

  const editor = await readFile(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(editor, /saforall\.peekDefinition/)
  assert.match(editor, /editor-peek/)
  assert.match(editor, /registerProviders/)

  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /createWorkspaceIgnoreMatcher/)
  const ignoreSrc = await readFile(join(root, 'electron/main/gitIgnore.ts'), 'utf8')
  assert.match(ignoreSrc, /node_modules/)
  assert.match(ignoreSrc, /\.gitignore/)
})

test('gitignore pattern helper hides node_modules and respects negation', () => {
  const patterns = ['node_modules/', 'dist/', '*.log', '!keep.log', 'noise.log']
  assert.equal(ignoresByPatterns('node_modules', true, patterns), true)
  assert.equal(ignoresByPatterns('src', true, patterns), false)
  assert.equal(ignoresByPatterns('noise.log', false, patterns), true)
  assert.equal(ignoresByPatterns('keep.log', false, patterns), false)
})
