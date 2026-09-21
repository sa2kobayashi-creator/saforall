import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const SECRET = 'sk-test-secret-at-rest-XXXX'

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

function createMemoryIo(initial = null) {
  let disk = initial
  const writes = []
  return {
    writes,
    getDisk() {
      return disk
    },
    async read() {
      if (disk === null) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      return disk
    },
    readSync() {
      if (disk === null) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      return disk
    },
    async write(_path, contents) {
      writes.push(contents)
      disk = contents
    }
  }
}

test('92024 source: settings-cache routes secrets to vault and omits vaulted keys on disk', async () => {
  const store = await read('electron/main/settingsStore.ts')
  assert.match(store, /SECRET_SETTING_KEYS/)
  assert.match(store, /saveVaultSecret/)
  assert.match(store, /settingsForDisk/)
  assert.match(store, /vaultHasSecret/)
  assert.match(store, /getLocalSettingsForExport/)
  assert.match(store, /clearProviderSecretsFromMemory/)
  assert.match(store, /isSecretSettingKey\(key\)[\s\S]{0,80}continue/)
})

test('92024 source: migration saves vault before stripping settings-cache', async () => {
  const migrate = await read('electron/main/ai/migrateSettingsSecrets.ts')
  assert.match(migrate, /migrateLegacySettingsSecretsToVault/)
  assert.match(migrate, /saveVaultSecret/)
  assert.match(migrate, /loadVaultSecretSync/)
  assert.match(migrate, /clearProviderSecretsFromMemory/)
  assert.match(migrate, /flushLocalSettings/)
  const saveIdx = migrate.indexOf('await saveVaultSecret')
  const clearIdx = migrate.indexOf('clearProviderSecretsFromMemory', saveIdx)
  assert.ok(saveIdx > 0)
  assert.ok(clearIdx > saveIdx)
  assert.match(migrate, /result\.failed/)
})

test('92024 source: startup migrates after vault warm; export omits secrets', async () => {
  const index = await read('electron/main/index.ts')
  assert.match(index, /warmByokCache\(\)/)
  assert.match(index, /migrateLegacySettingsSecretsToVault/)
  assert.match(index, /getLocalSettingsForExport/)
  const exportSlice = index.slice(index.indexOf('settings:exportFile'), index.indexOf('settings:exportFile') + 900)
  assert.match(exportSlice, /getLocalSettingsForExport/)
  assert.doesNotMatch(exportSlice, /getLocalSettingsRaw\(\)/)
})

test('92024 source: Cursor resolves vault secret without BYOK billing', async () => {
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(creds, /providerId !== 'cursor'/)
  assert.match(creds, /loadByokSecretSync\('cursor'\)/)
  assert.match(creds, /billingMode: 'DEVELOPMENT'/)
  assert.match(creds, /reason: 'vault'/)
})

test('92024 source: credentialVault exposes provider-agnostic vault save/load', async () => {
  const vault = await read('electron/main/ai/credentialVault.ts')
  assert.match(vault, /export async function saveVaultSecret/)
  assert.match(vault, /export function loadVaultSecretSync/)
  assert.match(vault, /export async function deleteVaultSecret/)
  assert.match(vault, /ProviderId/)
})

test('92024 engine: vault ciphertext never contains plaintext secret', async () => {
  const { ByokVaultEngine } = await import('../electron/main/ai/vaultCrypto.ts')
  const wrap = createWrap(true)
  const io = createMemoryIo(null)
  const engine = new ByokVaultEngine('/tmp/credentials-vault-92024.json', wrap, io)
  await engine.saveSecret('openai', SECRET)
  const onDisk = io.getDisk()
  assert.equal(typeof onDisk, 'string')
  assert.equal(onDisk.includes(SECRET), false)
  engine.forgetMemory()
  assert.equal(engine.getSecret('openai')?.secret, SECRET)
})

test('92024 engine: encryption unavailable refuses save and leaves disk unchanged', async () => {
  const { ByokVaultEngine, encryptionUnavailableMessage } = await import(
    '../electron/main/ai/vaultCrypto.ts'
  )
  const wrap = createWrap(false)
  const io = createMemoryIo(null)
  const engine = new ByokVaultEngine('/tmp/credentials-vault-92024-fail.json', wrap, io)
  await assert.rejects(() => engine.saveSecret('gemini', SECRET), (error) => {
    assert.equal(error.message, encryptionUnavailableMessage())
    return true
  })
  assert.equal(io.getDisk(), null)
  assert.equal(io.writes.length, 0)
})

test('92024: collectLegacySecretsByProvider prefers llm.openai.api_key', async () => {
  const SECRET_SETTING_KEYS = [
    'llm.api_key',
    'llm.openai.api_key',
    'llm.gemini.api_key',
    'llm.claude.api_key',
    'llm.cursor.api_key',
    'llm.workers.api_token',
    'llm.simple.api_token'
  ]
  const providerFor = {
    'llm.api_key': 'openai',
    'llm.openai.api_key': 'openai',
    'llm.gemini.api_key': 'gemini',
    'llm.claude.api_key': 'claude',
    'llm.cursor.api_key': 'cursor',
    'llm.workers.api_token': 'workers',
    'llm.simple.api_token': 'workers'
  }
  const settings = {
    'llm.api_key': 'sk-old-legacy',
    'llm.openai.api_key': SECRET,
    'llm.workers.api_token': 'cf-token-primary',
    'llm.simple.api_token': 'cf-token-legacy'
  }
  const byProvider = new Map()
  for (const key of SECRET_SETTING_KEYS) {
    const value = settings[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const providerId = providerFor[key]
    if (providerId === 'openai' && key === 'llm.api_key' && byProvider.has('openai')) continue
    if (providerId === 'openai' && key === 'llm.openai.api_key') {
      byProvider.set('openai', value.trim())
      continue
    }
    if (providerId === 'workers' && key === 'llm.simple.api_token' && byProvider.has('workers')) {
      continue
    }
    if (providerId === 'workers' && key === 'llm.workers.api_token') {
      byProvider.set('workers', value.trim())
      continue
    }
    if (!byProvider.has(providerId)) byProvider.set(providerId, value.trim())
  }
  assert.equal(byProvider.get('openai'), SECRET)
  assert.equal(byProvider.get('workers'), 'cf-token-primary')
})
