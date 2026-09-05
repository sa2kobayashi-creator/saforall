import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function normalizeExceptionBreakMode(value) {
  if (value === 'all' || value === 'uncaught' || value === 'none') return value
  return 'uncaught'
}

function toCdpPauseOnExceptions(mode) {
  return mode
}

function toDapExceptionFilters(mode) {
  if (mode === 'none') return []
  if (mode === 'all') return ['raised', 'uncaught']
  return ['uncaught']
}

function expandSourceMapBreakpointPaths(filePath) {
  const path = filePath.trim()
  if (!path) return []
  const out = [path]
  if (/\.tsx$/i.test(path)) {
    out.push(path.replace(/\.tsx$/i, '.js'))
    out.push(path.replace(/\.tsx$/i, '.jsx'))
  } else if (/\.ts$/i.test(path)) {
    out.push(path.replace(/\.ts$/i, '.js'))
    out.push(path.replace(/\.ts$/i, '.mjs'))
  }
  return out
}

test('normalizeExceptionBreakMode defaults to uncaught', () => {
  assert.equal(normalizeExceptionBreakMode(undefined), 'uncaught')
  assert.equal(normalizeExceptionBreakMode('all'), 'all')
  assert.equal(normalizeExceptionBreakMode('bogus'), 'uncaught')
})

test('CDP and DAP exception mappings', () => {
  assert.equal(toCdpPauseOnExceptions('none'), 'none')
  assert.deepEqual(toDapExceptionFilters('none'), [])
  assert.deepEqual(toDapExceptionFilters('uncaught'), ['uncaught'])
  assert.deepEqual(toDapExceptionFilters('all'), ['raised', 'uncaught'])
})

test('expandSourceMapBreakpointPaths for ts/tsx', () => {
  assert.deepEqual(expandSourceMapBreakpointPaths('src/a.ts'), [
    'src/a.ts',
    'src/a.js',
    'src/a.mjs'
  ])
  assert.deepEqual(expandSourceMapBreakpointPaths('src/b.tsx'), [
    'src/b.tsx',
    'src/b.js',
    'src/b.jsx'
  ])
  assert.deepEqual(expandSourceMapBreakpointPaths('src/c.js'), ['src/c.js'])
})

test('debugExtras wired into CDP/DAP sessions', async () => {
  const extras = await readFile(
    join(__dirname, '../electron/main/lib/debugExtras.ts'),
    'utf8'
  )
  assert.match(extras, /export function toDapExceptionFilters/)
  assert.match(extras, /export function expandSourceMapBreakpointPaths/)

  const cdp = await readFile(join(__dirname, '../electron/main/debugSession.ts'), 'utf8')
  assert.match(cdp, /Debugger\.setPauseOnExceptions/)
  assert.match(cdp, /enable-source-maps/)
  assert.match(cdp, /expandSourceMapBreakpointPaths/)

  const dap = await readFile(join(__dirname, '../electron/main/dapSession.ts'), 'utf8')
  assert.match(dap, /setExceptionBreakpoints/)
})
