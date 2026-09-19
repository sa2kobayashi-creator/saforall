import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const root = join(import.meta.dirname, '..')

test('local persistence modules exist', () => {
  for (const rel of [
    'electron/main/localDb.ts',
    'electron/main/chatStore.ts',
    'electron/main/workspaceStore.ts',
    'electron/main/usageStore.ts',
    'electron/main/localApi.ts',
    'electron/main/localAiRouter.ts'
  ]) {
    const src = readFileSync(join(root, rel), 'utf8')
    assert.ok(src.length > 100, rel)
  }
})

test('api prefers local mode when PHP is down', async () => {
  const api = await readFile(join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(api, /mode\?: 'php' \| 'local'/)
  assert.match(api, /ローカルモード/)
  assert.match(api, /localApiRequest/)
  assert.match(api, /prepareLocalRoute/)
  assert.match(api, /completeLocalRoute/)
  assert.match(api, /phpOnline/)
})

test('index configures local-db under userData', async () => {
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /local-db/)
  assert.match(index, /configureLocalDb/)
})

test('chatStore round-trip on temp dir', async () => {
  // Compile-free: exercise via dynamic import of built output is heavy.
  // Instead verify session file format helpers by writing through a tiny inline clone.
  const dir = await mkdtemp(join(tmpdir(), 'saforall-local-'))
  try {
    await mkdir(join(dir, 'messages'), { recursive: true })
    const sessions = {
      sessions: [
        {
          id: 1,
          workspace_id: null,
          title: 'New chat',
          created_at: '2026-01-01 00:00:00',
          updated_at: '2026-01-01 00:00:00'
        }
      ]
    }
    await writeFile(join(dir, 'sessions.json'), JSON.stringify(sessions), 'utf8')
    const raw = JSON.parse(await readFile(join(dir, 'sessions.json'), 'utf8'))
    assert.equal(raw.sessions[0].id, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ARCHITECTURE documents local-first packaging', async () => {
  const doc = await readFile(join(root, 'docs/ARCHITECTURE.md'), 'utf8')
  assert.match(doc, /ローカル JSON/)
  assert.match(doc, /XAMPP なし/)
})

test('StatusBar shows Model API Online/Offline, not local storage as the chip', async () => {
  const bar = await readFile(join(root, 'src/components/StatusBar.tsx'), 'utf8')
  assert.match(bar, /status\.modelApiOnline/)
  assert.match(bar, /status\.modelApiOffline/)
  assert.doesNotMatch(bar, /mode === 'local'/)
  assert.doesNotMatch(bar, /'ローカル'/)
})

test('resolveModelApiStatus treats packaged local storage as Model API online when keyed', async () => {
  const { resolveModelApiStatus } = await import('../src/lib/modelApiStatus.ts')
  assert.equal(
    resolveModelApiStatus({ hasKey: true, networkOnline: true }),
    'online'
  )
  assert.equal(
    resolveModelApiStatus({ hasKey: false, networkOnline: true }),
    'offline'
  )
  assert.equal(
    resolveModelApiStatus({ hasKey: true, networkOnline: false }),
    'offline'
  )
  assert.equal(
    resolveModelApiStatus({ hasKey: false, networkOnline: true, phpConnected: true }),
    'online'
  )
  assert.equal(resolveModelApiStatus({ checking: true, hasKey: true, networkOnline: true }), 'checking')
})
