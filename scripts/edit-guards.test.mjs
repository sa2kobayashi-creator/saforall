import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('assessEditContent rejects gutting small entry files', async () => {
  const mod = await import(pathToFileURL(join(root, 'electron/main/lib/editGuards.ts')).href)
  const { assessEditContent } = mod

  const prevMain = `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
`

  assert.equal(prevMain.length < 400, true, 'fixture must be under old 400 gate')

  const blank = assessEditContent({
    path: 'src/main.js',
    nextContent: '\n',
    previousContent: prevMain
  })
  assert.equal(blank.ok, false)
  assert.ok(blank.reason === 'whitespace_only' || blank.reason === 'entry_gutted' || blank.reason === 'suspicious_truncate')

  const stub = assessEditContent({
    path: 'src/main.js',
    nextContent: '// broken\n',
    previousContent: prevMain
  })
  assert.equal(stub.ok, false)

  const html = assessEditContent({
    path: 'public/index.html',
    nextContent: '<html></html>',
    previousContent:
      '<!DOCTYPE html><html lang="ja"><head><title>sa-Signboard</title></head><body><div id="root"></div></body></html>'
  })
  assert.equal(html.ok, false)

  const ok = assessEditContent({
    path: 'src/main.js',
    nextContent: prevMain + '\n// keep\n',
    previousContent: prevMain
  })
  assert.equal(ok.ok, true)
})

test('toolAgent and applyProposals wire editGuards', () => {
  const agent = readFileSync(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  const apply = readFileSync(join(root, 'src/lib/applyProposals.ts'), 'utf8')
  assert.match(agent, /assessEditContent/)
  assert.match(agent, /入口ファイルを空/)
  assert.match(apply, /assessEditContent/)
  assert.match(apply, /entry_gutted/)
})
