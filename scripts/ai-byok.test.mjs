import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const SECRET = 'sk-test-byok-not-a-real-key-XXXX'
const SETTINGS_SECRET = 'sk-dev-settings-only-aaaa'

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

function healthCheckSlice(src) {
  const start = src.indexOf('async healthCheck')
  assert.notEqual(start, -1)
  return src.slice(start)
}

function enoent() {
  const error = new Error('ENOENT')
  error.code = 'ENOENT'
  return error
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

function createMemoryIo(initial = null) {
  let disk = initial
  const writes = []
  return {
    writes,
    getDisk() {
      return disk
    },
    setDisk(value) {
      disk = value
    },
    async read() {
      if (disk === null) throw enoent()
      return disk
    },
    readSync() {
      if (disk === null) throw enoent()
      return disk
    },
    async write(_path, contents) {
      writes.push(contents)
      disk = contents
    }
  }
}

async function createEngine(options = {}) {
  const { ByokVaultEngine } = await import('../electron/main/ai/vaultCrypto.ts')
  const wrap = options.wrap ?? createWrap(true)
  const io = options.io ?? createMemoryIo(null)
  const engine = new ByokVaultEngine(options.path ?? '/tmp/credentials-vault.json', wrap, io)
  return { engine, wrap, io }
}

test('AES-256-GCM encrypts secrets; fingerprint is last 4 chars only', async () => {
  const { fingerprintSecret, encryptUtf8, decryptUtf8, generateDek } = await import(
    '../electron/main/ai/vaultCrypto.ts'
  )
  const dek = generateDek()
  const cipher = encryptUtf8(dek, SECRET)
  assert.equal(cipher.alg, 'AES-256-GCM')
  assert.equal(cipher.iv.length > 0, true)
  assert.equal(cipher.tag.length > 0, true)
  assert.equal(cipher.data.includes(SECRET), false)
  assert.equal(decryptUtf8(dek, cipher), SECRET)
  assert.equal(fingerprintSecret(SECRET), 'XXXX')
})

test('A: safeStorage unavailable refuses save and does not change vault', async () => {
  const { encryptionUnavailableMessage } = await import('../electron/main/ai/vaultCrypto.ts')
  const wrap = createWrap(false)
  const io = createMemoryIo(null)
  const { engine } = await createEngine({ wrap, io })
  await assert.rejects(() => engine.saveSecret('openai', SECRET), (error) => {
    assert.match(String(error.message), /safeStorage/)
    assert.equal(error.message, encryptionUnavailableMessage())
    return true
  })
  assert.equal(io.writes.length, 0)
  assert.equal(io.getDisk(), null)
})

test('B: wrong authentication tag fails decrypt and does not return secret', async () => {
  const { decryptUtf8, dekFromBase64 } = await import('../electron/main/ai/vaultCrypto.ts')
  const { engine, wrap, io } = await createEngine()
  await engine.saveSecret('openai', SECRET)
  const parsed = JSON.parse(io.getDisk())
  const tampered = {
    ...parsed.records[0].cipher,
    tag: Buffer.from('00000000000000000000000000000000', 'hex').toString('base64')
  }
  parsed.records[0].cipher = tampered
  io.setDisk(JSON.stringify(parsed))
  engine.forgetMemory()
  assert.equal(engine.getSecret('openai'), null)
  const dek = dekFromBase64(wrap.unwrap(parsed.wrappedDek))
  assert.throws(() => decryptUtf8(dek, tampered))
})

test('C: corrupt vault JSON is not persisted as empty vault', async () => {
  const { engine, io } = await createEngine()
  await engine.saveSecret('openai', SECRET)
  const original = io.getDisk()
  assert.equal(original.includes(SECRET), false)
  io.setDisk('{not-valid-json')
  engine.forgetMemory()
  await assert.rejects(() => engine.saveSecret('openai', 'sk-new-key-yyyyyyyy'), /破損|読み取れない/)
  assert.equal(io.getDisk(), '{not-valid-json')
  assert.equal(engine.loadState(), 'unreadable')
})

test('D: save/delete while vault is unreadable do not overwrite existing vault', async () => {
  const { engine, io } = await createEngine()
  await engine.saveSecret('claude', SECRET)
  const original = io.getDisk()
  const writeCount = io.writes.length
  io.setDisk('{"broken":true}')
  engine.forgetMemory()
  await assert.rejects(() => engine.deleteSecret('claude'), /破損|読み取れない/)
  await assert.rejects(() => engine.saveSecret('openai', 'sk-another-key-zzzzzzzz'), /破損|読み取れない/)
  assert.equal(io.getDisk(), '{"broken":true}')
  assert.equal(io.writes.length, writeCount)
  assert.equal(original.includes('"claude"'), true)
})

test('E: Resolver before warm cache still uses BYOK from vault', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  const { engine } = await createEngine()
  await engine.saveSecret('openai', SECRET)
  engine.forgetMemory()
  assert.equal(engine.loadState(), 'unloaded')
  const stored = engine.getSecret('openai')
  assert.equal(stored?.secret, SECRET)
  const picked = pickCredentialPriority(stored.secret, SETTINGS_SECRET, 'sk-env-bbbbbbbb')
  assert.equal(picked.source, 'byok')
  assert.equal(picked.secret, SECRET)
})

