import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ProviderId } from './ai/types'
import {
  hasByokRecord,
  isVaultConfigured,
  loadVaultSecretSync
} from './ai/credentialVault'

export const SECRET_SETTING_KEYS = [
  'llm.api_key',
  'llm.openai.api_key',
  'llm.gemini.api_key',
  'llm.claude.api_key',
  'llm.grok.api_key',
  'llm.deepseek.api_key',
  'llm.cursor.api_key',
  'llm.workers.api_token',
  'llm.simple.api_token'
] as const

type SecretKey = (typeof SECRET_SETTING_KEYS)[number]

const SECRET_KEY_TO_PROVIDER: Record<SecretKey, ProviderId> = {
  'llm.api_key': 'openai',
  'llm.openai.api_key': 'openai',
  'llm.gemini.api_key': 'gemini',
  'llm.claude.api_key': 'claude',
  'llm.grok.api_key': 'grok',
  'llm.deepseek.api_key': 'deepseek',
  'llm.cursor.api_key': 'cursor',
  'llm.workers.api_token': 'workers',
  'llm.simple.api_token': 'workers'
}

export type SettingsMap = Record<string, string>

type PersistShape = {
  version: 1
  savedAt: number
  settings: SettingsMap
  dirty?: boolean
}

let storePath: string | null = null
let memory: SettingsMap = {}
let dirty = false
let loaded = false

export function configureSettingsStore(filePath: string): void {
  storePath = filePath
}

export function isSecretSettingKey(key: string): key is SecretKey {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key)
}

export function providerForSecretKey(key: string): ProviderId | null {
  if (!isSecretSettingKey(key)) return null
  return SECRET_KEY_TO_PROVIDER[key]
}

export function secretKeysForProvider(providerId: ProviderId): SecretKey[] {
  return SECRET_SETTING_KEYS.filter((key) => SECRET_KEY_TO_PROVIDER[key] === providerId)
}

function envTrim(name: string): string {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function vaultHasSecret(providerId: ProviderId): boolean {
  try {
    if (!isVaultConfigured()) return false
    if (loadVaultSecretSync(providerId)?.secret) return true
    return hasByokRecord(providerId)
  } catch {
    return false
  }
}

function credentialSource(
  settingsValue: string | undefined,
  envNames: string[],
  providerId: ProviderId
): string {
  if (vaultHasSecret(providerId)) return 'byok'
  if (settingsValue && settingsValue.trim()) return 'settings'
  if (envNames.some((name) => envTrim(name))) return 'env'
  return ''
}

function providerSecretPresent(providerId: ProviderId, settings: SettingsMap): boolean {
  if (vaultHasSecret(providerId)) return true
  return secretKeysForProvider(providerId).some((key) => Boolean(settings[key]?.trim()))
}

/** Mask secrets for renderer — never return raw API keys. */
export function maskSettingsForRenderer(settings: SettingsMap): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (isSecretSettingKey(key)) continue
    out[key] = value
  }
  const openaiSettings = providerSecretPresent('openai', settings)
  const openaiEnv = Boolean(envTrim('OPENAI_API_KEY') || envTrim('SAFORALL_API_KEY'))
  out['llm.api_key_set'] = openaiSettings || openaiEnv
  out['llm.openai.api_key_set'] = openaiSettings || openaiEnv
  out['llm.gemini.api_key_set'] =
    providerSecretPresent('gemini', settings) || Boolean(envTrim('GEMINI_API_KEY'))
  out['llm.claude.api_key_set'] =
    providerSecretPresent('claude', settings) || Boolean(envTrim('ANTHROPIC_API_KEY'))
  out['llm.grok.api_key_set'] =
    providerSecretPresent('grok', settings) || Boolean(envTrim('XAI_API_KEY'))
  out['llm.deepseek.api_key_set'] =
    providerSecretPresent('deepseek', settings) || Boolean(envTrim('DEEPSEEK_API_KEY'))
  out['llm.cursor.api_key_set'] =
    providerSecretPresent('cursor', settings) || Boolean(envTrim('CURSOR_API_KEY'))
  const workersPresent =
    providerSecretPresent('workers', settings) || Boolean(envTrim('CLOUDFLARE_API_TOKEN'))
  out['llm.workers.api_token_set'] = workersPresent
  out['llm.simple.api_token_set'] = workersPresent
  out['llm.openai.credential_source'] = credentialSource(
    settings['llm.openai.api_key'] || settings['llm.api_key'],
    ['OPENAI_API_KEY', 'SAFORALL_API_KEY'],
    'openai'
  )
  out['llm.gemini.credential_source'] = credentialSource(
    settings['llm.gemini.api_key'],
    ['GEMINI_API_KEY'],
    'gemini'
  )
  out['llm.claude.credential_source'] = credentialSource(
    settings['llm.claude.api_key'],
    ['ANTHROPIC_API_KEY'],
    'claude'
  )
  out['llm.grok.credential_source'] = credentialSource(
    settings['llm.grok.api_key'],
    ['XAI_API_KEY'],
    'grok'
  )
  out['llm.deepseek.credential_source'] = credentialSource(
    settings['llm.deepseek.api_key'],
    ['DEEPSEEK_API_KEY'],
    'deepseek'
  )
  out['llm.cursor.credential_source'] = credentialSource(
    settings['llm.cursor.api_key'],
    ['CURSOR_API_KEY'],
    'cursor'
  )
  out['llm.workers.credential_source'] = credentialSource(
    settings['llm.workers.api_token'] || settings['llm.simple.api_token'],
    ['CLOUDFLARE_API_TOKEN'],
    'workers'
  )
  return out
}

