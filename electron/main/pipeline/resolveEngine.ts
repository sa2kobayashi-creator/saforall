import { getLocalSetting } from '../settingsStore'
import { resolveCredential, extraHeadersFor } from '../ai/credentials'
import { isLlmProviderId, parseProviderId, type LlmProviderId } from '../ai/types'

function parseModels(raw: string, fallbackKey: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    }
  } catch {
    // ignore
  }
  const single = getLocalSetting(fallbackKey, '')
  return single ? [single] : []
}

export type ResolvedEngineRuntime = {
  engine: string
  provider: LlmProviderId
  model: string
  baseUrl: string
  extraHeaders: string[]
}

/** Resolve provider/model/baseUrl without creating a chat session. */
export function resolveEngineRuntime(
  preferred: string | undefined,
  mode: 'fixed' | 'auto'
): ResolvedEngineRuntime {
  const order: LlmProviderId[] = ['openai', 'claude', 'gemini', 'grok', 'deepseek']
  let engine = (preferred || '').trim().toLowerCase()
  if (mode === 'auto' || !engine || engine === 'auto') {
    engine = ''
    for (const id of order) {
      const resolved = resolveCredential(id)
      if (resolved.credential?.secret) {
        engine = id
        break
      }
    }
    if (!engine) engine = 'openai'
  }
  if (engine === 'anthropic') engine = 'claude'
  if (engine === 'xai') engine = 'grok'

  const providerId = parseProviderId(engine)
  if (!providerId || !isLlmProviderId(providerId) || providerId === 'workers') {
    throw new Error(`Pipeline: Agent/AI に使えない engine: ${engine}`)
  }

  const cred = resolveCredential(providerId).credential
  let baseUrl = cred?.baseUrl || ''
  let model = ''
  const extraHeaders: string[] = cred ? extraHeadersFor(cred) : []

  if (providerId === 'openai') {
    baseUrl = baseUrl || getLocalSetting('llm.openai.base_url', 'https://api.openai.com/v1')
    model =
      parseModels(getLocalSetting('llm.openai.models', ''), 'llm.openai.model')[0] ||
      getLocalSetting('llm.openai.model', 'gpt-4.1-mini')
  } else if (providerId === 'claude') {
    baseUrl = baseUrl || 'https://api.anthropic.com'
    model =
      parseModels(getLocalSetting('llm.claude.models', ''), 'llm.claude.model')[0] ||
      getLocalSetting('llm.claude.model', 'claude-sonnet-5')
  } else if (providerId === 'gemini') {
    baseUrl = 'gemini-native'
    model =
      parseModels(getLocalSetting('llm.gemini.models', ''), 'llm.gemini.model')[0] ||
      getLocalSetting('llm.gemini.model', 'gemini-2.0-flash')
  } else if (providerId === 'grok') {
    baseUrl = baseUrl || getLocalSetting('llm.grok.base_url', 'https://api.x.ai/v1')
    model =
      parseModels(getLocalSetting('llm.grok.models', ''), 'llm.grok.model')[0] ||
      getLocalSetting('llm.grok.model', 'grok-2-latest')
  } else if (providerId === 'deepseek') {
    baseUrl = baseUrl || getLocalSetting('llm.deepseek.base_url', 'https://api.deepseek.com')
    model =
      parseModels(getLocalSetting('llm.deepseek.models', ''), 'llm.deepseek.model')[0] ||
      getLocalSetting('llm.deepseek.model', 'deepseek-chat')
  }

  if (!model) model = 'default'
  return { engine: providerId, provider: providerId, model, baseUrl, extraHeaders }
}
