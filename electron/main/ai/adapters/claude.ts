import { getLocalSetting } from '../../settingsStore'
import { aiErrorFromHttp, AIError, redactLooksLikeSecret } from '../errors'
import { newRequestId, tokensFromText, type AIRequest, type AIResponse, type Credential } from '../types'
import { parseSettingModels, type AIProviderAdapter } from './types'

const DEFAULT_MODEL = 'claude-sonnet-5'

export const claudeAdapter: AIProviderAdapter = {
  providerId: 'claude',
  providerName: 'Claude',

  availableModels() {
    return parseSettingModels(getLocalSetting('llm.claude.models', ''), [
      getLocalSetting('llm.claude.model', DEFAULT_MODEL)
    ])
  },

  async generate(request: AIRequest, credential: Credential): Promise<AIResponse> {
    const model = request.model || getLocalSetting('llm.claude.model', DEFAULT_MODEL)
    const base = (request.baseUrl || credential.baseUrl || 'https://api.anthropic.com').replace(
      /\/$/,
      ''
    )
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .filter(Boolean)
      .join('\n\n')
    const msgs = request.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
    let response: Response
    try {
      response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': credential.secret,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? 4096,
          system: system || undefined,
          messages: msgs
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      throw new AIError('NETWORK_ERROR', message, { providerId: 'claude' })
    }
    const text = await response.text()
    if (!response.ok) {
      throw aiErrorFromHttp('claude', response.status, text)
    }
    let json: {
      content?: Array<{ type?: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
      stop_reason?: string
    }
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      throw new AIError('PROVIDER_ERROR', 'Claude の応答が JSON ではありません', {
        providerId: 'claude'
      })
    }
    const content = (json.content ?? [])
      .filter((row) => row.type === 'text' && row.text)
      .map((row) => row.text)
      .join('\n')
    if (!content.trim()) {
      throw new AIError('PROVIDER_ERROR', 'Claude から本文を取得できませんでした', {
        providerId: 'claude'
      })
    }
    const inputTokens = Number(json.usage?.input_tokens) || tokensFromText(JSON.stringify(msgs))
    const outputTokens = Number(json.usage?.output_tokens) || tokensFromText(content)
    return {
      provider: 'claude',
      model,
      content,
      finishReason: json.stop_reason ?? null,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      requestId: newRequestId(),
      metadata: {}
    }
  },

  async generateWithTools(request, credential, options) {
    const model = request.model || getLocalSetting('llm.claude.model', DEFAULT_MODEL)
    const base = (request.baseUrl || credential.baseUrl || 'https://api.anthropic.com').replace(
      /\/$/,
      ''
    )
    const { claudeMessagesWithTools } = await import('./claudeTools')
    const completion = await claudeMessagesWithTools({
      secret: credential.secret,
      baseUrl: base,
      model,
      messages: options.messages,
      tools: options.tools,
      toolChoice: options.toolChoice,
      timeoutMs: options.timeoutMs,
      signal: options.signal
    })
    const inputTokens = Number(completion.usage?.input_tokens) || 0
    const outputTokens = Number(completion.usage?.output_tokens) || 0
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
    if (!credential.secret.trim()) return { ok: false, message: 'not configured' }
    const base = (credential.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
    const url = `${base.endsWith('/v1') ? base : `${base}/v1`}/models`
    try {
      const response = await fetch(url, {
        headers: {
          'x-api-key': credential.secret,
          'anthropic-version': '2023-06-01'
        }
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
