import {
  aiErrorFromCaught,
  aiErrorFromLlmHttp,
  isRateLimitError,
  modelAllowsRequiredToolChoice,
  modelOmitsTemperature,
  normalizeMessagesForLlm,
  parseExtraHeaders,
  parseRetryAfterMs
} from '../agentMessages'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolSpec } from '../toolTypes'

export type OpenAiToolsCallParams = {
  secret: string
  baseUrl: string
  model: string
  extraHeaders?: string[]
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
}

async function sleepAbortable(ms: number, signal?: AbortSignal | null): Promise<void> {
  const { throwIfChatAborted } = await import('../../chatAbort')
  throwIfChatAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      const err = new Error('Chat cancelled by user')
      err.name = 'AbortError'
      reject(err)
    }
    if (!signal) return
    if (signal.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  throwIfChatAborted(signal)
}

/**
 * OpenAI Chat Completions tool calling. Behavior copied from toolAgent.callChatCompletions.
 */
export async function openaiChatCompletionsWithTools(
  params: OpenAiToolsCallParams
): Promise<AgentChatCompletion> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  let lastError: Error | null = null
  let toolChoice: 'auto' | 'required' =
    params.toolChoice === 'required' && modelAllowsRequiredToolChoice(params.model)
      ? 'required'
      : 'auto'
  let includeTemperature = !modelOmitsTemperature(params.model)
  let includeTools = Boolean(params.tools)

  const timeoutMs = params.timeoutMs ?? 45_000
  const { linkedAbortSignal, throwIfChatAborted, isChatAbortError } = await import('../../chatAbort')

  for (let attempt = 0; attempt < 6; attempt += 1) {
    throwIfChatAborted(params.signal)
    const body: Record<string, unknown> = {
      model: params.model,
      messages: normalizeMessagesForLlm(params.messages)
    }
    if (includeTemperature) body.temperature = 0.2
    if (includeTools && params.tools) {
      body.tools = params.tools
      body.tool_choice = toolChoice
    }

    const linked = linkedAbortSignal(timeoutMs, params.signal)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.secret}`,
          ...parseExtraHeaders(params.extraHeaders ?? [])
        },
        body: JSON.stringify(body),
        signal: linked.signal
      })

      const bodyText = await response.text()
      let json: AgentChatCompletion
      try {
        json = JSON.parse(bodyText) as AgentChatCompletion
      } catch {
        throw aiErrorFromLlmHttp('openai', response.status, bodyText)
      }

      if (!response.ok) {
        const err = aiErrorFromLlmHttp('openai', response.status, bodyText)
        const lower = err.message.toLowerCase()
        if (response.status === 429 && attempt < 5) {
          lastError = err
          await sleepAbortable(parseRetryAfterMs(err.message, attempt), params.signal)
          continue
        }
        if (response.status === 400) {
          if (toolChoice === 'required') {
            toolChoice = 'auto'
            lastError = err
            continue
          }
          if (includeTemperature && /temperature|unsupported_value|unknown parameter/i.test(lower)) {
            includeTemperature = false
            lastError = err
            continue
          }
          if (includeTools && /tool_choice|tools|function/i.test(lower)) {
            if (/not support|unsupported|does not support/i.test(lower)) {
              throw aiErrorFromCaught(
                'openai',
                new Error(
                  `${err.message} — このモデル/プロバイダは function calling 未対応の可能性があります。設定で gpt-4.1 / gpt-4o 系の OpenAI モデルを選んでください。`
                )
              )
            }
          }
        }
        throw err
      }
      return json
    } catch (error) {
      if (isChatAbortError(error) || params.signal?.aborted) {
        throw error
      }
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 5 && isRateLimitError(lastError.message)) {
        await sleepAbortable(parseRetryAfterMs(lastError.message, attempt), params.signal)
        continue
      }
      if (attempt < 3 && /LLM HTTP 400/i.test(lastError.message) && toolChoice === 'required') {
        toolChoice = 'auto'
        continue
      }
      if (attempt < 3 && /abort|network|fetch failed|ECONNRESET/i.test(lastError.message)) {
        await sleepAbortable(500 * (attempt + 1), params.signal)
        continue
      }
      if (!/LLM HTTP 400/i.test(lastError.message) || attempt >= 3) {
        throw aiErrorFromCaught('openai', lastError)
      }
      await sleepAbortable(400 * (attempt + 1), params.signal)
    } finally {
      linked.dispose()
    }
  }

  throw aiErrorFromCaught('openai', lastError ?? new Error('LLM request failed'))
}
