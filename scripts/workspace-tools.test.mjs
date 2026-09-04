import assert from 'node:assert/strict'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'

function resolveWorkspacePath(workspaceRoot, targetPath) {
  const root = resolve(workspaceRoot)
  const absolute = resolve(isAbsolute(targetPath) ? targetPath : join(root, targetPath))
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('ワークスペース外のパスにはアクセスできません')
  }
  return absolute
}

test('resolveWorkspacePath allows children', () => {
  const root = resolve('D:/tmp/project')
  const child = resolveWorkspacePath(root, 'src/App.tsx')
  assert.equal(child, resolve(root, 'src/App.tsx'))
})

test('resolveWorkspacePath blocks escape', () => {
  const root = resolve('D:/tmp/project')
  assert.throws(() => resolveWorkspacePath(root, '../secret.txt'))
})
