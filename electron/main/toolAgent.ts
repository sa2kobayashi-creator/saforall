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

export function normalizeAgentPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

export function pathKeyMatch(a: string, b: string): boolean {
  const na = normalizeAgentPath(a)
  const nb = normalizeAgentPath(b)
  if (na === nb) return true
  // Prefer suffix match of a full relative path segment, not bare basename-only
  if (na.length > 3 && nb.length > 3 && (na.endsWith('/' + nb) || nb.endsWith('/' + na))) {
    return true
  }
  return false
}

/** Looser match for UI / duplicate detection (basename OK). */
export function pathKeyMatchLoose(a: string, b: string): boolean {
  if (pathKeyMatch(a, b)) return true
  const na = normalizeAgentPath(a)
  const nb = normalizeAgentPath(b)
  const ba = na.split('/').pop() ?? na
  const bb = nb.split('/').pop() ?? nb
  return ba.length > 0 && ba === bb
}

export function unverifiedEditPaths(
  edited: Iterable<string>,
  verified: Set<string>
): string[] {
  const verifiedList = Array.from(verified)
  return Array.from(edited).filter(
    (path) => !verifiedList.some((row) => pathKeyMatch(path, row))
  )
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
  timeoutMs?: number
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
  const timeoutMs = params.timeoutMs ?? 45_000

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
          ...parseExtraHeaders(params.extraHeaders)
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      const json = (await response.json()) as ChatCompletionResponse
      if (!response.ok) {
        throw new Error(json.error?.message ?? `LLM HTTP ${response.status}`)
      }
      return json
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 2) await sleep(500 * (attempt + 1))
    } finally {
      clearTimeout(timer)
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
  editedPaths: Set<string>,
  verifiedPaths: Set<string>,
  readCache: Map<string, string>,
  editSummaries: Map<string, string>
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
      const cacheKey = path.replace(/\\/g, '/').toLowerCase()
      let content = readCache.get(cacheKey)
      if (content === undefined) {
        content = await toolReadFile(workspacePath, path)
        readCache.set(cacheKey, content)
      }
      if (Array.from(editedPaths).some((row) => pathKeyMatchLoose(row, path))) {
        verifiedPaths.add(path)
      }
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
      editSummaries.set(
        path,
        `${content.split(/\r?\n/).length} lines · ${content.length} chars`
      )
      // Re-edit invalidates prior verification and read cache for this path
      for (const row of Array.from(verifiedPaths)) {
        if (pathKeyMatchLoose(row, path)) verifiedPaths.delete(row)
      }
      for (const key of Array.from(readCache.keys())) {
        if (pathKeyMatchLoose(key, path)) readCache.delete(key)
      }
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
    'verify: 編集した各ファイルを必ず read_file で再確認し、不整合があれば explore/edit に戻る。verify 未確認のまま最終回答してはいけない。verify では edit_file 不可。',
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
  const maxSteps = 40
  let consecutiveToolFailures = 0
  const recentSignatures: string[] = []
  const progressNotes: string[] = []
  const editedPaths = new Set<string>()
  const verifiedPaths = new Set<string>()
  const editSummaries = new Map<string, string>()
  const readCache = new Map<string, string>()
  let exploreReads = 0
  let verifyNudgeCount = 0
  let finalizeBlockCount = 0
  let verifyIncomplete = false

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

      const canParallel = (name: string) =>
        name === 'read_file' || name === 'list_dir' || name === 'search_code'
      // allow larger parallel explore batches for speed
      const maxParallel = phase === 'explore' ? 6 : 4

      type OrderedRow = {
        call: ToolCall
        result: Awaited<ReturnType<typeof runTool>> | null
        skippedDup: boolean
      }
      const orderedResults: OrderedRow[] = []

      let i = 0
      while (i < toolCalls.length) {
        const batch: ToolCall[] = []
        while (i < toolCalls.length && canParallel(toolCalls[i].function.name)) {
          const sig = toolSignature(
            toolCalls[i].function.name,
            repairToolArguments(toolCalls[i].function.arguments)
          )
          if (recentSignatures.includes(sig)) {
            orderedResults.push({ call: toolCalls[i], result: null, skippedDup: true })
            i += 1
            continue
          }
          recentSignatures.push(sig)
          if (recentSignatures.length > 24) recentSignatures.shift()
          batch.push(toolCalls[i])
          i += 1
          if (batch.length >= maxParallel) break
        }

        if (batch.length > 0) {
          const settled = await Promise.all(
            batch.map(async (call) => {
              const result = await runTool(
                workspacePath,
                call.function.name,
                call.function.arguments,
                onEvent,
                call.id,
                phase,
                editedPaths,
                verifiedPaths,
                readCache,
                editSummaries
              )
              return { call, result, skippedDup: false as const }
            })
          )
          orderedResults.push(...settled)
          continue
        }

        const call = toolCalls[i]
        i += 1
        const sig = toolSignature(
          call.function.name,
          repairToolArguments(call.function.arguments)
        )
        if (call.function.name !== 'set_phase' && recentSignatures.includes(sig)) {
          orderedResults.push({ call, result: null, skippedDup: true })
          continue
        }
        recentSignatures.push(sig)
        if (recentSignatures.length > 24) recentSignatures.shift()
        const result = await runTool(
          workspacePath,
          call.function.name,
          call.function.arguments,
          onEvent,
          call.id,
          phase,
          editedPaths,
          verifiedPaths,
          readCache,
          editSummaries
        )
        orderedResults.push({ call, result, skippedDup: false })
      }

      for (const row of orderedResults) {
        const { call } = row
        if (row.skippedDup || !row.result) {
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

        const result = row.result
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

      if (step > 0 && step % 6 === 0) {
        const summary = `step ${step + 1}/${maxSteps} · phase=${phase} · edits=${editedPaths.size} · ${progressNotes.slice(-4).join(', ')}`
        onEvent({
          type: 'agent_checkpoint',
          step: step + 1,
          phase,
          summary
        })
        messages.push({
          role: 'user',
          content: `システムチェックポイント: ${summary}。必要なら続行、十分なら最終回答へ。`
        })
      }

      if (phase === 'explore' && exploreReads >= 10) {
        messages.push({
          role: 'user',
          content:
            'システム: 深い探索が十分です。set_phase で edit に進み、大規模リファクタなら複数 edit_file を出してください。'
        })
        exploreReads = 0
      }

      if (phase === 'edit' && editedPaths.size >= 1 && step > 8) {
        const list = Array.from(editedPaths)
          .slice(0, 8)
          .map((path) => `${path}${editSummaries.has(path) ? ` [${editSummaries.get(path)}]` : ''}`)
          .join(', ')
        messages.push({
          role: 'user',
          content: `システム: 編集提案があります（${list}）。追加編集がなければ set_phase verify へ進み、各ファイルを read_file で確認してください。`
        })
      }

      if (phase === 'verify') {
        const pending = unverifiedEditPaths(editedPaths, verifiedPaths)
        if (pending.length > 0 && verifyNudgeCount < 3) {
          verifyNudgeCount += 1
          const list = pending.slice(0, 12).join(', ')
          messages.push({
            role: 'user',
            content: `システム: verify 未完了です。次の編集ファイルを必ず read_file してください（確認後に最終回答可）: ${list}`
          })
        } else if (pending.length === 0 && editedPaths.size > 0 && verifyNudgeCount < 4) {
          verifyNudgeCount = 4
          messages.push({
            role: 'user',
            content:
              'システム: 編集ファイルの再読込は完了しています。不整合がなければ最終回答を日本語でまとめ、問題があれば set_phase edit に戻ってください。'
          })
        }
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

    // Model attempted to finalize without tools
    if (editedPaths.size > 0 && phase !== 'verify' && finalizeBlockCount < 2) {
      finalizeBlockCount += 1
      messages.push({
        role: 'assistant',
        content: message.content ?? null
      })
      messages.push({
        role: 'user',
        content:
          'システム: 編集提案後の最終回答は verify 完了後のみです。set_phase verify を呼び、編集ファイルを read_file で確認してからまとめてください。'
      })
      continue
    }

    if (editedPaths.size > 0 && phase === 'verify') {
      const pending = unverifiedEditPaths(editedPaths, verifiedPaths)
      if (pending.length > 0 && finalizeBlockCount < 5) {
        finalizeBlockCount += 1
        messages.push({
          role: 'assistant',
          content: message.content ?? null
        })
        const hints = pending
          .slice(0, 8)
          .map((path) => {
            const note = editSummaries.get(path)
            return note ? `${path} (${note})` : path
          })
          .join(', ')
        messages.push({
          role: 'user',
          content: `システム: まだ未確認の編集があります。先に read_file してください: ${hints}`
        })
        continue
      }
      if (pending.length > 0) {
        verifyIncomplete = true
        finalText =
          (message.content ?? '').trim() ||
          `verify 未完了のまま終了しました。未確認: ${pending.join(', ')}`
        break
      }
    }

    finalText = (message.content ?? '').trim()
    break
  }

  if (verifyIncomplete && finalText) {
    finalText +=
      '\n\n⚠ verify が完了していません。Composer の差分を必ず人手で確認してください。'
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
