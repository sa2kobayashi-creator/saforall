import { AIError } from './errors'
import {
  LLM_PROVIDER_IDS,
  isLlmProviderId,
  type LlmProviderId
} from './types'
import {
  ByokVaultEngine,
  LOCAL_BYOK_OWNER_ID,
  VaultUnreadableError,
  createFsVaultIo,
  encryptionUnavailableMessage,
  publicFieldsFromRecord,
  type ByokPublicFields,
  type VaultFileIo,
  type VaultRecord,
  type VaultWrapBackend
} from './vaultCrypto'

export { LOCAL_BYOK_OWNER_ID }

export type ByokUiStatus = 'not_configured' | 'saved' | 'connected' | 'failed'

export type ByokPublicStatus = {
  providerId: LlmProviderId
  configured: boolean
  fingerprint: string
  lastVerifiedAt: string | null
  lastTestOk: boolean | null
  status: ByokUiStatus
}

export type KeyWrapBackend = VaultWrapBackend

export type { VaultFileIo }

type VaultDeps = {
  filePath: string
  wrap: KeyWrapBackend
  io?: VaultFileIo
}

let engine: ByokVaultEngine | null = null

export function configureCredentialVault(next: VaultDeps | null): void {
  engine = next
    ? new ByokVaultEngine(next.filePath, next.wrap, next.io ?? createFsVaultIo())
    : null
}

export function resetCredentialVaultForTests(): void {
  engine = null
}

export function forgetVaultMemoryForTests(): void {
  engine?.forgetMemory()
}

export function isVaultConfigured(): boolean {
  return Boolean(engine)
}

function requireEngine(): ByokVaultEngine {
  if (!engine) {
    throw new AIError('AUTH_ERROR', 'Credential vault が未初期化です')
  }
  return engine
}

function mapVaultError(error: unknown, providerId?: string): never {
  if (error instanceof VaultUnreadableError) {
    throw new AIError('AUTH_ERROR', error.message, { providerId })
  }
  if (error instanceof AIError) throw error
  const message = error instanceof Error ? error.message : String(error)
  throw new AIError('AUTH_ERROR', message, { providerId })
}

function statusFromFields(fields: ByokPublicFields, providerId: LlmProviderId): ByokPublicStatus {
  let status: ByokUiStatus = 'not_configured'
  if (fields.configured) {
    status = 'saved'
    if (fields.lastTestOk === true) status = 'connected'
    else if (fields.lastTestOk === false) status = 'failed'
  }
  return {
    providerId,
    configured: fields.configured,
    fingerprint: fields.fingerprint,
    lastVerifiedAt: fields.lastVerifiedAt,
    lastTestOk: fields.lastTestOk,
    status
  }
}

export function listByokPublicSync(): ByokPublicStatus[] {
  if (!engine) {
    return LLM_PROVIDER_IDS.map((id) => statusFromFields(publicFieldsFromRecord(undefined, id), id))
  }
  return LLM_PROVIDER_IDS.map((id) =>
    statusFromFields(publicFieldsFromRecord(engine?.peekRecord(id) ?? undefined, id), id)
  )
}

export async function listByokPublic(): Promise<ByokPublicStatus[]> {
  try {
    const records = await requireEngine().listRecords()
    return LLM_PROVIDER_IDS.map((id) => {
      const record = records.find((row) => row.providerId === id)
      return statusFromFields(publicFieldsFromRecord(record, id), id)
    })
  } catch (error) {
    mapVaultError(error)
  }
}

export function peekByokRecord(providerId: LlmProviderId): VaultRecord | null {
  if (!engine) return null
  return engine.peekRecord(providerId)
}

export function hasByokRecord(providerId?: LlmProviderId): boolean {
  if (!engine) return false
  return engine.hasRecord(providerId)
}

export async function saveByokSecret(
  providerId: LlmProviderId,
  secret: string,
  extra: Record<string, string> = {},
  baseUrl = ''
): Promise<ByokPublicStatus> {
  if (!isLlmProviderId(providerId)) {
    throw new AIError('AUTH_ERROR', 'BYOK 対象外の Provider です', { providerId })
  }
  try {
    const fields = await requireEngine().saveSecret(providerId, secret, extra, baseUrl)
    return statusFromFields(fields, providerId)
  } catch (error) {
    if (error instanceof Error && error.message === encryptionUnavailableMessage()) {
      throw new AIError('AUTH_ERROR', encryptionUnavailableMessage(), { providerId })
    }
    mapVaultError(error, providerId)
  }
}

export async function deleteByokSecret(providerId: LlmProviderId): Promise<ByokPublicStatus> {
  try {
    const fields = await requireEngine().deleteSecret(providerId)
    return statusFromFields(fields, providerId)
  } catch (error) {
    mapVaultError(error, providerId)
  }
}

export function loadByokSecretSync(providerId: LlmProviderId): {
  id: string
  secret: string
  baseUrl: string
  extra: Record<string, string>
} | null {
  if (!engine) return null
  return engine.getSecret(providerId)
}

export async function warmByokCache(): Promise<void> {
  if (!engine) return
  try {
    await engine.warm()
  } catch (error) {
    if (error instanceof VaultUnreadableError) return
    throw error
  }
}

export async function markByokTestResult(
  providerId: LlmProviderId,
  ok: boolean
): Promise<ByokPublicStatus> {
  try {
    const fields = await requireEngine().markTestResult(providerId, ok)
    return statusFromFields(fields, providerId)
  } catch (error) {
    mapVaultError(error, providerId)
  }
}

export function assertNoSecretInPayload(value: unknown, secrets: string[]): void {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of secrets) {
    const token = secret.trim()
    if (token.length < 8) continue
    if (raw.includes(token)) {
      throw new AIError('PROVIDER_ERROR', 'secret must not appear in public payloads')
    }
  }
}
