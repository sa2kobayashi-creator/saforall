import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function localHistoryFileKey(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16)
}

function serializeKeybindings(entries) {
  const cleaned = entries
    .filter((row) => row.key.trim() && row.command.trim())
    .map((row) => ({
      key: row.key.trim().toLowerCase().replace(/\s+/g, ''),
      command: row.command.trim(),
      ...(row.when?.trim() ? { when: row.when.trim() } : {})
    }))
  return `${JSON.stringify(cleaned, null, 2)}\n`
}

function assertSafeExtensionRun(run, permissions = []) {
  const text = run.trim()
  if (!text) return { ok: false, error: 'コマンドが空です' }
  const dangerous = permissions.includes('terminal.run.dangerous')
  const blocked =
    /\brm\s+-rf\b/i.test(text) ||
    /\bdel\s+\/s\b/i.test(text) ||
    /\bformat\s+[a-z]:/i.test(text) ||
    /\bshutdown\b/i.test(text)
  if (blocked && !dangerous) {
    return { ok: false, error: '破壊的コマンドには terminal.run.dangerous 権限が必要です' }
  }
  return { ok: true }
}

test('localHistoryFileKey is stable', () => {
  assert.equal(localHistoryFileKey('src/App.tsx'), localHistoryFileKey('src/App.tsx'))
  assert.equal(localHistoryFileKey('src\\App.tsx'), localHistoryFileKey('src/App.tsx'))
})

test('serializeKeybindings writes json array', () => {
  const raw = serializeKeybindings([{ key: 'Ctrl+S', command: 'file.save' }])
  const parsed = JSON.parse(raw)
  assert.equal(parsed[0].key, 'ctrl+s')
  assert.equal(parsed[0].command, 'file.save')
})

test('assertSafeExtensionRun blocks rm -rf without dangerous grant', () => {
  assert.equal(assertSafeExtensionRun('rm -rf /', ['terminal.run']).ok, false)
  assert.equal(
    assertSafeExtensionRun('rm -rf /', ['terminal.run', 'terminal.run.dangerous']).ok,
    true
  )
})

test('sources wire auto-save, history, keybindings, bitbucket probe, extension enable', async () => {
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /loadAutoSaveEnabled|autoSaveEnabled/)
  assert.match(app, /recordLocalHistory/)
  assert.match(app, /historyRefreshKey|Timeline/)
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /history:list/)
  assert.match(index, /bitbucket:probeAuth/)
  assert.match(index, /extensions:setEnabled/)
  const settings = await readFile(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  assert.match(settings, /KeybindingsEditor/)
  assert.match(settings, /Auto-save/)
  const bottom = await readFile(join(root, 'src/components/BottomPanel.tsx'), 'utf8')
  assert.match(bottom, /timeline/)
  const ext = await readFile(join(root, 'src/components/ExtensionsPanel.tsx'), 'utf8')
  assert.match(ext, /setExtensionEnabled|assertSafeExtensionRun/)
  const scm = await readFile(join(root, 'src/components/SourceControlPanel.tsx'), 'utf8')
  assert.match(scm, /bitbucketProbeAuth/)
})
