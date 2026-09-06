import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

test('Settings copy is local-first', () => {
  const settings = readFileSync(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  const css = readFileSync(join(root, 'src/components/SettingsPanel.css'), 'utf8')
  const messages = readFileSync(join(root, 'src/i18n/messages.ts'), 'utf8')
  const help = readFileSync(join(root, 'src/components/HelpDialogs.tsx'), 'utf8')
  const guide = readFileSync(join(root, 'src/lib/backendGuide.ts'), 'utf8')
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')

  assert.match(settings, /backendMode/)
  assert.match(settings, /settings\.localModeHint/)
  assert.match(settings, /settings\.savedLocal/)
  assert.match(settings, /settings\.loadingLocal/)
  assert.doesNotMatch(settings, /サーバ復帰時に同期/)
  assert.doesNotMatch(settings, /ローカル退避/)
  assert.match(css, /\.settings-info/)
  assert.match(messages, /settings\.localModeHint/)
  assert.match(messages, /XAMPP 不要/)
  assert.match(help, /アプリ内に保存/)
  assert.doesNotMatch(help, /XAMPP 上の PHP/)
  assert.match(guide, /配布版では XAMPP 不要/)
  assert.match(app, /backendMode=\{backend\.mode\}/)
})
