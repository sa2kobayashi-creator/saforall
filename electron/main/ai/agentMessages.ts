import { AIError, classifyProviderError } from './errors'
import type { AgentProviderMessage, AgentToolCall, AgentToolSpec } from './toolTypes'

export function normalizeToolCalls(raw: unknown): AgentToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: AgentToolCall[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id =
      typeof row.id === 'string' && row.id.trim() !== ''
        ? row.id
        : `call_${out.length + 1}_${index}`

    const nested = row.function
    if (nested && typeof nested === 'object') {
      const fn = nested as Record<string, unknown>
      const name = typeof fn.name === 'string' ? fn.name.trim() : ''
      if (name === '') continue
      const args =
        typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
      out.push({ id, type: 'function', function: { name, arguments: args } })
      continue
    }

    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name === '') continue
    const args =
      typeof row.arguments === 'string'
        ? row.arguments
        : JSON.stringify(row.arguments ?? row.input ?? {})
    out.push({ id, type: 'function', function: { name, arguments: args } })
  }
  return out
}

export function repairToolArguments(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return '{}'
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // continue
  }

  let candidate = trimmed
  const quoteCount = (candidate.match(/"/g) ?? []).length
  if (quoteCount % 2 === 1) candidate += '"'
  const openCurly = (candidate.match(/\{/g) ?? []).length
  const closeCurly = (candidate.match(/\}/g) ?? []).length
  if (openCurly > closeCurly) candidate += '}'.repeat(openCurly - closeCurly)
  const openSquare = (candidate.match(/\[/g) ?? []).length
  const closeSquare = (candidate.match(/\]/g) ?? []).length
  if (openSquare > closeSquare) candidate += ']'.repeat(openSquare - closeSquare)

  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return '{}'
  }
}

export function parseRetryAfterMs(message: string, attempt: number): number {
  const ms = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*ms/i)
  if (ms) return Math.max(400, Math.ceil(Number(ms[1])) + 200)
  const sec = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (sec) return Math.max(400, Math.ceil(Number(sec[1]) * 1000) + 200)
  return Math.min(8_000, 700 * (attempt + 1))
}

export function parseExtraHeaders(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of headers) {
    const idx = row.indexOf(':')
    if (idx <= 0) continue
    out[row.slice(0, idx).trim()] = row.slice(idx + 1).trim()
  }
  return out
}

export function formatLlmHttpError(status: number, bodyText: string): string {
  const raw = (bodyText || '').trim()
  if (!raw) return `LLM HTTP ${status}`
  try {
    const json = JSON.parse(raw) as {
      error?: { message?: string; code?: string; type?: string }
      errors?: Array<{ message?: string }>
      message?: string
    }
    const msg = json.error?.message || json.errors?.[0]?.message || json.message || raw
    const code = json.error?.code || json.error?.type
    let text = code ? `LLM HTTP ${status}: ${msg} (${code})` : `LLM HTTP ${status}: ${msg}`
    if (status === 429 || /rate[_ ]?limit/i.test(text)) {
      text +=
        '。OpenAI の分間トークン上限です。数秒待って再試行するか、しばらく空けてから送ってください。' +
        ' Auto なら Gemini / Claude へ切り替えるのも有効です。'
    }
    return text
  } catch {
    return `LLM HTTP ${status}: ${raw.slice(0, 600)}`
  }
}

export function isRateLimitError(message: string): boolean {
  return /LLM HTTP 429|rate[_ ]?limit|tokens per min|TPM/i.test(message)
}

export function modelOmitsTemperature(model: string): boolean {
  const id = model.trim().toLowerCase()
  return (
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.startsWith('gpt-5') ||
    id.includes('reason')
  )
}

export function modelAllowsRequiredToolChoice(model: string): boolean {
  const id = model.trim().toLowerCase()
  return !(
    id.startsWith('gpt-5') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4')
  )
}

export function flattenMessageContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const row = part as { text?: unknown; content?: unknown; type?: unknown }
          if (typeof row.text === 'string') return row.text
          if (typeof row.content === 'string') return row.content
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  return String(content)
}