export function hasUsableLocalLlm(settings: SettingsMap = memory): boolean {
  return Boolean(
    providerSecretPresent('openai', settings) ||
      providerSecretPresent('claude', settings) ||
      providerSecretPresent('gemini', settings) ||
      providerSecretPresent('grok', settings) ||
      providerSecretPresent('deepseek', settings) ||
      providerSecretPresent('cursor', settings) ||
      providerSecretPresent('workers', settings) ||
      envTrim('OPENAI_API_KEY') ||
      envTrim('GEMINI_API_KEY') ||
      envTrim('ANTHROPIC_API_KEY') ||
      envTrim('XAI_API_KEY') ||
      envTrim('DEEPSEEK_API_KEY') ||
      envTrim('CURSOR_API_KEY') ||
      envTrim('CLOUDFLARE_API_TOKEN')
  )
}

export async function ensureSettingsLoaded(): Promise<SettingsMap> {
  if (loaded) return memory
  if (!storePath) {
    loaded = true
    return memory
  }
  try {
    const raw = await readFile(storePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistShape
    if (parsed?.version === 1 && parsed.settings && typeof parsed.settings === 'object') {
      memory = { ...parsed.settings }
      dirty = Boolean(parsed.dirty)
    }
  } catch {
    memory = {}
    dirty = false
  }
  loaded = true
  return memory
}

/**
 * Disk payload omits secrets already confirmed in the vault.
 * Unmigrated secrets remain on disk until vault save succeeds (migration safety).
 */
function settingsForDisk(): SettingsMap {
  const out: SettingsMap = {}
  for (const [key, value] of Object.entries(memory)) {
    if (isSecretSettingKey(key)) {
      const providerId = SECRET_KEY_TO_PROVIDER[key]
      if (vaultHasSecret(providerId)) continue
    }
    out[key] = value
  }
  return out
}

async function flush(): Promise<void> {
  if (!storePath) return
  await mkdir(dirname(storePath), { recursive: true })
  const payload: PersistShape = {
    version: 1,
    savedAt: Date.now(),
    settings: settingsForDisk(),
    dirty
  }
  await writeFile(storePath, JSON.stringify(payload, null, 2), 'utf-8')
}

export async function flushLocalSettings(): Promise<void> {
  await flush()
}

export function clearProviderSecretsFromMemory(providerId: ProviderId): void {
  for (const key of secretKeysForProvider(providerId)) {
    delete memory[key]
  }
}

function collectPatchSecretsByProvider(patch: SettingsMap): Map<ProviderId, string> {
  const byProvider = new Map<ProviderId, string>()
  for (const [key, value] of Object.entries(patch)) {
    if (!isSecretSettingKey(key)) continue
    if (typeof value !== 'string' || value.trim() === '') continue
    const providerId = SECRET_KEY_TO_PROVIDER[key]
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
  return byProvider
}

async function persistPatchSecretsToVault(patch: SettingsMap): Promise<void> {
  const byProvider = collectPatchSecretsByProvider(patch)
  if (byProvider.size === 0) return
  const vault = await import('./ai/credentialVault')
  if (!vault.isVaultConfigured()) {
    throw new Error('Credential vault が未初期化のため API Key を保存できません')
  }
  for (const [providerId, secret] of Array.from(byProvider.entries())) {
    await vault.saveVaultSecret(providerId, secret)
    const confirmed = vault.loadVaultSecretSync(providerId)
    if (!confirmed?.secret) {
      throw new Error(`${providerId} の API Key を vault へ保存できませんでした`)
    }
    clearProviderSecretsFromMemory(providerId)
  }
}

/**
 * Merge patch into local store.
 * Secret keys are routed to the encrypted vault and never written to settings-cache once vaulted.
 */
export async function mergeLocalSettings(
  patch: SettingsMap,
  options?: { markDirty?: boolean }
): Promise<SettingsMap> {
  await ensureSettingsLoaded()
  await persistPatchSecretsToVault(patch)
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string') continue
    if (isSecretSettingKey(key)) continue
    memory[key] = value
  }
  if (options?.markDirty) dirty = true
  await flush()
  return memory
}

export async function getLocalSettingsRaw(): Promise<SettingsMap> {
  return { ...(await ensureSettingsLoaded()) }
}

/** Export/sync payload without plaintext secrets. */
export async function getLocalSettingsForExport(): Promise<SettingsMap> {
  const raw = await getLocalSettingsRaw()
  const out: SettingsMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isSecretSettingKey(key)) continue
    out[key] = value
  }
  return out
}

export async function getLocalSettingsMasked(): Promise<Record<string, string | boolean>> {
  return maskSettingsForRenderer(await ensureSettingsLoaded())
}

export function getLocalSecret(key: SecretKey | string): string {
  return memory[key] ?? ''
}

export function getOpenAiKey(): string {
  try {
    const fromVault = loadVaultSecretSync('openai')?.secret
    if (fromVault) return fromVault
  } catch {
    // fall through
  }
  return (
    memory['llm.openai.api_key'] ||
    memory['llm.api_key'] ||
    envTrim('OPENAI_API_KEY') ||
    envTrim('SAFORALL_API_KEY')
  )
}

export function getLocalSetting(key: string, fallback = ''): string {
  return memory[key] ?? fallback
}

export function isLocalSettingsDirty(): boolean {
  return dirty
}

export async function markLocalSettingsClean(): Promise<void> {
  dirty = false
  await flush()
}

/** Test helper — reset in-memory state. */
export function resetSettingsStoreForTests(): void {
  memory = {}
  dirty = false
  loaded = false
  storePath = null
}
