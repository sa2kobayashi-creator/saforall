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
  options?: ApiRequestOptions
): Promise<ApiResponse<T>> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
    const result = await fetchJson<HealthData>('GET', '/health')
    if (!result.ok || !result.data) {
      return {
        connected: false,
        baseUrl,
        message: result.error?.message ?? 'バックエンド未接続'
      }
    }

    const dbOk = result.data.database === 'connected'
    return {
      connected: dbOk,
      baseUrl,
      message: dbOk ? 'バックエンド接続済み' : 'DB 未接続',
      data: result.data
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'バックエンド応答タイムアウト'
        : 'バックエンド未接続'

    return {
      connected: false,
      baseUrl,
      message
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

export type ChatStreamEvent =
  | { type: 'user_message'; message: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; assistant_message: Record<string, unknown> }
  | { type: 'error'; code: string; message: string }

export async function streamChat(
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
