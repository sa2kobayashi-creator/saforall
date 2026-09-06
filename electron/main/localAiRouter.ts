import {
  ensureSettingsLoaded,
  getLocalSetting,
  getOpenAiKey
} from './settingsStore'
import { appendMessage, getSession, listMessages } from './chatStore'
import { getLocalUsageSummary, recordLocalUsage, type MonthUsage } from './usageStore'

export type LocalRouteResult = {
  engine: string
  requested: string
  task_type: string
  fallback_from: string | null
  fallback_reason: string | null
  mode: string
  model: string
  session_id: number
  user_message_id: number
  user_message: Record<string, unknown>
  cursor_run_id: number | null
  usage: MonthUsage
  cursor_api_key: string | null
  provider: {
    api_key: string
    base_url: string
    extra_headers: string[]
    messages: Array<{ role: string; content: string }>
  } | null
  estimated_usd?: number
}

function parseModels(raw: string, fallback: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const list = parsed.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
      if (list.length > 0) return list
    }
  } catch {
    // ignore
  }
  const single = getLocalSetting(fallback, '')
  return single ? [single] : []
}

function pickEngine(requested: string, mode: string): { engine: string; reason: string | null } {
  if (requested && requested !== 'auto') return { engine: requested, reason: null }
  const enabledRaw = getLocalSetting('router.enabled_engines', '["openai","gemini","claude"]')
  let enabled: string[] = ['openai', 'gemini', 'claude']
  try {
    const parsed = JSON.parse(enabledRaw) as unknown
    if (Array.isArray(parsed)) {
      enabled = parsed.filter((row): row is string => typeof row === 'string')
    }
  } catch {
    // keep default
  }
  if (mode === 'agent') {
    for (const engine of ['openai', 'claude', 'cursor']) {
      if (enabled.includes(engine) || engine === 'openai') {
        if (engine === 'openai' && getOpenAiKey()) return { engine, reason: 'auto_agent_openai' }
        if (engine === 'claude' && getLocalSetting('llm.claude.api_key')) {
          return { engine, reason: 'auto_agent_claude' }
        }
        if (engine === 'cursor' && getLocalSetting('llm.cursor.api_key')) {
          return { engine, reason: 'auto_agent_cursor' }
        }
      }
    }
  }
  if (getOpenAiKey()) return { engine: 'openai', reason: 'auto_default_openai' }
  if (getLocalSetting('llm.claude.api_key')) return { engine: 'claude', reason: 'auto_default_claude' }
  if (getLocalSetting('llm.gemini.api_key')) return { engine: 'gemini', reason: 'auto_default_gemini' }
  if (getLocalSetting('llm.cursor.api_key')) return { engine: 'cursor', reason: 'auto_default_cursor' }
  return { engine: 'openai', reason: 'auto_fallback_openai' }
}

function buildHistoryMessages(
  history: Array<{ role: string; content: string }>,
  context: Record<string, unknown> | null,
  userText: string
): Array<{ role: string; content: string }> {
  const systemParts = [
    'あなたはコードアシスタントです。簡潔に日本語で答えてください。',
    '（ローカル永続化モード）'
  ]
  if (context) {
    if (typeof context.path === 'string' && context.path) {
      systemParts.push(`# Active file\n${context.path}`)
    }
    if (typeof context.content === 'string' && context.content.trim()) {
      systemParts.push(`\`\`\`\n${String(context.content).slice(0, 12000)}\n\`\`\``)
    }
    const selection = context.selection
    if (selection && typeof selection === 'object') {
      const sel = selection as {
        path?: string
        text?: string
        start_line?: number
        end_line?: number
      }
      if (typeof sel.text === 'string' && sel.text.trim()) {
        systemParts.push(
          `# Selection ${sel.path ?? ''} ${sel.start_line ?? ''}-${sel.end_line ?? ''}\n\`\`\`\n${sel.text.slice(0, 4000)}\n\`\`\``
        )
      }
    }
    if (Array.isArray(context.problems) && context.problems.length > 0) {
      systemParts.push(
        `# Problems\n${context.problems
          .slice(0, 30)
          .map((row) => String(row))
          .join('\n')}`
      )
    }
    if (Array.isArray(context.files)) {
      for (const row of context.files.slice(0, 4)) {
        if (!row || typeof row !== 'object') continue
        const file = row as { path?: string; content?: string }
        if (!file.path || typeof file.content !== 'string') continue
        systemParts.push(
          `# File ${file.path}\n\`\`\`\n${file.content.slice(0, 6000)}\n\`\`\``
        )
      }
    }
    if (typeof context.index_summary === 'string' && context.index_summary.trim()) {
      systemParts.push(`# Codebase\n${String(context.index_summary).slice(0, 6000)}`)
    }
  }
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemParts.join('\n\n') }
  ]
  for (const row of history.slice(-12)) {
    if (row.role === 'user' || row.role === 'assistant') {
      messages.push({ role: row.role, content: row.content })
    }
  }
  messages.push({ role: 'user', content: userText })
  return messages
}

