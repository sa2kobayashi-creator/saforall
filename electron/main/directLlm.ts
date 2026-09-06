import type { ChatStreamEvent } from './api'
import {
  ensureSettingsLoaded,
  getLocalSetting,
  getOpenAiKey,
  hasUsableLocalLlm
} from './settingsStore'

type ProviderMessage = { role: string; content: string }

function parseJsonModels(raw: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const list = parsed.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
      if (list.length > 0) return list
    }
  } catch {
    // ignore
  }
  return fallback
}

function buildMessages(body: Record<string, unknown>): ProviderMessage[] {
  const userText = typeof body.message === 'string' ? body.message : ''
  const context =
    typeof body.context === 'object' && body.context !== null
      ? (body.context as Record<string, unknown>)
      : {}
  const parts: string[] = [
    'あなたはコードアシスタントです。簡潔に日本語で答えてください。',
    '（ローカル LLM モード: バックエンド未接続のため履歴は永続化されません）'
  ]
  if (typeof context.path === 'string' && context.path) {
    parts.push(`# Active file\n${context.path}`)
  }
  if (typeof context.content === 'string' && context.content.trim()) {
    parts.push(`\`\`\`\n${context.content.slice(0, 12000)}\n\`\`\``)
  }
  if (typeof context.index_summary === 'string' && context.index_summary.trim()) {
    parts.push(`# Codebase\n${context.index_summary.slice(0, 6000)}`)
  }
  if (Array.isArray(context.problems) && context.problems.length > 0) {
    parts.push(`# Problems\n${context.problems.slice(0, 20).join('\n')}`)
  }
  const selection =
    typeof context.selection === 'object' && context.selection !== null
      ? (context.selection as Record<string, unknown>)
      : null
  if (selection && typeof selection.text === 'string' && selection.text.trim()) {
    parts.push(`# Selection\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\``)
  }
  return [
    { role: 'system', content: parts.join('\n\n') },
    { role: 'user', content: userText }
  ]
}

async function callOpenAiCompatible(params: {
  apiKey: string
  baseUrl: string
  model: string
  messages: ProviderMessage[]
}): Promise<string> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: 0.2
    })
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 400)}`)
  }
  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('ローカル LLM から本文を取得できませんでした')
  return content
}

async function callClaude(params: {
  apiKey: string
  model: string
  messages: ProviderMessage[]
}): Promise<string> {
  const system = params.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const msgs = params.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
      system: system || undefined,
      messages: msgs
    })
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Claude HTTP ${response.status}: ${text.slice(0, 400)}`)
  }
  const json = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const content = (json.content ?? [])
    .filter((row) => row.type === 'text' && row.text)
    .map((row) => row.text)
    .join('\n')
  if (!content) throw new Error('Claude から本文を取得できませんでした')
  return content
}

