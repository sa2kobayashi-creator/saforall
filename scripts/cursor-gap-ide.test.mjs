import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

test('explorer context menu wires mkdir/delete/rename', async () => {
  const sidebar = await readFile(join(root, 'src/components/Sidebar.tsx'), 'utf8')
  assert.match(sidebar, /explorer-menu/)
  assert.match(sidebar, /mkdir\(/)
  assert.match(sidebar, /deletePath\(/)
  assert.match(sidebar, /renamePath\(/)
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /fs:mkdir/)
  assert.match(index, /fs:delete/)
  assert.match(index, /fs:rename/)
  const preload = await readFile(join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(preload, /deletePath:/)
  assert.match(preload, /renamePath:/)
})

test('command palette wires Ctrl+Shift+P and dispatch', async () => {
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /CommandPalette/)
  assert.match(app, /view:commands/)
  assert.match(app, /commandPaletteOpen/)
  assert.match(app, /shiftKey/)
  const menu = await readFile(join(root, 'electron/main/menu.ts'), 'utf8')
  assert.match(menu, /view:commands/)
  assert.match(menu, /CmdOrCtrl\+Shift\+P/)
  const palette = await readFile(join(root, 'src/components/CommandPalette.tsx'), 'utf8')
  assert.match(palette, /BUILTIN_PALETTE_COMMANDS/)
})

test('quick fix / code actions wire LSP + Monaco', async () => {
  const lsp = await readFile(join(root, 'electron/main/lspClient.ts'), 'utf8')
  assert.match(lsp, /textDocument\/codeAction/)
  assert.match(lsp, /codeActionLiteralSupport/)
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /lsp:codeActions/)
  const preload = await readFile(join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(preload, /lspCodeActions/)
  const providers = await readFile(join(root, 'src/lib/lspProviders.ts'), 'utf8')
  assert.match(providers, /registerCodeActionProvider/)
})

test('inline edit reviews diff before apply', async () => {
  const bar = await readFile(join(root, 'src/components/InlineEditBar.tsx'), 'utf8')
  assert.match(bar, /ApplyDiffDialog/)
  assert.match(bar, /setPreview|preview/)
  assert.match(bar, /生成/)
})

test('terminal multi-tab wires newTerminalTrigger', async () => {
  const term = await readFile(join(root, 'src/components/TerminalPanel.tsx'), 'utf8')
  assert.match(term, /newTerminalTrigger/)
  assert.match(term, /terminal-tabs/)
  assert.match(term, /addTab|ターミナル/)
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /terminal:new/)
  assert.match(app, /newTerminalTrigger/)
  const menu = await readFile(join(root, 'electron/main/menu.ts'), 'utf8')
  assert.match(menu, /terminal:new/)
})
