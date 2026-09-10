import {
  aiErrorFromCaught,
  aiErrorFromLlmHttp,
  anthropicBase,
  toAnthropicMessages,
  toAnthropicTools
} from '../agentMessages'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolCall, AgentToolSpec } from '../toolTypes'

export type ClaudeToolsCallParams = {
  secret: string
  baseUrl: string
  model: string
  messages: AgentProviderMessage[]
  tools?: AgentToolSpec[]
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
}

/**
 * Anthropic Messages API tool_use. Behavior copied from toolAgent.callAnthropicMessages.
 */
export async function claudeMessagesWithTools(
  params: ClaudeToolsCallParams
): Promise<AgentChatCompletion> {
  const url = `${anthropicBase(params.baseUrl)}/messages`
  const { system, messages } = toAnthropicMessages(params.messages)
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: 8192,
    messages
  }
  if (system.trim() !== '') body.system = system
  if (params.tools && params.tools.length > 0) {
    body.tools = toAnthropicTools(params.tools)
    body.tool_choice = params.toolChoice === 'required' ? { type: 'any' } : { type: 'auto' }
  }

  const { linkedAbortSignal, throwIfChatAborted, isChatAbortError } = await import('../../chatAbort')
  throwIfChatAborted(params.signal)
  const linked = linkedAbortSignal(params.timeoutMs ?? 90_000, params.signal)
  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': params.secret,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: linked.signal
      })
    } catch (error) {
      if (isChatAbortError(error) || params.signal?.aborted) throw error
      throw aiErrorFromCaught('claude', error)
    }
    const bodyText = await response.text()
    let json: {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>
      error?: { message?: string; type?: string }
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    try {
      json = JSON.parse(bodyText) as typeof json
    } catch {
      throw aiErrorFromLlmHttp('claude', response.status, bodyText)
    }
    if (!response.ok) {
      throw aiErrorFromLlmHttp('claude', response.status, bodyText)
    }

    const blocks = Array.isArray(json.content) ? json.content : []
    const textParts: string[] = []
    const toolCalls: AgentToolCall[] = []
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
      }
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {})
          }
        })
      }
    }

    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: textParts.join('\n') || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          },
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : json.stop_reason
        }
      ],
      usage: {
        input_tokens: Number(json.usage?.input_tokens) || 0,
        output_tokens: Number(json.usage?.output_tokens) || 0
      }
    }
  } finally {
    linked.dispose()
  }
}