async function callGemini(params: {
  apiKey: string
  model: string
  messages: ProviderMessage[]
}): Promise<string> {
  const model = params.model || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const contents = params.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey
    },
    body: JSON.stringify({ contents })
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 400)}`)
  }
  const json = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
  if (!content) throw new Error('Gemini から本文を取得できませんでした')
  return content
}

function resolveLocalEngine(requested: string): {
  engine: string
  model: string
  apiKey: string
  baseUrl?: string
} | null {
  const order =
    requested === 'auto'
      ? ['openai', 'claude', 'gemini', 'cursor']
      : [requested]

  for (const engine of order) {
    if (engine === 'openai') {
      const apiKey = getOpenAiKey()
      if (!apiKey) continue
      const models = parseJsonModels(getLocalSetting('llm.openai.models', ''), [
        getLocalSetting('llm.openai.model', 'gpt-4.1-mini')
      ])
      return {
        engine: 'openai',
        model: models[0] || 'gpt-4.1-mini',
        apiKey,
        baseUrl: getLocalSetting('llm.openai.base_url', 'https://api.openai.com/v1')
      }
    }
    if (engine === 'claude') {
      const apiKey = getLocalSetting('llm.claude.api_key')
      if (!apiKey) continue
      const models = parseJsonModels(getLocalSetting('llm.claude.models', ''), [
        getLocalSetting('llm.claude.model', 'claude-sonnet-5')
      ])
      return { engine: 'claude', model: models[0] || 'claude-sonnet-5', apiKey }
    }
    if (engine === 'gemini') {
      const apiKey = getLocalSetting('llm.gemini.api_key')
      if (!apiKey) continue
      const models = parseJsonModels(getLocalSetting('llm.gemini.models', ''), [
        getLocalSetting('llm.gemini.model', 'gemini-2.0-flash')
      ])
      return { engine: 'gemini', model: models[0] || 'gemini-2.0-flash', apiKey }
    }
    if (engine === 'cursor') {
      const apiKey = getLocalSetting('llm.cursor.api_key')
      if (!apiKey) continue
      const models = parseJsonModels(getLocalSetting('llm.cursor.models', ''), [
        getLocalSetting('llm.cursor.model', 'composer-2')
      ])
      return { engine: 'cursor', model: models[0] || 'composer-2', apiKey }
    }
  }
  return null
}

/**
 * Backend-down chat path. Keys stay in Main (settingsStore). Returns true if handled.
 */
export async function streamChatDirect(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void
): Promise<boolean> {
  await ensureSettingsLoaded()
  if (!hasUsableLocalLlm()) return false

  const requestBody =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const requested = typeof requestBody.engine === 'string' ? requestBody.engine : 'auto'
  const mode = typeof requestBody.mode === 'string' ? requestBody.mode : 'ask'
  const resolved = resolveLocalEngine(requested)
  if (!resolved) return false

  const ephemeralId = `local-${Date.now()}`
  const userMessage = {
    id: ephemeralId,
    role: 'user',
    content: typeof requestBody.message === 'string' ? requestBody.message : ''
  }

  onEvent({ type: 'user_message', message: userMessage })
  onEvent({
    type: 'route',
    engine: resolved.engine,
    task_type: 'local',
    model: resolved.model,
    fallback_reason: 'backend_offline_local_llm',
    mode,
    usage: undefined
  })

  try {
    if (resolved.engine === 'cursor') {
      const cwd =
        typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
      if (!cwd.trim()) {
        onEvent({
          type: 'error',
          code: 'NO_WORKSPACE',
          message: 'ローカル Cursor Agent にはワークスペースが必要です'
        })
        return true
      }
      const { runCursorAgent } = await import('./cursorAgent')
      const result = await runCursorAgent({
        cwd,
        prompt: String(requestBody.message ?? ''),
        apiKey: resolved.apiKey,
        model: resolved.model,
        runtime:
          (getLocalSetting('llm.cursor.runtime', 'auto') as 'auto' | 'local' | 'cloud') || 'auto',
        onDelta: (text) => onEvent({ type: 'delta', text })
      })
      onEvent({
        type: 'done',
        model: resolved.model,
        engine: 'cursor',
        task_type: 'local',
        assistant_message: {
          id: `local-assistant-${Date.now()}`,
          role: 'assistant',
          content: result.text
        }
      })
      return true
    }

    if (mode === 'agent') {
      const workspacePath =
        typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
      if (!workspacePath.trim()) {
        onEvent({
          type: 'error',
          code: 'NO_WORKSPACE',
          message: 'ローカル Agent にはワークスペースが必要です'
        })
        return true
      }
      if (resolved.engine !== 'openai' && resolved.engine !== 'claude') {
        onEvent({
          type: 'error',
          code: 'AGENT_TOOLS_UNAVAILABLE',
          message: 'オフライン Agent は OpenAI または Claude のみ対応です'
        })
        return true
      }
      const { runToolAgent } = await import('./toolAgent')
      const messages = buildMessages(requestBody)
      await runToolAgent({
        workspacePath,
        apiKey: resolved.apiKey,
        baseUrl:
          resolved.engine === 'claude'
            ? 'https://api.anthropic.com'
            : resolved.baseUrl || 'https://api.openai.com/v1',
        model: resolved.model,
        extraHeaders: [],
        messages,
        engine: resolved.engine,
        taskType: 'local',
        sessionId: 0,
        problems: [],
        onEvent,
        complete: async (content) => ({
          assistant_message: {
            id: `local-assistant-${Date.now()}`,
            role: 'assistant',
            content
          },
          estimated_usd: 0,
          usage: {
            cursor: { spent: 0, limit: 0, remaining: 0 },
            openai: { spent: 0, limit: 0, remaining: 0 },
            gemini: { spent: 0, limit: 0, remaining: 0 },
            claude: { spent: 0, limit: 0, remaining: 0 },
            workers: { spent: 0, limit: 0, remaining: 0 }
          }
        })
      })
      return true
    }

    const messages = buildMessages(requestBody)
    let content = ''
    if (resolved.engine === 'openai') {
      content = await callOpenAiCompatible({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl || 'https://api.openai.com/v1',
        model: resolved.model,
        messages
      })
    } else if (resolved.engine === 'claude') {
      content = await callClaude({
        apiKey: resolved.apiKey,
        model: resolved.model,
        messages
      })
    } else {
      content = await callGemini({
        apiKey: resolved.apiKey,
        model: resolved.model,
        messages
      })
    }

    onEvent({ type: 'delta', text: content })
    onEvent({
      type: 'done',
      model: resolved.model,
      engine: resolved.engine,
      task_type: 'local',
      assistant_message: {
        id: `local-assistant-${Date.now()}`,
        role: 'assistant',
        content
      }
    })
    return true
  } catch (error) {
    onEvent({
      type: 'error',
      code: 'LOCAL_LLM_FAILED',
      message: error instanceof Error ? error.message : 'ローカル LLM に失敗しました'
    })
    return true
  }
}
