import type { AgentToolGenerateResult, GenerateWithToolsOptions } from '../toolTypes'
import type { AIRequest, AIResponse, Credential, LlmProviderId } from '../types'

export interface AIProviderAdapter {
  readonly providerId: LlmProviderId
  readonly providerName: string
  availableModels(): string[]
  generate(request: AIRequest, credential: Credential): Promise<AIResponse>
  generateWithTools(
    request: AIRequest,
    credential: Credential,
    options: GenerateWithToolsOptions
  ): Promise<AgentToolGenerateResult>
  healthCheck(credential: Credential): Promise<{ ok: boolean; message: string }>
}

export function parseSettingModels(raw: string, fallback: string[]): string[] {
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
