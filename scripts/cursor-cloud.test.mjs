import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveCursorCreateOptions(params) {
  const preferCloud =
    params.preference === 'cloud' ||
    (params.preference === 'auto' && Boolean(params.repoUrl?.trim()))

  if (preferCloud && params.repoUrl?.trim()) {
    return {
      kind: 'cloud',
      cloud: {
        repos: [
          {
            url: params.repoUrl.trim(),
            ...(params.startingRef?.trim()
              ? { startingRef: params.startingRef.trim() }
              : {})
          }
        ],
        autoCreatePR: params.autoCreatePR !== false
      }
    }
  }

  return { kind: 'local', local: { cwd: params.cwd } }
}

test('local preference always uses local cwd', () => {
  const shape = resolveCursorCreateOptions({
    preference: 'local',
    cwd: '/repo',
    repoUrl: 'https://github.com/acme/app.git'
  })
  assert.equal(shape.kind, 'local')
  assert.equal(shape.local.cwd, '/repo')
})

test('cloud preference with repo uses cloud repos', () => {
  const shape = resolveCursorCreateOptions({
    preference: 'cloud',
    cwd: '/repo',
    repoUrl: 'https://github.com/acme/app.git',
    startingRef: 'main',
    autoCreatePR: true
  })
  assert.equal(shape.kind, 'cloud')
  assert.equal(shape.cloud.repos[0].url, 'https://github.com/acme/app.git')
  assert.equal(shape.cloud.repos[0].startingRef, 'main')
  assert.equal(shape.cloud.autoCreatePR, true)
})

test('auto without repo falls back to local', () => {
  const shape = resolveCursorCreateOptions({
    preference: 'auto',
    cwd: '/repo',
    repoUrl: null
  })
  assert.equal(shape.kind, 'local')
})

test('auto with github remote selects cloud', () => {
  const shape = resolveCursorCreateOptions({
    preference: 'auto',
    cwd: '/repo',
    repoUrl: 'git@github.com:acme/app.git'
  })
  assert.equal(shape.kind, 'cloud')
})

test('cursorAgent.ts exposes resolve + cloud create path', async () => {
  const source = await readFile(join(__dirname, '../electron/main/cursorAgent.ts'), 'utf8')
  assert.match(source, /export function resolveCursorCreateOptions/)
  assert.match(source, /createInput\.cloud = shape\.cloud/)
  assert.match(source, /detectGithubRemoteUrl/)
})

test('api.ts wires cursor_runtime into runCursorAgent', async () => {
  const source = await readFile(join(__dirname, '../electron/main/api.ts'), 'utf8')
  assert.match(source, /cursor_runtime/)
  assert.match(source, /runtime,\s*\n\s*autoCreatePR/)
  assert.match(source, /result\.runtime === 'cloud'/)
})
