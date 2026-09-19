import type { Credential, ProviderId } from './types'

export type CatalogEngine = 'openai' | 'gemini' | 'claude' | 'workers' | 'cursor'

export type ListedModel = {
  id: string
  label: string
  tier: 'cheap' | 'standard' | 'strong'
}

export type ListedCatalog = {
  engine: CatalogEngine
  models: ListedModel[]
  source: 'live' | 'builtin'
}

const BUILTIN: Record<CatalogEngine, ListedModel[]> = {
  openai: [
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', tier: 'cheap' },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', tier: 'cheap' },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tier: 'cheap' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', tier: 'standard' },
    { id: 'gpt-4.1', label: 'gpt-4.1', tier: 'standard' },
    { id: 'gpt-4o', label: 'gpt-4o', tier: 'standard' },
    { id: 'gpt-5.4', label: 'gpt-5.4', tier: 'standard' },
    { id: 'o4-mini', label: 'o4-mini', tier: 'strong' },
    { id: 'o3-mini', label: 'o3-mini', tier: 'strong' }
  ],
  gemini: [
    { id: 'gemini-flash-latest', label: 'gemini-flash-latest', tier: 'cheap' },
    { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite', tier: 'cheap' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', tier: 'standard' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', tier: 'strong' }
  ],
  claude: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'cheap' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'standard' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'strong' }
  ],
  workers: [
    { id: '@cf/meta/llama-3.1-8b-instruct-fp8', label: '@cf/meta/llama-3.1-8b-instruct-fp8', tier: 'cheap' },
    { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: '@cf/meta/llama-3.1-8b-instruct-fast', tier: 'cheap' },
    { id: '@cf/qwen/qwen2.5-coder-32b-instruct', label: '@cf/qwen/qwen2.5-coder-32b-instruct', tier: 'standard' },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', tier: 'strong' }
  ],
  cursor: [
    { id: 'auto', label: 'Auto（サーバ側選択）', tier: 'cheap' },
    { id: 'auto-smart', label: 'Cursor Router auto-smart', tier: 'cheap' },
    { id: 'composer-2.5', label: 'Composer 2.5', tier: 'standard' },
    { id: 'grok-4.5', label: 'Cursor Grok 4.5', tier: 'standard' },
    { id: 'grok-4.6', label: 'Cursor Grok 4.6', tier: 'standard' },
    { id: 'claude-4.5-sonnet', label: 'Claude Sonnet 4.5', tier: 'standard' },
    { id: 'claude-4.6-sonnet', label: 'Claude Sonnet 4.6', tier: 'standard' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'strong' }
  ]
}

export function parseCatalogEngine(raw: string | null | undefined): CatalogEngine {
  const engine = String(raw || '').trim().toLowerCase()
  if (
    engine === 'openai' ||
    engine === 'gemini' ||
    engine === 'claude' ||
    engine === 'workers' ||
    engine === 'cursor'
  ) {
    return engine
  }
  return 'openai'
}

export function guessModelTier(id: string): ListedModel['tier'] {
  const lower = id.toLowerCase()
  // `mini` must not match the substring inside "gemini"
  if (/lite|(^|[-_/])mini|flash-latest|8b|cheap|nano/.test(lower)) return 'cheap'
  if (/pro|opus|o3|o4|70b|strong/.test(lower)) return 'strong'
  return 'standard'
}

export function isNonChatGeminiModel(id: string): boolean {
  return /image|imagen|embedding|embed-content|tts|audio|lyria|robotics|aqa|computer-use/i.test(id)
}

export function isChatOpenAiModel(id: string): boolean {
  return /^(gpt-|o[0-9]|chatgpt-|ft:)/i.test(id)
}

type GeminiListRow = {
  name?: unknown
  displayName?: unknown
  supportedGenerationMethods?: unknown
}

export function mapGeminiListRow(row: GeminiListRow): ListedModel | null {
  const name = typeof row.name === 'string' ? row.name : ''
  const id = name.replace(/^models\//, '').trim()
  if (!id || !id.toLowerCase().startsWith('gemini')) return null
  if (isNonChatGeminiModel(id)) return null
  const methods = row.supportedGenerationMethods
  if (Array.isArray(methods) && methods.length > 0 && !methods.includes('generateContent')) {
    return null
  }
  const display = typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName.trim() : id
  return { id, label: display, tier: guessModelTier(id) }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type ListProviderModelsDeps = {
  fetchImpl?: FetchLike
  credentialFor?: (providerId: ProviderId) => Credential | null
}

const FETCH_TIMEOUT_MS = 45_000

function fetchInit(headers: Record<string, string>): RequestInit {
  return {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  }
}

function builtin(engine: CatalogEngine): ListedCatalog {
  return { engine, models: BUILTIN[engine], source: 'builtin' }
}

function sortModels(models: ListedModel[]): ListedModel[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id))
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // fall through
  }
  throw new Error(`モデル一覧の応答が JSON ではありません (HTTP ${response.status})`)
}

