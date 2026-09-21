import {
  SECRET_SETTING_KEYS,
  clearProviderSecretsFromMemory,
  ensureSettingsLoaded,
  flushLocalSettings,
  getLocalSettingsRaw,
  providerForSecretKey,
  type SettingsMap
} from '../settingsStore'
import {
  isVaultConfigured,
  loadVaultSecretSync,
  saveVaultSecret
} from './credentialVault'
import type { ProviderId } from './types'

export type MigrateSecretsResult = {
  migrated: ProviderId[]
  alreadyVaulted: ProviderId[]
  failed: ProviderId[]
}

/** Collect non-empty plaintext secrets from a settings map, keyed by provider. */
export function collectLegacySecretsByProvider(settings: SettingsMap): Map<ProviderId, string> {
  const byProvider = new Map<ProviderId, string>()
  for (const key of SECRET_SETTING_KEYS) {
    const value = settings[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const providerId = providerForSecretKey(key)
    if (!providerId) continue
    // Prefer llm.openai.api_key over legacy llm.api_key when both exist.
    if (providerId === 'openai' && key === 'llm.api_key' && byProvider.has('openai')) {
      continue
    }
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
    if (!byProvider.has(providerId)) {
      byProvider.set(providerId, value.trim())
    }
  }
  return byProvider
}

/**
 * One-time-safe migration: vault save succeeds before settings-cache secrets are removed.
 * On vault failure, plaintext secrets remain in settings-cache so the user does not lose keys.
 */
export async function migrateLegacySettingsSecretsToVault(): Promise<MigrateSecretsResult> {
  await ensureSettingsLoaded()
  const result: MigrateSecretsResult = {
    migrated: [],
    alreadyVaulted: [],
    failed: []
  }
  if (!isVaultConfigured()) {
    return result
  }

  const settings = await getLocalSettingsRaw()
  const byProvider = collectLegacySecretsByProvider(settings)
  if (byProvider.size === 0) {
    return result
  }

  let stripped = false
  for (const [providerId, secret] of Array.from(byProvider.entries())) {
    const existing = loadVaultSecretSync(providerId)
    if (existing?.secret) {
      clearProviderSecretsFromMemory(providerId)
      stripped = true
      result.alreadyVaulted.push(providerId)
      continue
    }
    try {
      await saveVaultSecret(providerId, secret)
      const confirmed = loadVaultSecretSync(providerId)
      if (!confirmed?.secret) {
        result.failed.push(providerId)
        continue
      }
      clearProviderSecretsFromMemory(providerId)
      stripped = true
      result.migrated.push(providerId)
    } catch {
      result.failed.push(providerId)
    }
  }

  if (stripped) {
    await flushLocalSettings()
  }
  return result
}
