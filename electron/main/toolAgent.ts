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

export type AgentPhase = 'plan' | 'explore' | 'edit' | 'verify'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_phase',
      description:
        'Advance the agent phase: plan → explore → edit → verify. Call this when moving to the next stage.',
      parameters: {
        type: 'object',
        properties: {
          phase: { type: 'string', enum: ['plan', 'explore', 'edit', 'verify'] },
          note: { type: 'string', description: 'Short Japanese note for the UI' }
        },
        required: ['phase']
      }
    }
  },
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
        'Propose a full-file replacement for multi-file refactors. Queued for user Composer review.',
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

const PHASE_TOOLS: Record<AgentPhase, Set<string>> = {
  plan: new Set(['set_phase', 'list_dir', 'search_code', 'read_file']),
  explore: new Set(['set_phase', 'list_dir', 'search_code', 'read_file']),
  edit: new Set(['set_phase', 'read_file', 'search_code', 'list_dir', 'edit_file']),
  verify: new Set(['set_phase', 'read_file', 'search_code', 'list_dir'])
}

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

function toolSignature(name: string, argsJson: string): string {
  return `${name}:${argsJson}`
}

function isAgentPhase(value: string): value is AgentPhase {
  return value === 'plan' || value === 'explore' || value === 'edit' || value === 'verify'
}

async function callChatCompletions(params: {
  apiKey: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: ProviderMessage[]
  tools?: typeof TOOLS
}): Promise<ChatCompletionResponse> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  let lastError: Error | null = null
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: 0.2
  }
  if (params.tools) {
    body.tools = params.tools
    body.tool_choice = 'auto'
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
          ...parseExtraHeaders(params.extraHeaders)
        },
        body: JSON.stringify(body)
      })

      const json = (await response.json()) as ChatCompletionResponse
      if (!response.ok) {
        throw new Error(json.error?.message ?? `LLM HTTP ${response.status}`)
      }
      return json
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 2) await sleep(400 * (attempt + 1))
    }
  }

  throw lastError ?? new Error('LLM request failed')
}