test('F: cache clear then reload decrypts BYOK', async () => {
  const { engine, io } = await createEngine()
  await engine.saveSecret('gemini', SECRET)
  const onDisk = io.getDisk()
  assert.equal(onDisk.includes(SECRET), false)
  engine.forgetMemory()
  const stored = engine.getSecret('gemini')
  assert.equal(stored?.secret, SECRET)
  assert.equal(engine.loadState(), 'ok')
})

test('G: BYOK wins over Development settings', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  const { engine } = await createEngine()
  await engine.saveSecret('openai', SECRET)
  engine.forgetMemory()
  const byok = engine.getSecret('openai')?.secret ?? ''
  const picked = pickCredentialPriority(byok, SETTINGS_SECRET, 'sk-env-bbbbbbbb')
  assert.equal(picked.source, 'byok')
})

test('H: deleting BYOK falls back to Development settings', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  const { engine } = await createEngine()
  await engine.saveSecret('openai', SECRET)
  await engine.deleteSecret('openai')
  assert.equal(engine.getSecret('openai'), null)
  const picked = pickCredentialPriority('', SETTINGS_SECRET, 'sk-env-bbbbbbbb')
  assert.equal(picked.source, 'settings')
  assert.equal(picked.secret, SETTINGS_SECRET)
})

test('I: public/IPC payloads do not include the secret', async () => {
  const { engine } = await createEngine()
  const status = await engine.saveSecret('openai', SECRET)
  const raw = JSON.stringify(status)
  assert.equal(raw.includes(SECRET), false)
  assert.equal(status.configured, true)
  assert.equal(status.fingerprint, 'XXXX')
  assert.equal(status.billingMode, 'BYOK')
  assert.match(String(status.credentialId), /^byok_openai_/)
  assert.equal(typeof status.createdAt, 'string')
  const ipc = await read('electron/main/ai/byokIpc.ts')
  const preload = await read('electron/preload/index.ts')
  assert.match(ipc, /assertNoSecretInPayload/)
  assert.doesNotMatch(preload, /getByokSecret|decryptByok/)
})

test('atomic write helper uses temp file then rename', async () => {
  const crypto = await read('electron/main/ai/vaultCrypto.ts')
  assert.match(crypto, /export async function atomicWriteUtf8/)
  assert.match(crypto, /rename\(/)
  assert.match(crypto, /\.tmp/)
})

test('source scans: on-demand decrypt, unreadable persist guard, Cursor unchanged', async () => {
  const vault = await read('electron/main/ai/credentialVault.ts')
  const crypto = await read('electron/main/ai/vaultCrypto.ts')
  const creds = await read('electron/main/ai/credentials.ts')
  const cursor = await read('electron/main/cursorAgent.ts')
  const openai = await read('electron/main/ai/adapters/openai.ts')
  const usage = await read('electron/main/ai/usage.ts')
  const settings = await read('src/components/SettingsPanel.tsx')

  assert.match(crypto, /forgetMemory/)
  assert.match(crypto, /getSecret/)
  assert.match(crypto, /VaultUnreadableError/)
  assert.match(crypto, /loadKind === 'unreadable'/)
  assert.match(vault, /engine.getSecret/)
  assert.match(creds, /providerId !== 'cursor'/)
  assert.match(creds, /loadByokSecretSync/)
  assert.match(cursor, /@cursor\/sdk/)
  assert.doesNotMatch(healthCheckSlice(openai), /\.generate\(/)
  assert.doesNotMatch(usage, /Authorization/)
  assert.match(settings, /自分の API Key（BYOK）/)
})

test('priority helper remains BYOK → settings → env', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  assert.deepEqual(pickCredentialPriority('', SETTINGS_SECRET, 'sk-env'), {
    secret: SETTINGS_SECRET,
    source: 'settings'
  })
  assert.deepEqual(pickCredentialPriority('', '', 'sk-env'), {
    secret: 'sk-env',
    source: 'env'
  })
})

test('lastVerifiedAt updates only when the test succeeds', async () => {
  const { applyByokTestResult } = await import('../electron/main/ai/vaultCrypto.ts')
  assert.deepEqual(applyByokTestResult(false, '2026-09-09T00:00:00.000Z', '2026-09-10T00:00:00.000Z'), {
    lastTestOk: false,
    lastVerifiedAt: '2026-09-09T00:00:00.000Z'
  })
})

test('real disk vault: plaintext key is absent from credentials-vault.json', async () => {
  const { ByokVaultEngine, createFsVaultIo } = await import('../electron/main/ai/vaultCrypto.ts')
  const dir = join(tmpdir(), `saforall-byok-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const vaultPath = join(dir, 'credentials-vault.json')
  try {
    const engine = new ByokVaultEngine(vaultPath, createWrap(true), createFsVaultIo())
    await engine.saveSecret('openai', SECRET)
    const vaultRaw = await readFile(vaultPath, 'utf8')
    assert.equal(vaultRaw.includes(SECRET), false)
    assert.match(vaultRaw, /AES-256-GCM/)
    engine.forgetMemory()
    assert.equal(engine.getSecret('openai')?.secret, SECRET)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
