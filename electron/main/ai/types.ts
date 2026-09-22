/** LLM API providers. Cursor is a coding agent, not an LLM adapter. */
export type LlmProviderId = 'openai' | 'gemini' | 'claude' | 'workers' | 'grok' | 'deepseek'
export type CodingAgentId = 'cursor'
export type ProviderId = LlmProviderId | CodingAgentId
export type ProviderKind = 'llm' | 'coding_agent'

export type CredentialOwnerType = 'development' | 'user' | 'organization' | 'platform'
export type BillingMode = 'DEVELOPMENT' | 'BYOK' | 'ORGANIZATION' | 'MANAGED'
export type RoutingMode = 'manual' | 'auto'
export type CredentialSource = 'settings' | 'env' | 'byok' | ''

export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [
  'openai',
  'gemini',
  'claude',
  'workers',
  'grok',
  'deepseek'
]

export const PROVIDER_KIND: Record<ProviderId, ProviderKind> = {
  openai: 'llm',
  gemini: 'llm',
  claude: 'llm',
  workers: 'llm',
  grok: 'llm',
  deepseek: 'llm',
  cursor: 'coding_agent'
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude',
  workers: 'Cloudflare Workers AI',
  grok: 'Grok (xAI)',
  deepseek: 'DeepSeek',
  cursor: 'Cursor'
}

export type AIChatMessage = {
  role: string
  content: unknown
}

export type AIUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type AIRequest = {
  provider: ProviderId | 'auto'
  routingMode?: RoutingMode
  model?: string
  messages: AIChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  extraHeaders?: string[]
  baseUrl?: string
  metadata?: Record<string, unknown>
}

export type AIResponse = {
  provider: LlmProviderId
  model: string
  content: string
  finishReason: string | null
  usage: AIUsage
  requestId: string
  metadata: Record<string, unknown>
}

export type Credential = {
  id: string
  providerId: ProviderId
  ownerType: CredentialOwnerType
  billingMode: BillingMode
  source: CredentialSource
  /** Raw secret. Never log, never send to renderer. */
  secret: string
  baseUrl: string
  extra: Record<string, string>
}

export type ResolveInput = {
  providerId: ProviderId
  userId?: string | null
  organizationId?: string | null
  requestedModel?: string
}

export type ResolveResult = {
  credential: Credential | null
  available: boolean
  billingMode: BillingMode
  reason: string
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value)
}

export function parseProviderId(value: string): ProviderId | null {
  const id = value.trim().toLowerCase()
  if (id === 'openai' || id === 'gemini' || id === 'claude' || id === 'workers' || id === 'grok' || id === 'deepseek' || id === 'cursor') {
    return id
  }
  return null
}

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function tokensFromText(text: string): number {
  const chars = text.length
  return Math.max(1, Math.ceil(chars / 4))
}
