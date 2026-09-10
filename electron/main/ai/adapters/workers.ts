import { getLocalSetting } from '../../settingsStore'
import { extraHeadersFor } from '../credentials'
import { aiErrorFromHttp, AIError, redactLooksLikeSecret, throwAgentUnsupported } from '../errors'
import { newRequestId, tokensFromText, type AIRequest, type AIResponse, type Credential } from '../types'
import { parseSettingModels, type AIProviderAdapter } from './types'

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct'

function parseExtraHeaders(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

export const workersAdapter: AIProviderAdapter = {
  providerId: 'workers',
  providerName: 'Cloudflare Workers AI',

  availableModels() {
    return parseSettingModels(
      getLocalSetting('llm.workers.models', '') || getLocalSetting('llm.simple.models', ''),
      [getLocalSetting('llm.workers.model', DEFAULT_MODEL)]
    )
  },

  async generate(request: AIRequest, credential: Credential): Promise<AIResponse> {
    const model = request.model || getLocalSetting('llm.workers.model', DEFAULT_MODEL)
    const baseUrl = (request.baseUrl || credential.baseUrl || '').replace(/\/$/, '')
    if (!baseUrl) {
      throw new AIError('AUTH_ERROR', 'Workers AI の Account ID が未設定です', {
        providerId: 'workers'
      })
    }
    const extra = parseExtraHeaders([
      ...extraHeadersFor(credential),
      ...(request.extraHeaders ?? [])
    ])
    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.secret}`,
          ...extra
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error'
      throw new AIError('NETWORK_ERROR', message, { providerId: 'workers' })
    }
    const text = await response.text()
    if (!response.ok) {
      throw aiErrorFromHttp('workers', response.status, text)
    }
    let json: {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      throw new AIError('PROVIDER_ERROR', 'Workers AI の応答が JSON ではありません', {
        providerId: 'workers'
      })
    }
    const raw = json.choices?.[0]?.message?.content
    const content = typeof raw === 'string' ? raw : ''
    if (!content.trim()) {
      throw new AIError('PROVIDER_ERROR', 'Workers AI から本文を取得できませんでした', {
        providerId: 'workers'
      })
    }
    const inputTokens = Number(json.usage?.prompt_tokens) || tokensFromText(JSON.stringify(request.messages))
    const outputTokens = Number(json.usage?.completion_tokens) || tokensFromText(content)
    return {
      provider: 'workers',
      model,
      content,
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      requestId: newRequestId(),
      metadata: { baseUrl }
    }
  },

  async generateWithTools() {
    throwAgentUnsupported('workers')
  },

  async healthCheck(credential: Credential) {
    if (!credential.secret.trim()) return { ok: false, message: 'not configured' }
    const accountId = credential.extra.accountId || ''
    if (!accountId) return { ok: false, message: 'Account ID が未設定です' }
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search`,
        {
          headers: {
            Authorization: `Bearer ${credential.secret}`
          }
        }
      )
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
