import { getLocalSetting } from '../../settingsStore'
import { modelOmitsTemperature } from '../agentMessages'
import { aiErrorFromHttp, AIError, redactLooksLikeSecret } from '../errors'
import { newRequestId, tokensFromText, type AIRequest, type AIResponse, type Credential } from '../types'
import { parseSettingModels, type AIProviderAdapter } from './types'

/** Official DeepSeek Chat Completions (api-docs.deepseek.com, checked 2026-09-22). Dedicated adapter. */
const DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-pro']
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

function buildDeepSeekAskBody(
  model: string,
  messages: AIRequest['messages'],
  _temperature?: number
): Record<string, unknown> {
  // Thinking is API default. temperature ignored in thinking mode. reasoning_content is not shown in UI.
  void modelOmitsTemperature
  void _temperature
  return {
    model,
    messages,
    thinking: { type: 'enabled' }
  }
}

function extractContent(json: {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}): { content: string; finishReason: string | null; inputTokens: number; outputTokens: number } {
  const choice = json.choices?.[0]
  const raw = choice?.message?.content
  const content = typeof raw === 'string' ? raw : ''
  const inputTokens = Number(json.usage?.prompt_tokens) || 0
  const outputTokens = Number(json.usage?.completion_tokens) || 0
  return {
    content,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    inputTokens,
    outputTokens
  }
}

export const deepseekAdapter: AIProviderAdapter = {
  providerId: 'deepseek',
  providerName: 'DeepSeek',

  availableModels() {
    return parseSettingModels(getLocalSetting('llm.deepseek.models', ''), [
      getLocalSetting('llm.deepseek.model', DEFAULT_MODELS[0]),
      ...DEFAULT_MODELS
    ])
  },

  async generate(request: AIRequest, credential: Credential): Promise<AIResponse> {
    const model = request.model || getLocalSetting('llm.deepseek.model', DEFAULT_MODELS[0])
    const baseUrl = (
      request.baseUrl ||
      credential.baseUrl ||
      getLocalSetting('llm.deepseek.base_url', DEFAULT_BASE_URL) ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '')
    const url = `${baseUrl}/chat/completions`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.secret}`
        },
        body: JSON.stringify(buildDeepSeekAskBody(model, request.messages, request.temperature))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      throw new AIError('NETWORK_ERROR', message, { providerId: 'deepseek' })
    }
    const text = await response.text()
    if (!response.ok) {
      throw aiErrorFromHttp('deepseek', response.status, text)
    }
    let json: Parameters<typeof extractContent>[0]
    try {
      json = JSON.parse(text) as Parameters<typeof extractContent>[0]
    } catch {
      throw new AIError('PROVIDER_ERROR', 'DeepSeek returned empty content', {
        providerId: 'deepseek',
        httpStatus: response.status
      })
    }
    const parsed = extractContent(json)
    if (!parsed.content.trim()) {
      throw new AIError('PROVIDER_ERROR', 'DeepSeek から本文を取得できませんでした', {
        providerId: 'deepseek'
      })
    }
    const inputTokens = parsed.inputTokens || tokensFromText(JSON.stringify(request.messages))
    const outputTokens = parsed.outputTokens || tokensFromText(parsed.content)
    return {
      provider: 'deepseek',
      model,
      content: parsed.content,
      finishReason: parsed.finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      requestId: newRequestId(),
      metadata: { baseUrl }
    }
  },

  async generateWithTools(request, credential, options) {
    const model = request.model || getLocalSetting('llm.deepseek.model', DEFAULT_MODELS[0])
    const baseUrl = (
      request.baseUrl ||
      credential.baseUrl ||
      getLocalSetting('llm.deepseek.base_url', DEFAULT_BASE_URL) ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '')
    const callParams = {
      secret: credential.secret,
      baseUrl,
      model,
      extraHeaders: request.extraHeaders ?? [],
      messages: options.messages,
      tools: options.tools,
      toolChoice: options.toolChoice,
      timeoutMs: options.timeoutMs,
      signal: options.signal
    }
    // Chat Completions + function calling only (no OpenAI Responses path).
    const completion = await (await import('./deepseekTools')).deepseekChatCompletionsWithTools(callParams)
    const inputTokens = Number(completion.usage?.prompt_tokens) || 0
    const outputTokens = Number(completion.usage?.completion_tokens) || 0
    return {
      completion,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      requestId: newRequestId(),
      model
    }
  },

  async healthCheck(credential: Credential) {
    const baseUrl = (
      credential.baseUrl ||
      getLocalSetting('llm.deepseek.base_url', DEFAULT_BASE_URL) ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '')
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${credential.secret}` }
      })
      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}` }
      }
      return { ok: true, message: 'connected' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      return { ok: false, message: redactLooksLikeSecret(message) }
    }
  }
}
