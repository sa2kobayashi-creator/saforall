import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const VAULT_ALG = 'AES-256-GCM'
export const LOCAL_BYOK_OWNER_ID = 'local-user'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const DEK_LENGTH = 32

export type AesGcmCipher = {
  alg: typeof VAULT_ALG
  iv: string
  tag: string
  data: string
}

export type VaultLoadKind = 'unloaded' | 'missing' | 'ok' | 'unreadable'

export type VaultRecord = {
  id: string
  providerId: string
  ownerType: 'user'
  ownerId: string
  billingMode: 'BYOK'
  cipher: AesGcmCipher
  baseUrl: string
  extra: Record<string, string>
  fingerprint: string
  lastVerifiedAt: string | null
  lastTestOk: boolean | null
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export type VaultFile = {
  version: 1
  keyVersion: number
  wrappedDek: string
  records: VaultRecord[]
}

export type VaultWrapBackend = {
  isAvailable: () => boolean
  wrap: (plaintext: string) => string
  unwrap: (wrapped: string) => string
}

export type VaultFileIo = {
  read: (path: string) => Promise<string>
  readSync: (path: string) => string
  write: (path: string, contents: string) => Promise<void>
}

export type ByokStoredSecret = {
  id: string
  secret: string
  baseUrl: string
  extra: Record<string, string>
}

export type ByokPublicFields = {
  providerId: string
  /** Vault record id when configured (never derived from the API key). */
  credentialId: string | null
  billingMode: 'BYOK' | null
  configured: boolean
  fingerprint: string
  createdAt: string | null
  lastVerifiedAt: string | null
  lastTestOk: boolean | null
}

export class VaultUnreadableError extends Error {
  constructor(message = vaultUnreadableMessage()) {
    super(message)
    this.name = 'VaultUnreadableError'
  }
}

export function generateDek(): Buffer {
  return randomBytes(DEK_LENGTH)
}

export function encryptUtf8(dek: Buffer, plaintext: string): AesGcmCipher {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_LENGTH) {
    throw new Error('AES-GCM auth tag is invalid')
  }
  return {
    alg: VAULT_ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

export function decryptUtf8(dek: Buffer, cipher: AesGcmCipher): string {
  if (cipher.alg !== VAULT_ALG) {
    throw new Error(`Unsupported vault algorithm: ${cipher.alg}`)
  }
  const iv = Buffer.from(cipher.iv, 'base64')
  const tag = Buffer.from(cipher.tag, 'base64')
  const data = Buffer.from(cipher.data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', dek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Last 4 characters only. Not enough to reconstruct the secret. */
export function fingerprintSecret(secret: string): string {
  const trimmed = secret.trim()
  if (!trimmed) return ''
  const compact = trimmed.replace(/[^A-Za-z0-9]/g, '')
  const source = compact.length >= 4 ? compact : trimmed
  return source.slice(-4)
}

export function applyByokTestResult(
  ok: boolean,
  previousVerifiedAt: string | null,
  now: string
): { lastTestOk: boolean; lastVerifiedAt: string | null } {
  return {
    lastTestOk: ok,
    lastVerifiedAt: ok ? now : previousVerifiedAt
  }
}

export function encryptionUnavailableMessage(): string {
  return 'OS の暗号化（safeStorage）が利用できないため、BYOK を保存できません'
}

export function vaultUnreadableMessage(): string {
  return 'Credential vault が破損しているか読み取れないため、更新できません'
}

export function dekToBase64(dek: Buffer): string {
  return dek.toString('base64')
}

export function dekFromBase64(value: string): Buffer {
  const dek = Buffer.from(value, 'base64')
  if (dek.length !== DEK_LENGTH) {
    throw new Error('Invalid data encryption key length')
  }
  return dek
}

export function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
  )
}

export function emptyVaultFile(): VaultFile {
  return { version: 1, keyVersion: 1, wrappedDek: '', records: [] }
}

export function parseVaultJson(raw: string): { kind: 'ok'; file: VaultFile } | { kind: 'corrupt'; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'corrupt', reason: 'invalid json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'corrupt', reason: 'not object' }
  }
  const file = parsed as Partial<VaultFile>
  if (file.version !== 1 || !Array.isArray(file.records) || typeof file.wrappedDek !== 'string') {
    return { kind: 'corrupt', reason: 'invalid schema' }
  }
  return { kind: 'ok', file: file as VaultFile }
}

export function canPersistVault(kind: VaultLoadKind): boolean {
  return kind === 'missing' || kind === 'ok'
}

export function cloneVaultFile(file: VaultFile): VaultFile {
  return JSON.parse(JSON.stringify(file)) as VaultFile
}

export function activeVaultRecord(file: VaultFile, providerId: string): VaultRecord | undefined {
  return file.records.find(
    (row) =>
      row.providerId === providerId &&
      row.ownerId === LOCAL_BYOK_OWNER_ID &&
      row.billingMode === 'BYOK' &&
      !row.revokedAt
  )
}

export async function atomicWriteUtf8(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmpPath, contents, 'utf8')
  try {
    await rename(tmpPath, filePath)
  } catch {
    try {
      await unlink(filePath)
    } catch {
      // destination may not exist
    }
    try {
      await rename(tmpPath, filePath)
    } catch (renameError) {
      try {
        await unlink(tmpPath)
      } catch {
        // ignore leftover tmp
      }
      throw renameError
    }
  }
}

