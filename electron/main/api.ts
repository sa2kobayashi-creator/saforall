export type ApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export type HealthData = {
  service: string
  status: string
  database: string
  time: string
}

export type HealthResult = {
  connected: boolean
  baseUrl: string
  message: string
  data?: HealthData
}

export type ApiRequestOptions = {
  timeoutMs?: number
}

const DEFAULT_BASE_URL = 'http://localhost:8081/saforall/api'
const DEFAULT_TIMEOUT_MS = 3000

export function getApiBaseUrl(): string {
  return (process.env.SAFORALL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

async function fetchJson<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
  extraHeaders?: Record<string, string>
): Promise<ApiResponse<T>> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = extraHeaders ? { ...extraHeaders } : {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })

    const payload = (await response.json()) as ApiResponse<T>
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        error: payload.error ?? {
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}`
        }
      }
    }

    return payload
  } finally {
    clearTimeout(timer)
  }
}

export async function checkHealth(): Promise<HealthResult> {
  const baseUrl = getApiBaseUrl()

  try {
    const result = await fetchJson<HealthData & { hint?: string; detail?: string }>(
      'GET',
      '/health'
    )
    if (!result.ok || !result.data) {
      const raw = result.error?.message ?? 'バックエンド未接続'
      const looksDb =
        /DB_|database|mysql|SQLSTATE/i.test(raw) || result.error?.code === 'DB_CONNECTION_FAILED'
      return {
        connected: false,
        baseUrl,
        message: looksDb
          ? `MySQL 未接続 — XAMPP で MySQL を Start（${baseUrl}）`
          : `API 応答エラー — Apache / パスを確認（${baseUrl}）: ${raw}`
      }
    }

    const dbOk = result.data.database === 'connected'
    return {
      connected: dbOk,
      baseUrl,
      message: dbOk
        ? 'バックエンド接続済み'
        : `MySQL 未接続 — XAMPP で MySQL を Start（${baseUrl}）`,
      data: result.data
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return {
      connected: false,
      baseUrl,
      message: timedOut
        ? `Apache 応答なし — XAMPP で Apache を Start（${baseUrl}）`
        : `Apache 未接続 — XAMPP で Apache を Start（${baseUrl}）`
    }
  }
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions
): Promise<ApiResponse<T>> {
  try {
    return await fetchJson<T>(method, path, body, options)
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'バックエンド応答タイムアウト'
        : error instanceof Error
          ? error.message
          : 'バックエンド未接続'

    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message
      }
    }
  }
}

export type MonthUsage = Record<
  string,
  { spent: number; limit: number; remaining: number }
>

export type ChatStreamEvent =
  | { type: 'user_message'; message: Record<string, unknown> }
  | {
      type: 'route'
      engine: string
      task_type: string
      model: string
      fallback_reason?: string | null
      mode?: string
      policy_profile?: string
      usage?: MonthUsage
    }
  | { type: 'delta'; text: string }
  | {
      type: 'tool_call'
      id: string
      name: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      id: string
      name: string
      ok: boolean
      summary: string
    }
  | {
      type: 'edit_proposal'
      path: string
      content: string
    }
  | {
      type: 'agent_phase'
      phase: 'plan' | 'explore' | 'edit' | 'verify'
      note?: string
    }
  | {
      type: 'agent_checkpoint'
      step: number
      phase: string
      summary: string
    }
  | {
      type: 'done'
      model: string
      engine?: string
      task_type?: string
      estimated_usd?: number
      usage?: MonthUsage
      assistant_message: Record<string, unknown>
      used_tools?: boolean
    }
  | { type: 'error'; code: string; message: string }

type RouteData = {
  engine: 'cursor' | 'openai' | 'gemini' | 'workers'
  requested: string
  task_type: string
  fallback_from: string | null
  fallback_reason: string | null
  mode?: string
  policy_profile?: string
  model: string
  session_id: number
  user_message_id: number
  user_message: Record<string, unknown>
  cursor_run_id: number | null
  usage: MonthUsage
  cursor_api_key: string | null
  provider?: {
    api_key: string
    base_url: string
    extra_headers: string[]
    messages: Array<{ role: string; content: string }>
  } | null
}

export async function streamChat(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  const requestBody =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}

  const route = await fetchJson<RouteData>(
    'POST',
    '/ai/route',
    requestBody,
    { timeoutMs: 20_000 },
    { 'X-Saforall-Client': 'electron-main' }
  )

  if (!route.ok || !route.data) {
    onEvent({
      type: 'error',
      code: route.error?.code ?? 'ROUTE_FAILED',
      message: route.error?.message ?? 'AI Router に失敗しました'
    })
    return
  }

  const decided = route.data
  onEvent({
    type: 'user_message',
    message: decided.user_message
  })
  onEvent({
    type: 'route',
    engine: decided.engine,
    task_type: decided.task_type,
    model: decided.model,
    fallback_reason: decided.fallback_reason,
    mode: decided.mode,
    policy_profile: decided.policy_profile,
    usage: decided.usage
  })

  if (decided.engine === 'cursor') {
    await runCursorStream(requestBody, decided, onEvent)
    return
  }

  const mode = typeof decided.mode === 'string' ? decided.mode : 'ask'
  const workspacePath =
    typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
  const canToolAgent =
    mode === 'agent' &&
    workspacePath.trim() !== '' &&
    decided.engine !== 'gemini' &&
    decided.provider &&
    decided.provider.api_key &&
    decided.provider.base_url &&
    decided.provider.base_url !== 'gemini-native'

  if (canToolAgent && decided.provider) {
    try {
      const { runToolAgent } = await import('./toolAgent')
      await runToolAgent({
        workspacePath,
        apiKey: decided.provider.api_key,
        baseUrl: decided.provider.base_url,
        model: decided.model,
        extraHeaders: decided.provider.extra_headers ?? [],
        messages: decided.provider.messages ?? [],
        engine: decided.engine,
        taskType: decided.task_type,
        sessionId: decided.session_id,
        onEvent,
        complete: async (content) => {
          const completed = await fetchJson<{
            assistant_message: Record<string, unknown>
            estimated_usd: number
            usage: MonthUsage
          }>(
            'POST',
            '/ai/complete',
            {
              session_id: decided.session_id,
              content,
              engine: decided.engine,
              task_type: decided.task_type,
              model: decided.model,
              fallback_from: decided.fallback_from
            },
            { timeoutMs: 15_000 }
          )
          if (!completed.ok || !completed.data) return null
          return completed.data
        }
      })
    } catch (error) {
      onEvent({
        type: 'error',
        code: 'TOOL_AGENT_FAILED',
        message: error instanceof Error ? error.message : 'Tool Agent の実行に失敗しました'
      })
    }
    return
  }

  await streamProviderChat(
    {
      ...requestBody,
      engine: decided.engine,
      user_message_id: decided.user_message_id,
      resolved_engine: decided.engine,
      requested: decided.requested,
      task_type: decided.task_type,
      fallback_from: decided.fallback_from,
      fallback_reason: decided.fallback_reason
    },
    onEvent
  )
}

async function runCursorStream(
  requestBody: Record<string, unknown>,
  decided: RouteData,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  const cwd =
    typeof requestBody.workspace_path === 'string'
      ? requestBody.workspace_path
      : ''
  const prompt =
    typeof requestBody.message === 'string' ? requestBody.message : ''
  const apiKey = decided.cursor_api_key ?? process.env.CURSOR_API_KEY ?? ''

  if (cwd.trim() === '') {
    onEvent({
      type: 'error',
      code: 'NO_WORKSPACE',
      message: 'Cursor Agent にはワークスペース（フォルダを開く）が必要です'
    })
    return
  }
  if (apiKey.trim() === '') {
    onEvent({
      type: 'error',
      code: 'LLM_NOT_CONFIGURED',
      message: 'Cursor API キーが未設定です'
    })
    return
  }

  try {
    const { runCursorAgent } = await import('./cursorAgent')
    const result = await runCursorAgent({
      apiKey,
      model: decided.model,
      cwd,
      prompt,
      onDelta: (text) => {
        onEvent({ type: 'delta', text })
      }
    })

    const completed = await fetchJson<{
      assistant_message: Record<string, unknown>
      estimated_usd: number
      usage: MonthUsage
    }>(
      'POST',
      '/ai/complete',
      {
        session_id: decided.session_id,
        content: result.text,
        engine: 'cursor',
        task_type: decided.task_type,
        model: decided.model,
        cursor_run_id: decided.cursor_run_id,
        agent_id: result.agentId,
        sdk_run_id: result.runId,
        status: result.status === 'error' ? 'error' : 'done',
        fallback_from: decided.fallback_from
      },
      { timeoutMs: 15_000 }
    )

    if (!completed.ok || !completed.data) {
      onEvent({
        type: 'error',
        code: completed.error?.code ?? 'COMPLETE_FAILED',
        message: completed.error?.message ?? 'Cursor 結果の保存に失敗しました'
      })
      return
    }

    onEvent({
      type: 'done',
      model: decided.model,
      engine: 'cursor',
      task_type: decided.task_type,
      estimated_usd: completed.data.estimated_usd,
      usage: completed.data.usage,
      assistant_message: completed.data.assistant_message
    })
  } catch (error) {
    onEvent({
      type: 'error',
      code: 'CURSOR_SDK_FAILED',
      message: error instanceof Error ? error.message : 'Cursor SDK の実行に失敗しました'
    })
  }
}

async function streamProviderChat(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}/ai/chat/stream`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const contentType = response.headers.get('content-type') ?? ''

    // ストリーム開始前の JSON エラー（未設定キーなど）
    if (!contentType.includes('text/event-stream')) {
      const payload = (await response.json()) as ApiResponse
      onEvent({
        type: 'error',
        code: payload.error?.code ?? 'HTTP_ERROR',
        message: payload.error?.message ?? `HTTP ${response.status}`
      })
      return
    }

    if (!response.body) {
      onEvent({
        type: 'error',
        code: 'NETWORK_ERROR',
        message: 'ストリーム本文がありません'
      })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const chunk = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const line = chunk
          .split('\n')
          .map((part) => part.trim())
          .find((part) => part.startsWith('data:'))

        if (line) {
          const data = line.slice(5).trim()
          try {
            const event = JSON.parse(data) as ChatStreamEvent
            if (event.type === 'user_message' || event.type === 'route') {
              continue
            }
            onEvent(event)
            if (event.type === 'done' || event.type === 'error') {
              return
            }
          } catch {
            // ignore malformed event
          }
        }

        separator = buffer.indexOf('\n\n')
      }
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'バックエンド応答タイムアウト'
        : error instanceof Error
          ? error.message
          : 'バックエンド未接続'

    onEvent({
      type: 'error',
      code: 'NETWORK_ERROR',
      message
    })
  } finally {
    clearTimeout(timer)
  }
}
