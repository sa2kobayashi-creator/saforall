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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Best-effort repair for truncated tool argument JSON */
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
  // Close open strings / braces roughly
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

function toolSignature(name: string, argsJson: string): string {
  return `${name}:${argsJson}`
}

async function callChatCompletions(params: {
  apiKey: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: ProviderMessage[]
}): Promise<ChatCompletionResponse> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 2) {
        await sleep(400 * (attempt + 1))
      }
    }
  }

  throw lastError ?? new Error('LLM request failed')
}

async function runTool(
  workspacePath: string,
  name: string,
  argsJson: string,
  onEvent: (event: ChatStreamEvent) => void,
  callId: string
): Promise<{ content: string; ok: boolean }> {
  const repaired = repairToolArguments(argsJson)
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(repaired || '{}') as Record<string, unknown>
  } catch {
    const content = JSON.stringify({ ok: false, error: 'invalid JSON arguments' })
    onEvent({ type: 'tool_call', id: callId, name, args: {} })
    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: 'invalid JSON arguments'
    })
    return { content, ok: false }
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
      return { content, ok: true }
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
      return { content: listing, ok: true }
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
      return { content: result, ok: true }
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
        return {
          content: JSON.stringify({ ok: false, error: 'path and content required' }),
          ok: false
        }
      }

      // Self-check: warn if replacement is suspiciously tiny vs existing file
      let warning: string | null = null
      try {
        const existing = await toolReadFile(workspacePath, path)
        if (existing.length > 400 && content.length < existing.length * 0.35) {
          warning =
            'Proposed content is much shorter than the current file. Re-read and prefer a complete file unless intentional deletion.'
        }
      } catch {
        // new file ok
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
        summary: warning ? `queued edit ${path} (warning)` : `queued edit ${path}`
      })
      return {
        content: JSON.stringify({
          ok: true,
          queued: true,
          path,
          warning,
          note: warning
            ? warning
            : 'Change queued for user diff review. Continue if more edits are needed.'
        }),
        ok: true
      }
    }

    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: `unknown tool ${name}`
    })
    return {
      content: JSON.stringify({ ok: false, error: `unknown tool: ${name}` }),
      ok: false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: message
    })
    return { content: JSON.stringify({ ok: false, error: message }), ok: false }
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
    'ツールが失敗したら、別のパス・クエリ・手順で自己修正して続行してください。',
    '同じツール呼び出しを無意味に繰り返さないでください。',
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
  const maxSteps = 16
  let consecutiveToolFailures = 0
  const recentSignatures: string[] = []
  const progressNotes: string[] = []

  for (let step = 0; step < maxSteps; step += 1) {
    let completion: ChatCompletionResponse
    try {
      completion = await callChatCompletions({
        apiKey,
        baseUrl,
        model,
        extraHeaders,
        messages
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Self-correct: ask model to continue without tools if API keeps failing mid-run
      if (step > 0) {
        messages.push({
          role: 'user',
          content:
            `システム: LLM 呼び出しが失敗しました（${message}）。ツールなしで、これまでに分かったことと次の手を日本語で短くまとめてください。`
        })
        try {
          const fallback = await callChatCompletions({
            apiKey,
            baseUrl,
            model,
            extraHeaders,
            messages: messages.map((row, index) =>
              index === 0 && row.role === 'system'
                ? {
                    ...row,
                    content:
                      String(row.content ?? '') +
                      '\nこのターンは tools を使わず最終回答のみ出してください。'
                  }
                : row
            )
          })
          // Force no-tools by stripping - actually tools still sent. Just take content.
          finalText = (fallback.choices?.[0]?.message?.content ?? '').trim()
          if (finalText) break
        } catch {
          // fall through
        }
      }
      throw error
    }

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
        const argsRaw = call.function.arguments
        const signature = toolSignature(call.function.name, repairToolArguments(argsRaw))
        if (recentSignatures.includes(signature)) {
          const dup = JSON.stringify({
            ok: false,
            error: 'duplicate tool call skipped — try a different path/query or finish with a summary'
          })
          onEvent({
            type: 'tool_call',
            id: call.id,
            name: call.function.name,
            args: { duplicate: true }
          })
          onEvent({
            type: 'tool_result',
            id: call.id,
            name: call.function.name,
            ok: false,
            summary: 'duplicate skipped'
          })
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: dup
          })
          consecutiveToolFailures += 1
          continue
        }
        recentSignatures.push(signature)
        if (recentSignatures.length > 12) recentSignatures.shift()

        const result = await runTool(
          workspacePath,
          call.function.name,
          argsRaw,
          onEvent,
          call.id
        )
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content
        })
        progressNotes.push(
          `${call.function.name}: ${result.ok ? 'ok' : 'fail'}`
        )

        if (result.ok) {
          consecutiveToolFailures = 0
        } else {
          consecutiveToolFailures += 1
        }
      }

      if (consecutiveToolFailures >= 3) {
        messages.push({
          role: 'user',
          content:
            'システム: ツール失敗が続いています。別の調査方法に切り替えるか、現状の知見で日本語の最終回答を出してください。同じ呼び出しを繰り返さないでください。'
        })
        consecutiveToolFailures = 0
      }
      continue
    }

    finalText = (message.content ?? '').trim()
    break
  }

  if (!finalText) {
    const notes =
      progressNotes.length > 0
        ? `\n実施した操作: ${progressNotes.slice(-8).join(', ')}`
        : ''
    finalText =
      'ツール実行を完了しました。差分レビューから変更を確認してください。' + notes
  }

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
