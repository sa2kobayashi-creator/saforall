import type { LlmProviderId } from './types'
import { AIError } from './errors'
import type { AIProviderAdapter } from './adapters/types'
import { openaiAdapter } from './adapters/openai'
import { geminiAdapter } from './adapters/gemini'
import { claudeAdapter } from './adapters/claude'
import { workersAdapter } from './adapters/workers'

const adapters = new Map<LlmProviderId, AIProviderAdapter>()
let defaultsRegistered = false

export function registerProvider(adapter: AIProviderAdapter): void {
  adapters.set(adapter.providerId, adapter)
}

export function unregisterProvider(providerId: LlmProviderId): void {
  adapters.delete(providerId)
}

export function getProvider(providerId: LlmProviderId): AIProviderAdapter {
  ensureDefaultProviders()
  const adapter = adapters.get(providerId)
  if (!adapter) {
    throw new AIError('PROVIDER_ERROR', `Provider が登録されていません: ${providerId}`, {
      providerId
    })
  }
  return adapter
}

export function listProviders(): AIProviderAdapter[] {
  ensureDefaultProviders()
  return Array.from(adapters.values())
}

export function resetProviderRegistryForTests(): void {
  adapters.clear()
  defaultsRegistered = false
}

export function ensureDefaultProviders(): void {
  if (!adapters.has('openai')) registerProvider(openaiAdapter)
  if (!adapters.has('gemini')) registerProvider(geminiAdapter)
  if (!adapters.has('claude')) registerProvider(claudeAdapter)
  if (!adapters.has('workers')) registerProvider(workersAdapter)
  defaultsRegistered = true
}
