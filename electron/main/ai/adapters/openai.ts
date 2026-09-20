import { getLocalSetting } from '../../settingsStore'
import { modelOmitsTemperature } from '../agentMessages'
import { aiErrorFromHttp, AIError, redactLooksLikeSecret } from '../errors'
import { newRequestId, tokensFromText, type AIRequest, type AIResponse, type Credential } from '../types'
import { parseSettingModels, type AIProviderAdapter } from './types'

const DEFAULT_MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o']

/** Ask Chat Completions body: omit temperature for models that Agent already omits. */
function buildOpenAiAskBody(
  model: string,
  messages: AIRequest['messages'],
  temperature?: number
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages }
  if (!modelOmitsTemperature(model)) {
    body.temperature = temperature ?? 0.2
  }
  return body
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

export const openaiAdapter: AIProviderAdapter = {
  providerId: 'openai',
  providerName: 'OpenAI',

  availableModels() {
    return parseSettingModels(getLocalSetting('llm.openai.models', ''), [
      getLocalSetting('llm.openai.model', DEFAULT_MODELS[0]),
      ...DEFAULT_MODELS
    ])
  },

  async generate(request: AIRequest, credential: Credential): Promise<AIResponse> {
    const model = request.model || getLocalSetting('llm.openai.model', DEFAULT_MODELS[0])
    const baseUrl = (request.baseUrl || credential.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      ''
    )
    const url = `${baseUrl}/chat/completions`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.secret}`
        },
        body: JSON.stringify(buildOpenAiAskBody(model, request.messages, request.temperature))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      throw new AIError('NETWORK_ERROR', message, { providerId: 'openai' })
    }
    const text = await response.text()
    if (!response.ok) {
      throw aiErrorFromHttp('openai', response.status, text)
    }
    let json: Parameters<typeof extractContent>[0]
    try {
      json = JSON.parse(text) as Parameters<typeof extractContent>[0]
    } catch {
      throw new AIError('PROVIDER_ERROR', 'OpenAI の応答が JSON ではありません', {
        providerId: 'openai',
        httpStatus: response.status
      })
    }
    const parsed = extractContent(json)
    if (!parsed.content.trim()) {
      throw new AIError('PROVIDER_ERROR', 'OpenAI から本文を取得できませんでした', {
        providerId: 'openai'
      })
    }
    const inputTokens = parsed.inputTokens || tokensFromText(JSON.stringify(request.messages))
    const outputTokens = parsed.outputTokens || tokensFromText(parsed.content)
    return {
      provider: 'openai',
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
    const model = request.model || getLocalSetting('llm.openai.model', DEFAULT_MODELS[0])
    const baseUrl = (request.baseUrl || credential.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      ''
    )
    const { openaiChatCompletionsWithTools } = await import('./openaiTools')
    const completion = await openaiChatCompletionsWithTools({
      secret: credential.secret,
      baseUrl,
      model,
      extraHeaders: request.extraHeaders ?? [],
      messages: options.messages,
      tools: options.tools,
      toolChoice: options.toolChoice,
      timeoutMs: options.timeoutMs,
      signal: options.signal
    })
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
    const baseUrl = (credential.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
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
