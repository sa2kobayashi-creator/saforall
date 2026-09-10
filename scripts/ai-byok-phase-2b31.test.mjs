import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const SECRET = 'sk-test-byok-phase-2b31-XXXX'

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

function createWrap(available = true) {
  return {
    available,
    isAvailable() {
      return this.available
    },
    wrap(plain) {
      return Buffer.from(plain, 'utf8').toString('base64')
    },
    unwrap(wrapped) {
      return Buffer.from(wrapped, 'base64').toString('utf8')
    }
  }
}

function enoent() {
  const error = new Error('ENOENT')
  error.code = 'ENOENT'
  return error
}

function createMemoryIo(initial = null) {
  let disk = initial
  return {
    async read() {
      if (disk === null) throw enoent()
      return disk
    },
    readSync() {
      if (disk === null) throw enoent()
      return disk
    },
    async write(_path, contents) {
      disk = contents
    }
  }
}

test('Phase 2-B-3-1: public credential fields include id/billingMode/createdAt without secret', async () => {
  const { ByokVaultEngine } = await import('../electron/main/ai/vaultCrypto.ts')
  const engine = new ByokVaultEngine('/tmp/cred-2b31.json', createWrap(true), createMemoryIo(null))
  const status = await engine.saveSecret('openai', SECRET)
  assert.equal(status.configured, true)
  assert.equal(status.billingMode, 'BYOK')
  assert.equal(typeof status.credentialId, 'string')
  assert.match(status.credentialId, /^byok_openai_/)
  assert.equal(typeof status.createdAt, 'string')
  assert.ok(status.createdAt.length > 0)
  assert.equal(status.fingerprint, 'XXXX')
  assert.equal(JSON.stringify(status).includes(SECRET), false)
  assert.doesNotMatch(JSON.stringify(status), /Authorization|Bearer|cipher/)
})

test('Phase 2-B-3-1: ByokPublicStatus exposes credential metadata; keeps ByokUiStatus', async () => {
  const vault = await read('electron/main/ai/credentialVault.ts')
  assert.match(vault, /credentialId/)
  assert.match(vault, /billingMode/)
  assert.match(vault, /createdAt/)
  assert.match(vault, /ByokUiStatus = 'not_configured' \| 'saved' \| 'connected' \| 'failed'/)
  assert.doesNotMatch(vault, /export type ByokUiStatus = 'CONNECTED/)
})

test('Phase 2-B-3-1: hasUsableByokLlm requires decryptable BYOK secret', async () => {
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(creds, /hasUsableByokLlm/)
  assert.match(creds, /loadByokSecretSync\(id\)/)
  assert.doesNotMatch(creds, /hasByokRecord\(id\) \|\| Boolean\(loadByokSecretSync/)
})

test('Phase 2-B-3-1: health check updates lastVerifiedAt via markByokTestResult', async () => {
  const ipc = await read('electron/main/ai/byokIpc.ts')
  const vault = await read('electron/main/ai/credentialVault.ts')
  assert.match(ipc, /healthCheck\(/)
  assert.match(ipc, /markByokTestResult/)
  assert.match(vault, /markByokTestResult/)
  assert.match(vault, /lastVerifiedAt/)
})

test('Phase 2-B-3-1: Resolver priority and Cursor exclusion unchanged', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  assert.equal(pickCredentialPriority(SECRET, 'sk-settings', 'sk-env').source, 'byok')
  assert.equal(pickCredentialPriority('', 'sk-settings', 'sk-env').source, 'settings')
  assert.equal(pickCredentialPriority('', '', 'sk-env').source, 'env')
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(creds, /providerId !== 'cursor'/)
  const cursor = await read('electron/main/cursorAgent.ts')
  assert.match(cursor, /@cursor\/sdk/)
  assert.doesNotMatch(cursor, /executeAiWithTools/)
})

test('Phase 2-B-3-1: Renderer IPC types include credentialId; no secret accessors', async () => {
  const preload = await read('electron/preload/index.ts')
  assert.match(preload, /credentialId: string \| null/)
  assert.match(preload, /billingMode: 'BYOK' \| null/)
  assert.doesNotMatch(preload, /getByokSecret|decryptByok/)
})
