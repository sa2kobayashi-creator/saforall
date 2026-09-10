import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(pathToFileURL(join(root, 'src/lib/chatAttachments.ts')).href)
const {
  addAttachedPath,
  attachmentLabel,
  pathsFromDataTransfer,
  removeAttachedPath
} = mod

test('attachmentLabel uses the basename', () => {
  assert.equal(attachmentLabel('D:\\ws\\src\\App.tsx'), 'App.tsx')
  assert.equal(attachmentLabel('src/lib/foo.ts'), 'foo.ts')
})

test('addAttachedPath is case-insensitive and ordered', () => {
  const once = addAttachedPath([], 'D:\\a.ts')
  assert.deepEqual(once, ['D:\\a.ts'])
  assert.deepEqual(addAttachedPath(once, 'd:\\a.ts'), once)
  assert.deepEqual(addAttachedPath(once, 'D:\\b.ts'), ['D:\\a.ts', 'D:\\b.ts'])
})

test('removeAttachedPath drops the matching entry', () => {
  const rows = ['D:\\a.ts', 'D:\\b.ts']
  assert.deepEqual(removeAttachedPath(rows, 'd:\\a.ts'), ['D:\\b.ts'])
  assert.deepEqual(removeAttachedPath(rows, 'missing'), rows)
})

test('pathsFromDataTransfer reads Electron File.path and file URIs', () => {
  const fakeFile = { path: 'D:\\ws\\readme.md', name: 'readme.md' }
  const dt = {
    files: {
      length: 1,
      item: () => fakeFile
    },
    getData: (type) => (type === 'text/uri-list' ? '' : '')
  }
  assert.deepEqual(pathsFromDataTransfer(dt), ['D:\\ws\\readme.md'])

  const uriDt = {
    files: { length: 0, item: () => null },
    getData: (type) =>
      type === 'text/uri-list' ? 'file:///D:/ws/src/main.ts\n' : ''
  }
  assert.deepEqual(pathsFromDataTransfer(uriDt), ['D:\\ws\\src\\main.ts'])

  const relative = {
    files: { length: 0, item: () => null },
    getData: (type) => (type === 'text/plain' ? 'src/App.tsx' : '')
  }
  assert.deepEqual(pathsFromDataTransfer(relative, { workspacePath: 'D:\\ws' }), [
    'D:\\ws\\src/App.tsx'
  ])
})

test('ChatPanel wires Cursor-style attach chips and drop zone', () => {
  const src = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /from '\.\.\/lib\/chatAttachments'/)
  assert.match(src, /chat-attach-zone/)
  assert.match(src, /chat-attach-add/)
  assert.match(src, /openAttachPicker/)
  assert.match(src, /pathsFromDataTransfer\(/)
  assert.match(src, /setAttachedPaths\(\[\]\)/)
  assert.match(src, /onPaste=\{\(event\) => \{/)
})
