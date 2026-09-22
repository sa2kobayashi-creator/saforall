import { getLocalSetting } from '../settingsStore'
import { pickDevelopmentSecret } from './credentialLogic'
import { loadByokSecretSync } from './credentialVault'
import {
  LLM_PROVIDER_IDS,
  PROVIDER_NAMES,
  isLlmProviderId,
  type BillingMode,
  type Credential,
  type CredentialSource,
  type ProviderId,
  type ResolveInput,
  type ResolveResult
} from './types'
import { AIError } from './errors'

/**
 * Existing env names (do not invent new ones):
 * OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY,
 * CLOUDFLARE_API_TOKEN, CURSOR_API_KEY, SAFORALL_API_KEY
 */
export const PROVIDER_ENV: Record<ProviderId, string[]> = {
  openai: ['OPENAI_API_KEY', 'SAFORALL_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  workers: ['CLOUDFLARE_API_TOKEN'],
  grok: ['XAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  cursor: ['CURSOR_API_KEY']
}

export type CredentialDeps = {
  getSetting: (key: string, fallback?: string) => string
  getEnv: (name: string) => string
}

const defaultDeps: CredentialDeps = {
  getSetting: (key, fallback = '') => getLocalSetting(key, fallback),
  getEnv: (name) => {
    const value = process.env[name]
    return typeof value === 'string' ? value.trim() : ''
  }
}

let activeDeps: CredentialDeps = defaultDeps

export function configureCredentialDeps(deps: CredentialDeps | null): void {
  activeDeps = deps ?? defaultDeps
}

export function resetCredentialDepsForTests(): void {
  activeDeps = defaultDeps
}

function envValue(providerId: ProviderId): string {
  for (const name of PROVIDER_ENV[providerId]) {
    const value = activeDeps.getEnv(name)
    if (value) return value
  }
  return ''
}

function settingsSecret(providerId: ProviderId): string {
  if (providerId === 'openai') {
    return (
      activeDeps.getSetting('llm.openai.api_key') || activeDeps.getSetting('llm.api_key')
    )
  }
  if (providerId === 'gemini') return activeDeps.getSetting('llm.gemini.api_key')
  if (providerId === 'claude') return activeDeps.getSetting('llm.claude.api_key')
  if (providerId === 'grok') return activeDeps.getSetting('llm.grok.api_key')
  if (providerId === 'deepseek') return activeDeps.getSetting('llm.deepseek.api_key')
  if (providerId === 'cursor') return activeDeps.getSetting('llm.cursor.api_key')
  return (
    activeDeps.getSetting('llm.workers.api_token') ||
    activeDeps.getSetting('llm.simple.api_token')
  )
}

function defaultBaseUrl(providerId: ProviderId): string {
  if (providerId === 'openai') {
    return (
      activeDeps.getSetting('llm.openai.base_url') ||
      activeDeps.getSetting('llm.base_url', 'https://api.openai.com/v1')
    )
  }
  if (providerId === 'claude') {
    return activeDeps.getSetting('llm.claude.base_url', 'https://api.anthropic.com')
  }
  if (providerId === 'gemini') return 'gemini-native'
  if (providerId === 'grok') {
    return activeDeps.getSetting('llm.grok.base_url', 'https://api.x.ai/v1')
  }
  if (providerId === 'deepseek') {
    return activeDeps.getSetting('llm.deepseek.base_url', 'https://api.deepseek.com')
  }
  if (providerId === 'workers') {
    const accountId =
      activeDeps.getSetting('llm.workers.account_id') ||
      activeDeps.getSetting('llm.simple.account_id')
    if (!accountId) return ''
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`
  }
  return ''
}

function extraFor(providerId: ProviderId): Record<string, string> {
  if (providerId !== 'workers') return {}
  const gateway =
    activeDeps.getSetting('llm.workers.gateway_id') ||
    activeDeps.getSetting('llm.simple.gateway_id', 'default')
  const accountId =
    activeDeps.getSetting('llm.workers.account_id') ||
    activeDeps.getSetting('llm.simple.account_id')
  return {
    accountId,
    gatewayId: gateway || 'default'
  }
}

/**
 * Development machine secrets: Settings UI keys first, then existing env vars.
 */
export function loadDevelopmentCredential(providerId: ProviderId): Credential | null {
  const picked = pickDevelopmentSecret(settingsSecret(providerId), envValue(providerId))
  if (!picked.secret) return null
  if (providerId === 'workers') {
    const extra = extraFor(providerId)
    if (!extra.accountId) return null
  }
  return {
    id: `dev:${providerId}`,
    providerId,
    ownerType: 'development',
    billingMode: 'DEVELOPMENT',
    source: picked.source,
    secret: picked.secret,
    baseUrl: defaultBaseUrl(providerId),
    extra: extraFor(providerId)
  }
}

function loadByokCredential(providerId: ProviderId): Credential | null {
  if (!isLlmProviderId(providerId)) return null
  const stored = loadByokSecretSync(providerId)
  if (!stored) return null
  return {
    id: stored.id,
    providerId,
    ownerType: 'user',
    billingMode: 'BYOK',
    source: 'byok',
    secret: stored.secret,
    baseUrl: stored.baseUrl || defaultBaseUrl(providerId),
    extra: { ...stored.extra, ...extraFor(providerId) }
  }
}

/**
 * Priority: BYOK → Development settings → Development env.
 * Cursor is never billed as BYOK, but its API key may live in the encrypted vault
 * (migrated out of settings-cache) and is resolved here as a coding-agent credential.
 */
export function resolveCredential(input: ResolveInput | ProviderId): ResolveResult {
  const providerId = typeof input === 'string' ? input : input.providerId
  if (providerId !== 'cursor') {
    const byok = loadByokCredential(providerId)
    if (byok) {
      return {
        credential: byok,
        available: true,
        billingMode: 'BYOK',
        reason: 'byok'
      }
    }
  } else {
    const stored = loadByokSecretSync('cursor')
    if (stored?.secret) {
      return {
        credential: {
          id: stored.id,
          providerId: 'cursor',
          ownerType: 'user',
          billingMode: 'DEVELOPMENT',
          source: 'byok',
          secret: stored.secret,
          baseUrl: stored.baseUrl || defaultBaseUrl('cursor'),
          extra: { ...stored.extra }
        },
        available: true,
        billingMode: 'DEVELOPMENT',
        reason: 'vault'
      }
    }
  }
  const credential = loadDevelopmentCredential(providerId)
  if (!credential) {
    return {
      credential: null,
      available: false,
      billingMode: 'DEVELOPMENT',
      reason: `${PROVIDER_NAMES[providerId]} の Credential がありません`
    }
  }
  return {
    credential,
    available: true,
    billingMode: credential.billingMode,
    reason: `development:${credential.source}`
  }
}

export function requireCredential(providerId: ProviderId): Credential {
  const result = resolveCredential(providerId)
  if (!result.credential) {
    throw new AIError(
      'AUTH_ERROR',
      `${PROVIDER_NAMES[providerId]} が未設定です。Settings の BYOK または開発 Credential / ${PROVIDER_ENV[providerId][0]} を確認してください。`,
      { providerId, httpStatus: 401 }
    )
  }
  return result.credential
}

export function hasUsableByokLlm(): boolean {
  // Only when vault decrypt succeeds (record presence alone is not enough).
  return LLM_PROVIDER_IDS.some((id) => Boolean(loadByokSecretSync(id)))
}

export function credentialStatus(
  providerId: ProviderId
): {
  providerId: ProviderId
  name: string
  ownerType: 'development' | 'user'
  source: CredentialSource
  connected: boolean
  billingMode: BillingMode
} {
  const resolved = resolveCredential(providerId)
  return {
    providerId,
    name: PROVIDER_NAMES[providerId],
    ownerType: resolved.credential?.ownerType === 'user' ? 'user' : 'development',
    source: resolved.credential?.source ?? '',
    connected: Boolean(resolved.credential),
    billingMode: resolved.billingMode
  }
}

export function extraHeadersFor(credential: Credential): string[] {
  if (credential.providerId !== 'workers') return []
  const gateway = credential.extra.gatewayId || 'default'
  return [`cf-aig-gateway-id: ${gateway}`]
}
