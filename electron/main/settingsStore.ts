import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'

export const SECRET_SETTING_KEYS = [
  'llm.api_key',
  'llm.openai.api_key',
  'llm.gemini.api_key',
  'llm.claude.api_key',
  'llm.cursor.api_key',
  'llm.workers.api_token',
  'llm.simple.api_token'
] as const

type SecretKey = (typeof SECRET_SETTING_KEYS)[number]

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

export function isSecretSettingKey(key: string): boolean {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key)
}

/** Mask secrets for renderer — never return raw API keys. */
export function maskSettingsForRenderer(settings: SettingsMap): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (isSecretSettingKey(key)) continue
    out[key] = value
  }
  out['llm.api_key_set'] = Boolean(settings['llm.api_key'] || settings['llm.openai.api_key'])
  out['llm.openai.api_key_set'] = Boolean(settings['llm.openai.api_key'] || settings['llm.api_key'])
  out['llm.gemini.api_key_set'] = Boolean(settings['llm.gemini.api_key'])
  out['llm.claude.api_key_set'] = Boolean(settings['llm.claude.api_key'])
  out['llm.cursor.api_key_set'] = Boolean(settings['llm.cursor.api_key'])
  out['llm.workers.api_token_set'] = Boolean(
    settings['llm.workers.api_token'] || settings['llm.simple.api_token']
  )
  out['llm.simple.api_token_set'] = Boolean(
    settings['llm.simple.api_token'] || settings['llm.workers.api_token']
  )
  return out
}

export function hasUsableLocalLlm(settings: SettingsMap = memory): boolean {
  return Boolean(
    settings['llm.openai.api_key'] ||
      settings['llm.api_key'] ||
      settings['llm.claude.api_key'] ||
      settings['llm.gemini.api_key'] ||
      settings['llm.cursor.api_key']
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

async function flush(): Promise<void> {
  if (!storePath) return
  await mkdir(dirname(storePath), { recursive: true })
  const payload: PersistShape = {
    version: 1,
    savedAt: Date.now(),
    settings: memory,
    dirty
  }
  await writeFile(storePath, JSON.stringify(payload, null, 2), 'utf-8')
}

/** Merge patch into local store. Empty secret values are skipped (keep previous). */
export async function mergeLocalSettings(
  patch: SettingsMap,
  options?: { markDirty?: boolean }
): Promise<SettingsMap> {
  await ensureSettingsLoaded()
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string') continue
    if (isSecretSettingKey(key) && value.trim() === '') continue
    memory[key] = value
  }
  if (options?.markDirty) dirty = true
  await flush()
  return memory
}

export async function getLocalSettingsRaw(): Promise<SettingsMap> {
  return { ...(await ensureSettingsLoaded()) }
}

export async function getLocalSettingsMasked(): Promise<Record<string, string | boolean>> {
  return maskSettingsForRenderer(await ensureSettingsLoaded())
}

export function getLocalSecret(key: SecretKey | string): string {
  return memory[key] ?? ''
}

export function getOpenAiKey(): string {
  return memory['llm.openai.api_key'] || memory['llm.api_key'] || ''
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
