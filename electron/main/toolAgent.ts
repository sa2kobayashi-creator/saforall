import type { ChatStreamEvent, MonthUsage } from './api'
import {
  loadProjectRules,
  toolListDir,
  toolReadFile,
  toolSearch
} from './workspaceTools'

type ProviderMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason?: string
  }>
  error?: { message?: string }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file in the workspace (relative path preferred).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories under a workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to workspace (default .)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search text across workspace source files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          glob: { type: 'string', description: 'Optional extension filter like *.ts' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Propose a full-file replacement. Does not write immediately; user reviews a diff. Prefer complete file content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Full new file contents' }
        },
        required: ['path', 'content']
      }
    }
  }
]

export type ToolAgentParams = {
  workspacePath: string
  apiKey: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: Array<{ role: string; content: string }>
  engine: string
  taskType: string
  sessionId: number
  onEvent: (event: ChatStreamEvent) => void
  complete: (content: string) => Promise<{
    assistant_message: Record<string, unknown>
    estimated_usd?: number
    usage?: MonthUsage
  } | null>
}

function parseExtraHeaders(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of headers) {
    const idx = row.indexOf(':')
    if (idx <= 0) continue
    out[row.slice(0, idx).trim()] = row.slice(idx + 1).trim()
  }
  return out
}

async function callChatCompletions(params: {
  apiKey: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: ProviderMessage[]
}): Promise<ChatCompletionResponse> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      ...parseExtraHeaders(params.extraHeaders)
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.2
    })
  })

  const json = (await response.json()) as ChatCompletionResponse
  if (!response.ok) {
    throw new Error(json.error?.message ?? `LLM HTTP ${response.status}`)
  }
  return json
}

async function runTool(
  workspacePath: string,
  name: string,
  argsJson: string,
  onEvent: (event: ChatStreamEvent) => void,
  callId: string
): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ ok: false, error: 'invalid JSON arguments' })
  }

  onEvent({ type: 'tool_call', id: callId, name, args })

  try {
    if (name === 'read_file') {
      const path = String(args.path ?? '')
      const content = await toolReadFile(workspacePath, path)
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `read ${path} (${content.length} chars)`
      })
      return content
    }
    if (name === 'list_dir') {
      const path = String(args.path ?? '.')
      const listing = await toolListDir(workspacePath, path)
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `list ${path}`
      })
      return listing
    }
    if (name === 'search_code') {
      const query = String(args.query ?? '')
      const glob = typeof args.glob === 'string' ? args.glob : undefined
      const result = await toolSearch(workspacePath, query, glob)
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `search ${query}`
      })
      return result
    }
    if (name === 'edit_file') {
      const path = String(args.path ?? '')
      const content = String(args.content ?? '')
      if (!path || content === '') {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: 'path/content required'
        })
        return JSON.stringify({ ok: false, error: 'path and content required' })
      }
      onEvent({
        type: 'edit_proposal',
        path,
        content
      })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `queued edit ${path}`
      })
      return JSON.stringify({
        ok: true,
        queued: true,
        path,
        note: 'Change queued for user diff review. Continue if more edits are needed.'
      })
    }

    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: `unknown tool ${name}`
    })
    return JSON.stringify({ ok: false, error: `unknown tool: ${name}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: message
    })
    return JSON.stringify({ ok: false, error: message })
  }
}

export async function runToolAgent(params: ToolAgentParams): Promise<void> {
  const {
    workspacePath,
    apiKey,
    baseUrl,
    model,
    extraHeaders,
    messages: seed,
    engine,
    taskType,
    onEvent,
    complete
  } = params

  if (baseUrl === 'gemini-native') {
    onEvent({
      type: 'error',
      code: 'AGENT_UNSUPPORTED',
      message: 'Gemini のツール Agent は未対応です。OpenAI / Workers、または Cursor を使ってください。'
    })
    return
  }

  const rules = await loadProjectRules(workspacePath)
  const agentSystem = [
    'あなたは saforall のコーディング Agent です。',
    '必要なら read_file / list_dir / search_code で調査し、編集は edit_file で提案してください。',
    'edit_file は即時保存されず、ユーザーが差分レビューします。',
    '回答は簡潔な日本語。最終まとめも日本語で。',
    `ワークスペース: ${workspacePath}`
  ]
  if (rules) {
    agentSystem.push('プロジェクトルール:\n' + rules)
  }

  const messages: ProviderMessage[] = [
    { role: 'system', content: agentSystem.join('\n') },
    ...seed
      .filter((row) => row.role !== 'system')
      .map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content
      }))
  ]

  let finalText = ''
  const maxSteps = 12

  for (let step = 0; step < maxSteps; step += 1) {
    const completion = await callChatCompletions({
      apiKey,
      baseUrl,
      model,
      extraHeaders,
      messages
    })

    const message = completion.choices?.[0]?.message
    if (!message) {
      throw new Error('LLM からメッセージを取得できませんでした')
    }

    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: toolCalls
      })

      for (const call of toolCalls) {
        const result = await runTool(
          workspacePath,
          call.function.name,
          call.function.arguments,
          onEvent,
          call.id
        )
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result
        })
      }
      continue
    }

    finalText = (message.content ?? '').trim()
    break
  }

  if (!finalText) {
    finalText = 'ツール実行を完了しました。差分レビューから変更を確認してください。'
  }

  // stream final text as deltas for UI
  const chunkSize = 80
  for (let i = 0; i < finalText.length; i += chunkSize) {
    onEvent({ type: 'delta', text: finalText.slice(i, i + chunkSize) })
  }

  const saved = await complete(finalText)
  if (!saved) {
    onEvent({
      type: 'error',
      code: 'COMPLETE_FAILED',
      message: 'Agent 結果の保存に失敗しました'
    })
    return
  }

  onEvent({
    type: 'done',
    model,
    engine,
    task_type: taskType,
    estimated_usd: saved.estimated_usd,
    usage: saved.usage,
    assistant_message: saved.assistant_message,
    used_tools: true
  })
}