export function createFsVaultIo(): VaultFileIo {
  return {
    async read(path) {
      return readFile(path, 'utf8')
    },
    readSync(path) {
      return readFileSync(path, 'utf8')
    },
    async write(path, contents) {
      await atomicWriteUtf8(path, contents)
    }
  }
}

export class ByokVaultEngine {
  private loadKind: VaultLoadKind = 'unloaded'
  private file: VaultFile | null = null
  private dek: Buffer | null = null
  private readonly secrets = new Map<string, ByokStoredSecret>()
  private readonly filePath: string
  private readonly wrap: VaultWrapBackend
  private readonly io: VaultFileIo

  constructor(filePath: string, wrap: VaultWrapBackend, io: VaultFileIo) {
    this.filePath = filePath
    this.wrap = wrap
    this.io = io
  }

  loadState(): VaultLoadKind {
    return this.loadKind
  }

  /** Simulate process restart / warm cache not finished. Disk is unchanged. */
  forgetMemory(): void {
    this.loadKind = 'unloaded'
    this.file = null
    this.dek = null
    this.secrets.clear()
  }

  peekRecord(providerId: string): VaultRecord | null {
    this.loadSync()
    if (this.loadKind !== 'ok' || !this.file) return null
    return activeVaultRecord(this.file, providerId) ?? null
  }

  hasRecord(providerId?: string): boolean {
    this.loadSync()
    if (this.loadKind === 'unreadable' || !this.file) return false
    if (providerId) {
      if (this.secrets.has(providerId)) return true
      return Boolean(activeVaultRecord(this.file, providerId))
    }
    if (this.secrets.size > 0) return true
    return this.file.records.some(
      (row) => row.ownerId === LOCAL_BYOK_OWNER_ID && row.billingMode === 'BYOK' && !row.revokedAt
    )
  }

  getSecret(providerId: string): ByokStoredSecret | null {
    const cached = this.secrets.get(providerId)
    if (cached) return cached
    this.loadSync()
    if (this.loadKind !== 'ok' || !this.file) return null
    const record = activeVaultRecord(this.file, providerId)
    if (!record) return null
    try {
      const dek = this.unwrapDek(this.file)
      const secret = decryptUtf8(dek, record.cipher)
      if (!secret.trim()) return null
      const stored: ByokStoredSecret = {
        id: record.id,
        secret,
        baseUrl: record.baseUrl,
        extra: record.extra ?? {}
      }
      this.secrets.set(providerId, stored)
      return stored
    } catch {
      return null
    }
  }

  async listRecords(): Promise<VaultRecord[]> {
    await this.load()
    this.assertReadableForList()
    if (this.loadKind === 'missing' || !this.file) return []
    return this.file.records.filter(
      (row) => row.ownerId === LOCAL_BYOK_OWNER_ID && row.billingMode === 'BYOK' && !row.revokedAt
    )
  }

  async saveSecret(
    providerId: string,
    secret: string,
    extra: Record<string, string> = {},
    baseUrl = ''
  ): Promise<ByokPublicFields> {
    const trimmed = secret.trim()
    if (!trimmed) {
      throw new Error('API Key が空です')
    }
    if (!this.wrap.isAvailable()) {
      throw new Error(encryptionUnavailableMessage())
    }
    await this.load()
    this.assertWritable()
    const next = cloneVaultFile(this.file ?? emptyVaultFile())
    const dek = this.ensureDekOn(next)
    const now = new Date().toISOString()
    const existing = activeVaultRecord(next, providerId)
    const record: VaultRecord = {
      id: existing?.id ?? `byok_${providerId}_${Date.now().toString(36)}`,
      providerId,
      ownerType: 'user',
      ownerId: LOCAL_BYOK_OWNER_ID,
      billingMode: 'BYOK',
      cipher: encryptUtf8(dek, trimmed),
      baseUrl,
      extra,
      fingerprint: fingerprintSecret(trimmed),
      lastVerifiedAt: null,
      lastTestOk: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null
    }
    next.records = next.records.filter(
      (row) => !(row.providerId === providerId && row.ownerId === LOCAL_BYOK_OWNER_ID)
    )
    next.records.push(record)
    await this.persist(next, dek)
    this.secrets.set(providerId, {
      id: record.id,
      secret: trimmed,
      baseUrl,
      extra
    })
    return publicFieldsFromRecord(record, providerId)
  }