export async function prepareLocalRoute(body: Record<string, unknown>): Promise<LocalRouteResult> {
  await ensureSettingsLoaded()
  const sessionId = Number(body.session_id)
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new Error('session_id is required')
  }
  const session = await getSession(sessionId)
  if (!session) throw new Error('session not found')

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) throw new Error('message is required')

  const mode = typeof body.mode === 'string' ? body.mode : 'ask'
  const requested = typeof body.engine === 'string' ? body.engine : 'auto'
  const { engine, reason } = pickEngine(requested, mode)
  const context =
    typeof body.context === 'object' && body.context !== null
      ? (body.context as Record<string, unknown>)
      : null

  const userMessage = await appendMessage({
    sessionId,
    role: 'user',
    content: message
  })

  const history = await listMessages(sessionId)
  const prior = history
    .filter((row) => row.id !== userMessage.id)
    .map((row) => ({ role: row.role, content: row.content }))

  let model = typeof body.model === 'string' && body.model ? body.model : ''
  let apiKey = ''
  let baseUrl = 'https://api.openai.com/v1'
  let cursorKey: string | null = null
  let provider: LocalRouteResult['provider'] = null

  if (engine === 'openai') {
    apiKey = getOpenAiKey()
    baseUrl = getLocalSetting('llm.openai.base_url', 'https://api.openai.com/v1')
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.openai.models', ''), 'llm.openai.model')[0] ||
        getLocalSetting('llm.openai.model', 'gpt-4.1-mini')
    }
  } else if (engine === 'claude') {
    apiKey = getLocalSetting('llm.claude.api_key')
    baseUrl = 'https://api.anthropic.com'
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.claude.models', ''), 'llm.claude.model')[0] ||
        getLocalSetting('llm.claude.model', 'claude-sonnet-5')
    }
  } else if (engine === 'gemini') {
    apiKey = getLocalSetting('llm.gemini.api_key')
    baseUrl = 'gemini-native'
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.gemini.models', ''), 'llm.gemini.model')[0] ||
        getLocalSetting('llm.gemini.model', 'gemini-2.0-flash')
    }
  } else if (engine === 'cursor') {
    cursorKey = getLocalSetting('llm.cursor.api_key') || null
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.cursor.models', ''), 'llm.cursor.model')[0] ||
        getLocalSetting('llm.cursor.model', 'composer-2')
    }
  }

  if (engine === 'openai' || engine === 'claude') {
    provider = {
      api_key: apiKey,
      base_url: baseUrl,
      extra_headers: [],
      messages: buildHistoryMessages(prior, context, message)
    }
  } else if (engine === 'gemini') {
    provider = {
      api_key: apiKey,
      base_url: baseUrl,
      extra_headers: [],
      messages: buildHistoryMessages(prior, context, message)
    }
  }

  const usageSummary = await getLocalUsageSummary()
  return {
    engine,
    requested,
    task_type: mode === 'agent' ? 'coding' : 'chat',
    fallback_from: null,
    fallback_reason: reason,
    mode,
    model,
    session_id: sessionId,
    user_message_id: userMessage.id,
    user_message: userMessage as unknown as Record<string, unknown>,
    cursor_run_id: null,
    usage: usageSummary.usage,
    cursor_api_key: cursorKey,
    provider,
    estimated_usd: 0.002
  }
}

export async function completeLocalRoute(params: {
  sessionId: number
  content: string
  engine: string
  model: string
  estimatedUsd?: number
}): Promise<{
  assistant_message: Record<string, unknown>
  estimated_usd: number
  usage: MonthUsage
}> {
  const assistant = await appendMessage({
    sessionId: params.sessionId,
    role: 'assistant',
    content: params.content
  })
  const usage = await recordLocalUsage({
    engine: params.engine,
    estimatedUsd: params.estimatedUsd ?? 0.002
  })
  return {
    assistant_message: assistant as unknown as Record<string, unknown>,
    estimated_usd: params.estimatedUsd ?? 0.002,
    usage
  }
}