export function convertOpenAiVisionToClaude(parts: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const row = part as Record<string, unknown>
    if (row.type === 'image' && row.source) {
      out.push(part)
      continue
    }
    if (row.type === 'text' && typeof row.text === 'string') {
      out.push({ type: 'text', text: row.text })
      continue
    }
    if (row.type === 'image_url') {
      const url =
        typeof row.image_url === 'object' && row.image_url
          ? String((row.image_url as { url?: string }).url ?? '')
          : ''
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(url)
      if (match) {
        out.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2]
          }
        })
      }
      continue
    }
    if (typeof row.text === 'string') {
      out.push({ type: 'text', text: row.text })
    }
  }
  return out.length > 0 ? out : [{ type: 'text', text: '（画像を確認してください）' }]
}

export function isVisionContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    if (!part || typeof part !== 'object') return false
    const row = part as Record<string, unknown>
    return (
      row.type === 'image_url' ||
      row.type === 'image' ||
      Boolean(row.inline_data) ||
      Boolean(row.source)
    )
  })
}

export function normalizeMessagesForLlm(
  messages: AgentProviderMessage[]
): Array<Record<string, unknown>> {
  return messages.map((row) => {
    if (row.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: row.tool_call_id,
        content: flattenMessageContent(row.content)
      }
    }
    const out: Record<string, unknown> = {
      role: row.role,
      content: isVisionContent(row.content) ? row.content : flattenMessageContent(row.content)
    }
    if (row.tool_calls && row.tool_calls.length > 0) {
      out.tool_calls = row.tool_calls
    }
    if ('reasoning_content' in row && row.reasoning_content != null) {
      out.reasoning_content = row.reasoning_content
    }
    return out
  })
}

export function toAnthropicTools(tools: AgentToolSpec[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return tools.map((row) => ({
    name: row.function.name,
    description: row.function.description,
    input_schema: {
      type: 'object',
      ...(row.function.parameters as Record<string, unknown>)
    }
  }))
}

export function anthropicBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

export function toAnthropicMessages(messages: AgentProviderMessage[]): {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
} {
  const systemParts: string[] = []
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const row of messages) {
    if (row.role === 'system') {
      if (typeof row.content === 'string' && row.content.trim() !== '') {
        systemParts.push(row.content)
      }
      continue
    }
    if (row.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: row.tool_call_id,
        content: row.content
      }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        ;(last.content as unknown[]).push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (row.role === 'assistant' && row.tool_calls && row.tool_calls.length > 0) {
      const blocks: unknown[] = []
      if (typeof row.content === 'string' && row.content.trim() !== '') {
        blocks.push({ type: 'text', text: row.content })
      }
      for (const call of normalizeToolCalls(row.tool_calls)) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(repairToolArguments(call.function.arguments)) as Record<
            string,
            unknown
          >
        } catch {
          input = {}
        }
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input
        })
      }
      if (blocks.length === 0) {
        out.push({
          role: 'assistant',
          content: typeof row.content === 'string' ? row.content : ''
        })
      } else {
        out.push({ role: 'assistant', content: blocks })
      }
      continue
    }
    out.push({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: Array.isArray(row.content)
        ? convertOpenAiVisionToClaude(row.content)
        : typeof row.content === 'string'
          ? row.content
          : String(row.content ?? '')
    })
  }

  const merged: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  for (const row of out) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === row.role) {
      const a = prev.content
      const b = row.content
      if (Array.isArray(a) && Array.isArray(b)) {
        prev.content = [...a, ...b]
      } else if (typeof a === 'string' && typeof b === 'string') {
        prev.content = `${a}\n${b}`
      } else {
        merged.push(row)
      }
    } else {
      merged.push(row)
    }
  }

  if (merged.length === 0 || merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: '(continue)' })
  }

  return { system: systemParts.join('\n\n'), messages: merged }
}

export function aiErrorFromLlmHttp(
  providerId: string,
  status: number,
  bodyText: string
): AIError {
  const message = formatLlmHttpError(status, bodyText)
  const code = classifyProviderError(message, status)
  return new AIError(code, message, { providerId, httpStatus: status })
}

export function aiErrorFromCaught(providerId: string, error: unknown): AIError {
  if (error instanceof AIError) return error
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (/timeout|timed out|aborted/i.test(lower) && !/cancelled by user/i.test(lower)) {
    return new AIError('TIMEOUT', message, { providerId })
  }
  if (/fetch failed|network|econnreset|enotfound|econnrefused/i.test(lower)) {
    return new AIError('NETWORK_ERROR', message, { providerId })
  }
  const code = classifyProviderError(message)
  return new AIError(code === 'UNKNOWN' ? 'PROVIDER_ERROR' : code, message, { providerId })
}
