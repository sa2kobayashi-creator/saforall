export type AgentToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type AgentToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type AgentProviderMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | null | unknown[]
      tool_calls?: AgentToolCall[]
      /** DeepSeek thinking: echo on later turns when tools are present. */
      reasoning_content?: string | null
    }
  | { role: 'tool'; tool_call_id: string; content: string | null | unknown[] }

export type AgentChatCompletion = {
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      tool_calls?: AgentToolCall[]
      reasoning_content?: string | null
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  error?: { message?: string }
}

export type GenerateWithToolsOptions = {
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
}

export type AgentToolGenerateResult = {
  completion: AgentChatCompletion
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  requestId: string
  model: string
}