  async deleteSecret(providerId: string): Promise<ByokPublicFields> {
    await this.load()
    this.assertWritable()
    const next = cloneVaultFile(this.file ?? emptyVaultFile())
    next.records = next.records.filter(
      (row) => !(row.providerId === providerId && row.ownerId === LOCAL_BYOK_OWNER_ID)
    )
    await this.persist(next)
    this.secrets.delete(providerId)
    return publicFieldsFromRecord(undefined, providerId)
  }

  async markTestResult(providerId: string, ok: boolean): Promise<ByokPublicFields> {
    await this.load()
    this.assertWritable()
    if (!this.file) return publicFieldsFromRecord(undefined, providerId)
    const next = cloneVaultFile(this.file)
    const record = activeVaultRecord(next, providerId)
    if (!record) return publicFieldsFromRecord(undefined, providerId)
    record.updatedAt = new Date().toISOString()
    const result = applyByokTestResult(ok, record.lastVerifiedAt, record.updatedAt)
    record.lastTestOk = result.lastTestOk
    record.lastVerifiedAt = result.lastVerifiedAt
    await this.persist(next)
    return publicFieldsFromRecord(record, providerId)
  }

  async warm(): Promise<void> {
    await this.load()
    if (this.loadKind !== 'ok' || !this.file) return
    this.secrets.clear()
    if (!this.file.wrappedDek || this.file.records.length === 0) return
    try {
      const dek = this.unwrapDek(this.file)
      for (const record of this.file.records) {
        if (record.revokedAt) continue
        try {
          const secret = decryptUtf8(dek, record.cipher)
          if (!secret.trim()) continue
          this.secrets.set(record.providerId, {
            id: record.id,
            secret,
            baseUrl: record.baseUrl,
            extra: record.extra ?? {}
          })
        } catch {
          // skip undecryptable row
        }
      }
    } catch {
      this.secrets.clear()
    }
  }

  private loadSync(): void {
    if (this.loadKind !== 'unloaded') return
    try {
      const raw = this.io.readSync(this.filePath)
      this.ingest(raw)
    } catch (error) {
      this.ingestError(error)
    }
  }

  private async load(): Promise<void> {
    if (this.loadKind !== 'unloaded') return
    try {
      const raw = await this.io.read(this.filePath)
      this.ingest(raw)
    } catch (error) {
      this.ingestError(error)
    }
  }

  private ingest(raw: string): void {
    const parsed = parseVaultJson(raw)
    if (parsed.kind === 'corrupt') {
      this.loadKind = 'unreadable'
      this.file = null
      return
    }
    this.loadKind = 'ok'
    this.file = parsed.file
  }

  private ingestError(error: unknown): void {
    if (isNotFoundError(error)) {
      this.loadKind = 'missing'
      this.file = emptyVaultFile()
      return
    }
    this.loadKind = 'unreadable'
    this.file = null
  }

  private assertWritable(): void {
    if (this.loadKind === 'unreadable') {
      throw new VaultUnreadableError()
    }
  }

  private assertReadableForList(): void {
    if (this.loadKind === 'unreadable') {
      throw new VaultUnreadableError()
    }
  }

  private unwrapDek(file: VaultFile): Buffer {
    if (this.dek) return this.dek
    if (!file.wrappedDek) {
      throw new Error('BYOK の暗号化キーがありません')
    }
    if (!this.wrap.isAvailable()) {
      throw new Error('OS の暗号化（safeStorage）が利用できないため、BYOK を復号できません')
    }
    const dek = dekFromBase64(this.wrap.unwrap(file.wrappedDek))
    this.dek = dek
    return dek
  }

  private ensureDekOn(file: VaultFile): Buffer {
    if (file.wrappedDek) return this.unwrapDek(file)
    if (!this.wrap.isAvailable()) {
      throw new Error(encryptionUnavailableMessage())
    }
    return generateDek()
  }

  private async persist(next: VaultFile, newDek?: Buffer): Promise<void> {
    this.assertWritable()
    let dek = newDek
    if (!next.wrappedDek) {
      if (!dek) dek = generateDek()
      next.wrappedDek = this.wrap.wrap(dekToBase64(dek))
      next.keyVersion = 1
    }
    await this.io.write(this.filePath, JSON.stringify(next, null, 2))
    this.file = next
    this.loadKind = 'ok'
    if (dek) this.dek = dek
  }
}

export function publicFieldsFromRecord(
  record: VaultRecord | undefined,
  providerId: string
): ByokPublicFields {
  if (!record || record.revokedAt) {
    return {
      providerId,
      credentialId: null,
      billingMode: null,
      configured: false,
      fingerprint: '',
      createdAt: null,
      lastVerifiedAt: null,
      lastTestOk: null
    }
  }
  return {
    providerId,
    credentialId: record.id,
    billingMode: 'BYOK',
    configured: true,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
    lastVerifiedAt: record.lastVerifiedAt,
    lastTestOk: record.lastTestOk
  }
}