async function listGemini(secret: string, fetchImpl: FetchLike): Promise<ListedModel[]> {
  const out: ListedModel[] = []
  let pageToken = ''
  for (let page = 0; page < 10; page += 1) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetchImpl(url.toString(), fetchInit({ 'x-goog-api-key': secret }))
    if (!response.ok) {
      throw new Error(`Gemini モデル一覧 HTTP ${response.status}`)
    }
    const json = await readJson(response)
    const list = Array.isArray(json.models) ? json.models : []
    for (const row of list) {
      if (!row || typeof row !== 'object') continue
      const mapped = mapGeminiListRow(row as GeminiListRow)
      if (mapped) out.push(mapped)
    }
    pageToken = typeof json.nextPageToken === 'string' ? json.nextPageToken.trim() : ''
    if (!pageToken) break
  }
  return sortModels(out)
}

async function listOpenAi(credential: Credential, fetchImpl: FetchLike): Promise<ListedModel[]> {
  const baseUrl = (credential.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const response = await fetchImpl(`${baseUrl}/models`, fetchInit({ Authorization: `Bearer ${credential.secret}` }))
  if (!response.ok) {
    throw new Error(`OpenAI モデル一覧 HTTP ${response.status}`)
  }
  const json = await readJson(response)
  const list = Array.isArray(json.data) ? json.data : []
  const out: ListedModel[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const id = typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : ''
    if (!id || !isChatOpenAiModel(id)) continue
    out.push({ id, label: id, tier: guessModelTier(id) })
  }
  return sortModels(out)
}

async function listWorkers(credential: Credential, fetchImpl: FetchLike): Promise<ListedModel[]> {
  const accountId = credential.extra.accountId || ''
  if (!accountId) throw new Error('Workers Account ID が未設定です')
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search`,
    fetchInit({
      Authorization: `Bearer ${credential.secret}`,
      'Content-Type': 'application/json'
    })
  )
  if (!response.ok) {
    throw new Error(`Workers モデル一覧 HTTP ${response.status}`)
  }
  const json = await readJson(response)
  const list = Array.isArray(json.result) ? json.result : []
  const out: ListedModel[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { name?: unknown; id?: unknown; task?: { name?: unknown } }
    const id =
      typeof rec.name === 'string'
        ? rec.name
        : typeof rec.id === 'string'
          ? rec.id
          : ''
    if (!id || !id.includes('/')) continue
    const task = typeof rec.task?.name === 'string' ? rec.task.name : ''
    if (task && !/text|chat|instruct|generation/i.test(task)) continue
    out.push({ id, label: id, tier: guessModelTier(id) })
  }
  return sortModels(out).slice(0, 80)
}

/**
 * Packaged / local GET /ai/models. Live provider lists when credentials exist;
 * otherwise the builtin chat catalog (never the old 2-id Gemini stub).
 */
export async function listProviderModels(
  rawEngine: string | null | undefined,
  deps: ListProviderModelsDeps = {}
): Promise<ListedCatalog> {
  const engine = parseCatalogEngine(rawEngine)
  if (engine === 'claude' || engine === 'cursor') {
    return builtin(engine)
  }
  const fetchImpl = deps.fetchImpl ?? fetch
  const credential =
    deps.credentialFor !== undefined
      ? deps.credentialFor(engine)
      : (await import('./credentials')).resolveCredential(engine).credential
  if (!credential?.secret) {
    return builtin(engine)
  }
  try {
    const models =
      engine === 'gemini'
        ? await listGemini(credential.secret, fetchImpl)
        : engine === 'openai'
          ? await listOpenAi(credential, fetchImpl)
          : await listWorkers(credential, fetchImpl)
    if (models.length === 0) return builtin(engine)
    return { engine, models, source: 'live' }
  } catch {
    return builtin(engine)
  }
}
