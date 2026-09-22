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

export type DeepSeekToolsCallParams = {
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
 * DeepSeek Chat Completions tool calling. Dedicated adapter (providerId=deepseek). Thinking + reasoning_content round-trip.
 */
export async function deepseekChatCompletionsWithTools(
  params: DeepSeekToolsCallParams
): Promise<AgentChatCompletion> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  let lastError: Error | null = null
  // DeepSeek thinking mode rejects tool_choice=required ("Thinking mode does not support this tool_choice").
  // Keep thinking on for Agent quality and coerce required → auto.
  let thinkingEnabled = true
  let toolChoice: 'auto' | 'required' = 'auto'
  if (
    !thinkingEnabled &&
    params.toolChoice === 'required' &&
    modelAllowsRequiredToolChoice(params.model)
  ) {
    toolChoice = 'required'
  }
  let includeTemperature = !modelOmitsTemperature(params.model)
  let includeTools = Boolean(params.tools)

  const timeoutMs = params.timeoutMs ?? 45_000
  const { linkedAbortSignal, throwIfChatAborted, isChatAbortError } = await import('../../chatAbort')

  for (let attempt = 0; attempt < 6; attempt += 1) {
    throwIfChatAborted(params.signal)
    const body: Record<string, unknown> = {
      model: params.model,
      messages: normalizeMessagesForLlm(params.messages),
      // Keep thinking enabled; reasoning_content must be echoed on later tool turns.
      thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' }
    }
    void includeTemperature
    if (includeTools && params.tools) {
      body.tools = params.tools
      // When thinking is on, only "auto" is accepted.
      body.tool_choice = thinkingEnabled ? 'auto' : toolChoice
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
        throw aiErrorFromLlmHttp('deepseek', response.status, bodyText)
      }

      if (!response.ok) {
        const err = aiErrorFromLlmHttp('deepseek', response.status, bodyText)
        const lower = err.message.toLowerCase()
        if (response.status === 429 && attempt < 5) {
          lastError = err
          await sleepAbortable(parseRetryAfterMs(err.message, attempt), params.signal)
          continue
        }
        if (response.status === 400) {
          if (/thinking mode does not support this tool_choice/i.test(lower)) {
            // Coerce away from required / disable thinking only if still failing.
            if (toolChoice === 'required') {
              toolChoice = 'auto'
              lastError = err
              continue
            }
            if (thinkingEnabled) {
              thinkingEnabled = false
              lastError = err
              continue
            }
          }
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
                'deepseek',
                new Error(
                  `${err.message} — This DeepSeek model may not support function calling. Choose deepseek-flash or deepseek-v4-pro.`
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
        throw aiErrorFromCaught('deepseek', lastError)
      }
      await sleepAbortable(400 * (attempt + 1), params.signal)
    } finally {
      linked.dispose()
    }
  }

  throw aiErrorFromCaught('deepseek', lastError ?? new Error('LLM request failed'))
}
