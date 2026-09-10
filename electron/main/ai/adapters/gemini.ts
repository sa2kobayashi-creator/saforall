import { getLocalSetting } from '../../settingsStore'
import { aiErrorFromHttp, AIError, redactLooksLikeSecret, throwAgentUnsupported } from '../errors'
import { newRequestId, tokensFromText, type AIRequest, type AIResponse, type Credential } from '../types'
import { parseSettingModels, type AIProviderAdapter } from './types'

const DEFAULT_MODEL = 'gemini-2.0-flash'

export const geminiAdapter: AIProviderAdapter = {
  providerId: 'gemini',
  providerName: 'Gemini',

  availableModels() {
    return parseSettingModels(getLocalSetting('llm.gemini.models', ''), [
      getLocalSetting('llm.gemini.model', DEFAULT_MODEL)
    ])
  },

  async generate(request: AIRequest, credential: Credential): Promise<AIResponse> {
    const model = request.model || getLocalSetting('llm.gemini.model', DEFAULT_MODEL)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []
    for (const m of request.messages) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue
      const role = m.role === 'assistant' ? 'model' : 'user'
      if (Array.isArray(m.content)) {
        const parts: Array<Record<string, unknown>> = []
        for (const block of m.content) {
          if (!block || typeof block !== 'object') continue
          const row = block as Record<string, unknown>
          if (typeof row.text === 'string') parts.push({ text: row.text })
        }
        if (parts.length > 0) contents.push({ role, parts })
        continue
      }
      contents.push({ role, parts: [{ text: String(m.content ?? '') }] })
    }
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': credential.secret
        },
        body: JSON.stringify({ contents })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      throw new AIError('NETWORK_ERROR', message, { providerId: 'gemini' })
    }
    const text = await response.text()
    if (!response.ok) {
      throw aiErrorFromHttp('gemini', response.status, text)
    }
    let json: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      throw new AIError('PROVIDER_ERROR', 'Gemini の応答が JSON ではありません', {
        providerId: 'gemini'
      })
    }
    const content = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
    if (!content.trim()) {
      throw new AIError('PROVIDER_ERROR', 'Gemini から本文を取得できませんでした', {
        providerId: 'gemini'
      })
    }
    const inputTokens =
      Number(json.usageMetadata?.promptTokenCount) || tokensFromText(JSON.stringify(contents))
    const outputTokens = Number(json.usageMetadata?.candidatesTokenCount) || tokensFromText(content)
    return {
      provider: 'gemini',
      model,
      content,
      finishReason: json.candidates?.[0]?.finishReason ?? null,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      requestId: newRequestId(),
      metadata: {}
    }
  },

  async generateWithTools() {
    throwAgentUnsupported('gemini')
  },

  async healthCheck(credential: Credential) {
    if (!credential.secret.trim()) return { ok: false, message: 'not configured' }
    try {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
      url.searchParams.set('pageSize', '1')
      url.searchParams.set('key', credential.secret)
      const response = await fetch(url)
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
