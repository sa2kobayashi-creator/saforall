import { AIError, redactLooksLikeSecret } from './errors'
import { getProvider } from './registry'
import { isLlmProviderId, parseProviderId } from './types'
import { resolveCredential } from './credentials'
import {
  assertNoSecretInPayload,
  deleteByokSecret,
  listByokPublic,
  markByokTestResult,
  saveByokSecret,
  type ByokPublicStatus
} from './credentialVault'

function requireLlmProvider(value: unknown) {
  const id = parseProviderId(String(value ?? ''))
  if (!id || !isLlmProviderId(id)) {
    throw new AIError('AUTH_ERROR', 'BYOK 対象は OpenAI / Claude / Gemini / Grok / Workers AI です')
  }
  return id
}

function publicError(error: unknown): { ok: false; error: { code: string; message: string } } {
  if (error instanceof AIError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'UNKNOWN', message: redactLooksLikeSecret(message) } }
}

export async function handleListByok(): Promise<
  { ok: true; credentials: ByokPublicStatus[] } | { ok: false; error: { code: string; message: string } }
> {
  try {
    const credentials = await listByokPublic()
    return { ok: true, credentials }
  } catch (error) {
    return publicError(error)
  }
}

export async function handleSaveByok(input: {
  providerId?: unknown
  secret?: unknown
}): Promise<
  { ok: true; status: ByokPublicStatus } | { ok: false; error: { code: string; message: string } }
> {
  try {
    const providerId = requireLlmProvider(input.providerId)
    if (typeof input.secret !== 'string') {
      throw new AIError('AUTH_ERROR', 'API Key が必要です', { providerId })
    }
    const status = await saveByokSecret(providerId, input.secret)
    assertNoSecretInPayload(status, [input.secret])
    return { ok: true, status }
  } catch (error) {
    return publicError(error)
  }
}

export async function handleDeleteByok(
  providerId: unknown
): Promise<
  { ok: true; status: ByokPublicStatus } | { ok: false; error: { code: string; message: string } }
> {
  try {
    const id = requireLlmProvider(providerId)
    const status = await deleteByokSecret(id)
    return { ok: true, status }
  } catch (error) {
    return publicError(error)
  }
}

export async function handleTestByok(
  providerId: unknown
): Promise<
  | { ok: true; message: string; status: ByokPublicStatus }
  | { ok: false; message: string; status?: ByokPublicStatus; error: { code: string; message: string } }
> {
  let id: ReturnType<typeof requireLlmProvider> | null = null
  try {
    id = requireLlmProvider(providerId)
    const listed = await listByokPublic()
    const current = listed.find((row) => row.providerId === id)
    if (!current?.configured) {
      return {
        ok: false,
        message: 'BYOK が未設定です。先に保存してください。',
        status: current,
        error: { code: 'AUTH_ERROR', message: 'BYOK が未設定です' }
      }
    }
    const resolved = resolveCredential(id)
    if (!resolved.credential || resolved.billingMode !== 'BYOK') {
      return {
        ok: false,
        message: 'BYOK を復号できません。OS の暗号化を確認してください。',
        status: current,
        error: { code: 'AUTH_ERROR', message: 'BYOK を復号できません' }
      }
    }
    const adapter = getProvider(id)
    const result = await adapter.healthCheck(resolved.credential)
    const status = await markByokTestResult(id, result.ok)
    const secrets = [resolved.credential.secret]
    assertNoSecretInPayload(status, secrets)
    assertNoSecretInPayload(result.message, secrets)
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        status,
        error: { code: 'AUTH_ERROR', message: result.message }
      }
    }
    return { ok: true, message: result.message, status }
  } catch (error) {
    const failed = publicError(error)
    let status: ByokPublicStatus | undefined
    if (id) {
      try {
        status = await markByokTestResult(id, false)
      } catch {
        status = undefined
      }
    }
    return { ...failed, message: failed.error.message, status }
  }
}