async function runTool(
  workspacePath: string,
  name: string,
  argsJson: string,
  onEvent: (event: ChatStreamEvent) => void,
  callId: string,
  phase: AgentPhase,
  editedPaths: Set<string>
): Promise<{ content: string; ok: boolean; nextPhase?: AgentPhase }> {
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

  if (!PHASE_TOOLS[phase].has(name)) {
    const content = JSON.stringify({
      ok: false,
      error: `Tool ${name} is not allowed in phase=${phase}. Call set_phase first.`
    })
    onEvent({ type: 'tool_call', id: callId, name, args })
    onEvent({
      type: 'tool_result',
      id: callId,
      name,
      ok: false,
      summary: `blocked in ${phase}`
    })
    return { content, ok: false }
  }

  onEvent({ type: 'tool_call', id: callId, name, args })

  try {
    if (name === 'set_phase') {
      const next = String(args.phase ?? '')
      const note = typeof args.note === 'string' ? args.note : undefined
      if (!isAgentPhase(next)) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: 'invalid phase'
        })
        return {
          content: JSON.stringify({ ok: false, error: 'phase must be plan|explore|edit|verify' }),
          ok: false
        }
      }
      onEvent({ type: 'agent_phase', phase: next, note })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `phase → ${next}`
      })
      return {
        content: JSON.stringify({ ok: true, phase: next, note }),
        ok: true,
        nextPhase: next
      }
    }

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

      let warning: string | null = null
      try {
        const existing = await toolReadFile(workspacePath, path)
        if (existing.length > 400 && content.length < existing.length * 0.35) {
          warning =
            'Proposed content is much shorter than the current file. Prefer a complete file unless intentional.'
        }
      } catch {
        // new file
      }

      editedPaths.add(path)
      onEvent({ type: 'edit_proposal', path, content })
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
          note: warning ?? 'Queued for Composer review. Continue editing other files or set_phase verify.'
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
    'あなたは saforall の長時間コーディング Agent です。大規模リファクタも担当します。',
    '必ずフェーズを進めます: plan → explore → edit → verify。',
    'set_phase でフェーズを宣言してから作業してください。',
    'plan: 変更方針を短く立てる（必要なら軽く list/search）。',
    'explore: read_file / search_code で深く調査（関連ファイルを複数読む）。',
    'edit: edit_file で複数ファイルを提案（Composer レビュー用。即時保存されない）。',
    'verify: 編集したファイルを再読込・検索し、抜けや不整合がないか自己確認する。verify では edit_file 不可。',
    'ツール失敗時は別パス/クエリで自己修正。同じ呼び出しを繰り返さない。',
    '最終回答は日本語で、変更ファイル一覧と注意点を短くまとめる。',
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

  let phase: AgentPhase = 'plan'
  onEvent({ type: 'agent_phase', phase, note: '計画を開始' })

  let finalText = ''
  const maxSteps = 32
  let consecutiveToolFailures = 0
  const recentSignatures: string[] = []
  const progressNotes: string[] = []
  const editedPaths = new Set<string>()
  let exploreReads = 0

  for (let step = 0; step < maxSteps; step += 1) {
    let completion: ChatCompletionResponse
    try {
      completion = await callChatCompletions({
        apiKey,
        baseUrl,
        model,
        extraHeaders,
        messages,
        tools: TOOLS
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (step > 0) {
        messages.push({
          role: 'user',
          content: `システム: LLM 呼び出し失敗（${message}）。これまでに分かったことと残作業を日本語で短くまとめてください。`
        })
        try {
          const fallback = await callChatCompletions({
            apiKey,
            baseUrl,
            model,
            extraHeaders,
            messages
          })
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

        if (recentSignatures.includes(signature) && call.function.name !== 'set_phase') {
          const dup = JSON.stringify({
            ok: false,
            error: 'duplicate tool call skipped — change path/query or advance phase'
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
          messages.push({ role: 'tool', tool_call_id: call.id, content: dup })
          consecutiveToolFailures += 1
          continue
        }
        recentSignatures.push(signature)
        if (recentSignatures.length > 20) recentSignatures.shift()

        const result = await runTool(
          workspacePath,
          call.function.name,
          argsRaw,
          onEvent,
          call.id,
          phase,
          editedPaths
        )

        if (result.nextPhase) {
          phase = result.nextPhase
        }
        if (call.function.name === 'read_file' && phase === 'explore' && result.ok) {
          exploreReads += 1
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content
        })
        progressNotes.push(`${phase}:${call.function.name}:${result.ok ? 'ok' : 'fail'}`)

        if (result.ok) consecutiveToolFailures = 0
        else consecutiveToolFailures += 1
      }

      if (phase === 'explore' && exploreReads >= 8) {
        messages.push({
          role: 'user',
          content:
            'システム: 探索が十分です。set_phase で edit に進み、必要なファイルを edit_file してください。'
        })
        exploreReads = 0
      }

      if (phase === 'edit' && editedPaths.size >= 1 && step > 10) {
        messages.push({
          role: 'user',
          content:
            'システム: 編集提案があります。追加編集がなければ set_phase verify で自己確認へ進んでください。'
        })
      }

      if (phase === 'verify' && editedPaths.size > 0) {
        const list = Array.from(editedPaths).slice(0, 12).join(', ')
        messages.push({
          role: 'user',
          content: `システム: verify 中です。次の編集候補を read_file / search_code で確認してください: ${list}`
        })
        editedPaths.clear()
      }

      if (consecutiveToolFailures >= 3) {
        messages.push({
          role: 'user',
          content:
            'システム: ツール失敗が続いています。別の調査方法に切り替えるか、現状で最終回答を出してください。'
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
        ? `\n実施ログ: ${progressNotes.slice(-12).join(' · ')}`
        : ''
    finalText =
      '長時間 Agent を完了しました。Composer の差分レビューから変更を確認してください。' + notes
  }

  const chunkSize = 120
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
