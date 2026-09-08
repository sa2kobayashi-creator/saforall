import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('a dead language server rejects its in-flight requests', () => {
  const src = read('electron/main/lspClient.ts')

  // Previously only 'error' cleared waiters, so a crash left every pending
  // completion/hover hanging until the 15s timeout.
  assert.match(src, /this\.child\.on\('exit', \(code, signal\) => \{[\s\S]*?this\.failPending\(/)
  assert.match(src, /private failPending\(error: Error\): void/)
  // stop() and the error path must go through the same helper.
  assert.equal((src.match(/this\.failPending\(/g) ?? []).length, 3)
  assert.equal(
    /on\('exit', \(\) => \{\s*this\.child = null\s*this\.emit\('exit'\)/.test(src),
    false,
    'the silent exit handler must be gone'
  )
})

test('failPending clears the map before rejecting', async () => {
  // A reject handler that issues a new request must not see the stale waiter.
  const src = read('electron/main/lspClient.ts')
  const body = src.slice(src.indexOf('private failPending'))
  const clearAt = body.indexOf('this.waiters.clear()')
  const rejectAt = body.indexOf('waiter.reject(error)')
  assert.ok(clearAt > -1 && rejectAt > -1)
  assert.ok(clearAt < rejectAt, 'waiters must be cleared before rejecting')
})

test('language server stderr reaches a log instead of being dropped', () => {
  const src = read('electron/main/lspClient.ts')
  assert.match(src, /this\.emit\('log', chunk\.toString\('utf-8'\)\)/)
  assert.match(src, /client\.on\('log', \(chunk: string\) => \{/)
  assert.match(src, /console\.warn\(`\[lsp:\$\{config\.languageId\}\]/)
})

test('both editor panes are synced to the LSP', () => {
  const src = read('src/App.tsx')

  assert.match(src, /const splitFile = splitPath \?/)
  assert.match(src, /const targets = \[activeFile, splitFile\]/)
  // Same file in both panes must not be sent twice.
  assert.match(src, /all\.findIndex\(\(other\) => other\?\.path === file\.path\) === index/)
  assert.match(src, /splitFile\?\.content/)
  assert.equal(
    /\}, \[workspacePath, activeFile\?\.path, activeFile\?\.content\]\)/.test(src),
    false,
    'the primary-only dependency list must be gone'
  )
})

test('LSP providers resolve the requesting model, not the focused tab', () => {
  const providers = read('src/lib/lspProviders.ts')
  const pane = read('src/components/EditorPane.tsx')

  assert.match(providers, /getMeta: \(model\?: unknown\) => \{ path: string; language: string \} \| null/)
  assert.equal(
    /const meta = getMeta\(\)/.test(providers),
    false,
    'every provider must forward its model'
  )
  assert.equal((providers.match(/const meta = getMeta\(model\)/g) ?? []).length, 8)
  assert.equal(/_model/.test(providers), false, 'the model argument is used now')

  assert.match(pane, /const resolveMetaForModel = useCallback\(/)
  assert.match(pane, /monaco\.Uri\.parse\(tab\.path\)\.toString\(\) === key/)
  assert.match(pane, /registerLspProviders\(\s*monaco,\s*resolveMetaForModel,/)
})

test('MessageContent stops re-parsing history on every streamed token', () => {
  const src = read('src/components/MessageContent.tsx')
  assert.match(src, /export const MessageContent = memo\(function MessageContent\(/)
  assert.match(src, /useMemo\(\(\) => parseMessageParts\(content\), \[content\]\)/)
})

test('monaco is reachable only through the dynamic bootstrap', () => {
  const setup = read('src/lib/monacoSetup.ts')
  const bootstrap = read('src/lib/monacoBootstrap.ts')
  const entry = read('src/main.tsx')

  assert.match(bootstrap, /import \* as monaco from 'monaco-editor'/)
  assert.match(bootstrap, /loader\.config\(\{ monaco \}\)/)

  // The gate module must stay free of static monaco imports or the dynamic
  // import buys nothing.
  assert.equal(/from 'monaco-editor/.test(setup), false)
  assert.match(setup, /import\('\.\/monacoBootstrap'\)/)
  assert.match(setup, /export function useMonacoReady\(\): boolean/)

  assert.equal(/setupMonaco/.test(entry), false, 'the entry must not block on monaco')
})

test('every Monaco-rendering component waits for the loader', () => {
  for (const rel of [
    'src/components/EditorPane.tsx',
    'src/components/ApplyDiffDialog.tsx',
    'src/components/ScmDiffDialog.tsx'
  ]) {
    const src = read(rel)
    assert.match(src, /useMonacoReady/, `${rel} must gate on monaco readiness`)
    assert.match(src, /monacoReady \?/, `${rel} must render a placeholder first`)
  }
})

test('heavy panels are code-split out of the entry chunk', () => {
  const lazy = read('src/components/lazyPanels.tsx')
  const app = read('src/App.tsx')

  for (const name of [
    'ChatPanel',
    'BottomPanel',
    'SettingsPanel',
    'ComposerPanel',
    'UsagePanel',
    'ApplyDiffDialog',
    'ScmDiffDialog'
  ]) {
    assert.match(lazy, new RegExp(`import\\('\\./${name}'\\)`), `${name} must be lazy`)
    assert.equal(
      new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./components/${name}'`).test(app),
      false,
      `${name} must not be statically imported by App`
    )
  }
  assert.match(app, /from '\.\/components\/lazyPanels'/)

  // marked lives in PreviewPane, so supportsPreview had to move out.
  const pane = read('src/components/EditorPane.tsx')
  assert.match(pane, /supportsPreview \} from '\.\.\/lib\/previewSupport'/)
  assert.match(pane, /lazy\(\(\) =>\s*import\('\.\/PreviewPane'\)/)
})

test('startup issues one /settings request instead of two', async () => {
  const app = read('src/App.tsx')
  const chat = read('src/components/ChatPanel.tsx')

  assert.match(app, /fetchAppSettings/)
  assert.match(chat, /fetchAppSettings\(\)/)
  // The locale read used to await the model catalogs first.
  assert.match(app, /await Promise\.all\(\[\s*prefetchAllModelCatalogs\(\)/)
  assert.match(app, /invalidateAppSettings\(\)/)

  const calls = []
  globalThis.window = {
    saforall: {
      request: async () => {
        calls.push(Date.now())
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { ok: true, data: { settings: { 'app.locale': 'ja' } } }
      }
    }
  }
  try {
    const { fetchAppSettings, invalidateAppSettings } = await import(
      pathToFileURL(join(root, 'src/lib/settingsCache.ts')).href
    )
    const [a, b] = await Promise.all([fetchAppSettings(), fetchAppSettings()])
    assert.equal(calls.length, 1, 'concurrent callers must share one request')
    assert.deepEqual(a, b)

    invalidateAppSettings()
    await fetchAppSettings()
    assert.equal(calls.length, 2, 'invalidate must force a refetch')
  } finally {
    delete globalThis.window
  }
})

test('sliceListPage keeps long lists off the first render', async () => {
  const { sliceListPage, nextPageCount, LIST_PAGE_SIZE } = await import(
    pathToFileURL(join(root, 'src/lib/incrementalList.ts')).href
  )

  const items = Array.from({ length: 5000 }, (_, i) => i)
  const first = sliceListPage(items, LIST_PAGE_SIZE)
  assert.equal(first.visible.length, LIST_PAGE_SIZE)
  assert.equal(first.hidden, 5000 - LIST_PAGE_SIZE)

  const all = sliceListPage(items, 5000)
  assert.equal(all.hidden, 0)
  assert.equal(all.visible, items, 'must reuse the array when nothing is cut')

  const short = sliceListPage([1, 2], LIST_PAGE_SIZE)
  assert.equal(short.hidden, 0)
  assert.deepEqual(short.visible, [1, 2])

  assert.equal(nextPageCount(LIST_PAGE_SIZE), LIST_PAGE_SIZE * 2)
  assert.equal(nextPageCount(0, 50), 50)
})

test('the file tree and Problems panel page their lists', () => {
  const sidebar = read('src/components/Sidebar.tsx')
  const problems = read('src/components/ProblemsPanel.tsx')

  assert.match(sidebar, /const rootPage = useIncrementalList\(entries\)/)
  assert.match(sidebar, /const childPage = useIncrementalList\(children \?\? EMPTY_ENTRIES\)/)
  // A fresh [] each render would reset paging while children load.
  assert.match(sidebar, /const EMPTY_ENTRIES: DirEntry\[\] = \[\]/)
  assert.match(sidebar, /rootPage\.visible\.map/)
  assert.match(sidebar, /childPage\.visible\.map/)

  assert.match(problems, /function ProblemGroup\(/)
  assert.match(problems, /useIncrementalList\(group\.items\)/)
  assert.match(problems, /visible\.map\(\(item\) =>/)
  assert.match(problems, /さらに \{hidden\} 件を表示/)
})
