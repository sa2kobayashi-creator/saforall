import type { ChatStreamEvent, MonthUsage } from './api'
import { mcpManager, type McpToolInfo } from './mcpClient'
import {
  excerptShellFailure,
  loadProjectRules,
  resolveWorkspacePath,
  searchFilesByName,
  suggestVerifyCommands,
  toolListDir,
  toolReadFile,
  toolRunShell,
  toolSearch,
  withMaterializedEdits
} from './workspaceTools'
import { mkdir, writeFile } from 'fs/promises'
import { join, relative, resolve } from 'path'

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
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Run a short shell command in the workspace (e.g. npm test, npm run typecheck). Pending edit_file proposals are temporarily applied for the run, then restored. Prefer package scripts. Blocked: destructive system commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command, e.g. "npm test" or "npm run typecheck"'
          },
          cwd: {
            type: 'string',
            description: 'Optional subdirectory relative to workspace (default .)'
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in ms (default 60000, max 180000)'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_tools',
      description:
        'List MCP tools from .saforall/mcp.json (stdio servers). Use before call_mcp_tool.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'call_mcp_tool',
      description:
        'Call an MCP tool by name. Optionally pass serverId when multiple servers expose similar tools.',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'MCP tool name' },
          serverId: { type: 'string', description: 'Optional MCP server id from mcp.json' },
          arguments: {
            type: 'object',
            description: 'JSON arguments object for the tool'
          }
        },
        required: ['tool']
      }
    }
  }
]

const PHASE_TOOLS: Record<AgentPhase, Set<string>> = {
  plan: new Set(['set_phase', 'list_dir', 'search_code', 'read_file', 'list_mcp_tools']),
  explore: new Set([
    'set_phase',
    'list_dir',
    'search_code',
    'read_file',
    'list_mcp_tools',
    'call_mcp_tool'
  ]),
  edit: new Set([
    'set_phase',
    'read_file',
    'search_code',
    'list_dir',
    'edit_file',
    'run_shell',
    'list_mcp_tools',
    'call_mcp_tool'
  ]),
  verify: new Set([
    'set_phase',
    'read_file',
    'search_code',
    'list_dir',
    'run_shell',
    'edit_file',
    'list_mcp_tools',
    'call_mcp_tool'
  ])
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

/** Normalize to a stable workspace-relative POSIX path for pending edits. */
export function toWorkspaceRelativePath(workspaceRoot: string, pathArg: string): string {
  const absolute = resolveWorkspacePath(workspaceRoot, pathArg)
  return relative(resolve(workspaceRoot), absolute).split(/[/\\]/).join('/')
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
  editSummaries: Map<string, string>,
  pendingEdits: Map<string, string>,
  shellState: { attempts: number; passed: boolean; lastExit: number | null; editRecoveries: number },
  verifyHint?: { primary: string; fallbacks: string[] } | null
): Promise<{ content: string; ok: boolean; nextPhase?: AgentPhase }> {
  let args: Record<string, unknown> = {}
  // Never soft-repair truncated edit_file payloads — that queues broken full files.
  if (name === 'edit_file') {
    try {
      args = JSON.parse((argsJson || '').trim() || '{}') as Record<string, unknown>
    } catch {
      const content = JSON.stringify({
        ok: false,
        error: 'truncated_arguments',
        note: 'edit_file JSON was truncated or invalid. Resend with the complete file content.'
      })
      onEvent({ type: 'tool_call', id: callId, name, args: {} })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: false,
        summary: 'truncated edit_file arguments'
      })
      return { content, ok: false }
    }
  } else {
    const repaired = repairToolArguments(argsJson)
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
      let content: string | undefined
      for (const [pendingPath, pendingContent] of Array.from(pendingEdits.entries())) {
        if (pathKeyMatchLoose(pendingPath, path)) {
          content = pendingContent
          break
        }
      }
      if (content === undefined) {
        content = readCache.get(cacheKey)
        if (content === undefined) {
          content = await toolReadFile(workspacePath, path)
          readCache.set(cacheKey, content)
        }
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
      const rawPath = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      if (!rawPath || content === '') {
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

      let path = rawPath
      try {
        path = toWorkspaceRelativePath(workspacePath, rawPath)
      } catch {
        const base = rawPath.split(/[/\\]/).pop() ?? rawPath
        const found = await searchFilesByName(workspacePath, base, 8)
        if (found.length === 1) {
          path = found[0]
        } else {
          onEvent({
            type: 'tool_result',
            id: callId,
            name,
            ok: false,
            summary: 'path unresolved'
          })
          return {
            content: JSON.stringify({
              ok: false,
              error: 'path could not be resolved inside the workspace',
              path: rawPath,
              candidates: found
            }),
            ok: false
          }
        }
      }

      // Collapse duplicate pending keys that match the same normalized path
      for (const key of Array.from(pendingEdits.keys())) {
        if (key !== path && pathKeyMatch(key, path)) {
          pendingEdits.delete(key)
          editedPaths.delete(key)
          editSummaries.delete(key)
        }
      }

      let warning: string | null = null
      let requireRewrite = false
      try {
        const existing = await toolReadFile(workspacePath, path)
        if (existing.length > 400 && content.length < existing.length * 0.35) {
          requireRewrite = true
          warning =
            'Proposed content is much shorter than the current file. Resend a complete file (not a fragment).'
        }
      } catch {
        // new file
      }

      if (requireRewrite) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: `rejected short edit ${path}`
        })
        return {
          content: JSON.stringify({
            ok: false,
            error: 'incomplete_edit',
            path,
            warning,
            note: 'Do not queue truncated replacements. Call edit_file again with the full file content.'
          }),
          ok: false
        }
      }

      editedPaths.add(path)
      pendingEdits.set(path, content)
      editSummaries.set(
        path,
        `${content.split(/\r?\n/).length} lines · ${content.length} chars`
      )
      // Re-edit invalidates prior verification, shell pass, and read cache for this path
      shellState.passed = false
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
          note:
            warning ??
            'Queued for Composer review. Use run_shell in verify to test with proposals temporarily applied.'
        }),
        ok: true
      }
    }

    if (name === 'run_shell') {
      const command = String(args.command ?? '')
      const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
      const timeoutMs =
        typeof args.timeout_ms === 'number'
          ? args.timeout_ms
          : typeof args.timeoutMs === 'number'
            ? args.timeoutMs
            : undefined
      const result = await withMaterializedEdits(workspacePath, pendingEdits, () =>
        toolRunShell(workspacePath, command, { cwd, timeoutMs })
      )
      shellState.attempts += 1
      shellState.lastExit = result.exitCode
      if (result.ok) shellState.passed = true
      else shellState.passed = false

      const failureExcerpt = excerptShellFailure(result.stderr, result.stdout, 5_000)
      const fallbackNote =
        result.timedOut && verifyHint?.fallbacks?.[0]
          ? ` Timed out — try a shorter command next: ${verifyHint.fallbacks[0]}`
          : !result.ok && verifyHint?.fallbacks?.length
            ? ` If this stays flaky, also try: ${verifyHint.fallbacks.join(' | ')}`
            : ''
      const payload = {
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cwd: result.cwd,
        command: result.command,
        appliedPendingEdits: Array.from(pendingEdits.keys()).slice(0, 40),
        stdout: result.stdout,
        stderr: result.stderr,
        errorExcerpt: result.ok ? undefined : failureExcerpt,
        note: result.ok
          ? 'Command succeeded. Pending edits were restored after the run; accept Composer to keep them.'
          : `Command failed. Inspect errorExcerpt (tail-focused), set_phase edit, edit_file, then run_shell again.${fallbackNote}`
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: result.ok,
        summary: result.timedOut
          ? `timeout: ${command}`
          : `exit ${result.exitCode ?? '?'} · ${command}`
      })
      if (!result.ok && shellState.editRecoveries < 3) {
        shellState.editRecoveries += 1
        onEvent({
          type: 'agent_phase',
          phase: 'edit',
          note: `verify 失敗 → edit へ自動復帰 (${shellState.editRecoveries}/3)`
        })
        return {
          content: JSON.stringify({
            ...payload,
            autoRecoveredPhase: 'edit',
            recoveries: shellState.editRecoveries,
            failureHint: failureExcerpt
          }),
          ok: false,
          nextPhase: 'edit'
        }
      }
      return { content: JSON.stringify(payload), ok: result.ok }
    }

    if (name === 'list_mcp_tools') {
      const listed = await mcpManager.listWorkspaceTools(workspacePath)
      const payload = {
        ok: true,
        servers: listed.servers.map((row) => ({
          id: row.id,
          command: row.command,
          args: row.args
        })),
        tools: listed.tools.map((row) => ({
          name: row.name,
          serverId: row.serverId,
          description: row.description
        })),
        note:
          listed.tools.length === 0
            ? 'No MCP tools. Add .saforall/mcp.json (Cursor-compatible mcpServers map is OK).'
            : undefined
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `mcp tools ${listed.tools.length} · servers ${listed.servers.length}`
      })
      return { content: JSON.stringify(payload), ok: true }
    }

    if (name === 'call_mcp_tool') {
      const tool = String(args.tool ?? '')
      if (!tool) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: 'tool required'
        })
        return {
          content: JSON.stringify({ ok: false, error: 'tool required' }),
          ok: false
        }
      }
      const serverId = typeof args.serverId === 'string' ? args.serverId : undefined
      const toolArgs =
        args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
          ? (args.arguments as Record<string, unknown>)
          : {}
      const result = await mcpManager.callTool(workspacePath, {
        tool,
        serverId,
        arguments: toolArgs
      })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: result.ok,
        summary: result.ok
          ? `mcp ${tool}${result.serverId ? ` @${result.serverId}` : ''}`
          : `mcp fail ${tool}: ${result.error ?? 'error'}`
      })
      return {
        content: JSON.stringify({
          ok: result.ok,
          serverId: result.serverId,
          tool,
          content: result.content,
          error: result.error
        }),
        ok: result.ok
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
  const verifySuggestion = await suggestVerifyCommands(workspacePath)
  const suggestedVerify = verifySuggestion?.primary ?? null
  const verifyFallbackText =
    verifySuggestion && verifySuggestion.fallbacks.length > 0
      ? ` / 代替: ${verifySuggestion.fallbacks.join(' · ')}`
      : ''
  let mcpCatalog: McpToolInfo[] = []
  try {
    const listed = await mcpManager.listWorkspaceTools(workspacePath)
    mcpCatalog = listed.tools.slice(0, 40)
  } catch {
    mcpCatalog = []
  }

  const agentSystem = [
    'あなたは saforall の長時間コーディング Agent です。大規模リファクタも担当します。',
    '必ずフェーズを進めます: plan → explore → edit → verify。',
    'set_phase でフェーズを宣言してから作業してください。',
    'plan: 変更方針を短く立てる（必要なら軽く list/search）。',
    'explore: read_file / search_code / MCP で深く調査（関連ファイルを複数読む）。',
    'edit: edit_file で複数ファイルを提案（Composer レビュー用。即時永続保存されない）。完全なファイル内容を送る（断片・切り捨て禁止）。',
    'verify: 編集ファイルを read_file で確認し、run_shell で検証する。失敗したら errorExcerpt を読んで edit に戻り、修正後に再実行。',
    'run_shell は提案中の edit を一時適用してから実行し、終了後にディスクを元に戻す。',
    'MCP: list_mcp_tools / call_mcp_tool で外部ツールを使える（.saforall/mcp.json）。',
    '破壊的コマンドは禁止。まず短い検証（typecheck）を通し、必要なら test を追加。',
    'ツール失敗時は別パス/クエリ/コマンドで自己修正。同じ呼び出しを繰り返さない。失敗理由を読み、仮説を変える。',
    'シェル未成功のまま最終回答しない。直せる限り edit → run_shell を続ける。',
    '最終回答は日本語で、変更ファイル一覧・シェル結果・Composer 適用の促しを短くまとめる。',
    `ワークスペース: ${workspacePath}`,
    suggestedVerify
      ? `推奨検証コマンド: ${suggestedVerify}${verifyFallbackText}`
      : 'package.json / テスト設定を探し、適切な検証コマンドを run_shell で実行する。'
  ]
  if (mcpCatalog.length > 0) {
    agentSystem.push(
      '利用可能な MCP ツール:\n' +
        mcpCatalog
          .map(
            (row) =>
              `- ${row.name} @${row.serverId}${row.description ? `: ${row.description.slice(0, 120)}` : ''}`
          )
          .join('\n')
    )
  }
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
  const maxSteps = 56
  let consecutiveToolFailures = 0
  const recentFailures: string[] = []
  const recentSignatures: string[] = []
  const progressNotes: string[] = []
  const editedPaths = new Set<string>()
  const verifiedPaths = new Set<string>()
  const editSummaries = new Map<string, string>()
  const pendingEdits = new Map<string, string>()
  const readCache = new Map<string, string>()
  const shellState = {
    attempts: 0,
    passed: false,
    lastExit: null as number | null,
    editRecoveries: 0
  }
  let lastShellFailure = ''
  let lastShellCommand = ''
  let exploreReads = 0
  let verifyNudgeCount = 0
  let shellNudgeCount = 0
  let blockPhase = 0
  let blockUnread = 0
  let blockNoShell = 0
  let blockShellFail = 0
  const MAX_BLOCK_PHASE = 3
  const MAX_BLOCK_UNREAD = 6
  const MAX_BLOCK_NO_SHELL = 4
  const MAX_BLOCK_SHELL_FAIL = 6
  let verifyIncomplete = false
  let shellIncomplete = false
  let recoverNudgeCount = 0

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
        name === 'read_file' ||
        name === 'list_dir' ||
        name === 'search_code' ||
        name === 'list_mcp_tools'
      const maxParallel = phase === 'explore' ? 8 : phase === 'verify' ? 4 : 5

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
                editSummaries,
                pendingEdits,
                shellState,
                verifySuggestion
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
          editSummaries,
          pendingEdits,
          shellState,
          verifySuggestion
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

        if (result.ok) {
          consecutiveToolFailures = 0
        } else {
          consecutiveToolFailures += 1
          recentFailures.push(`${call.function.name}: ${result.content.slice(0, 240)}`)
          if (recentFailures.length > 6) recentFailures.shift()
        }

        if (call.function.name === 'run_shell' && !result.ok) {
          try {
            const parsed = JSON.parse(result.content) as {
              stderr?: string
              stdout?: string
              command?: string
              exitCode?: number | null
              errorExcerpt?: string
              failureHint?: string
            }
            lastShellCommand = parsed.command ?? ''
            lastShellFailure = [
              parsed.command ? `$ ${parsed.command}` : 'run_shell failed',
              parsed.exitCode != null ? `exit=${parsed.exitCode}` : '',
              parsed.errorExcerpt ||
                parsed.failureHint ||
                excerptShellFailure(parsed.stderr ?? '', parsed.stdout ?? '', 5_000)
            ]
              .filter(Boolean)
              .join('\n')
          } catch {
            lastShellFailure = result.content.slice(0, 5_000)
          }
        }
      }

      if (step > 0 && step % 6 === 0) {
        const summary = `step ${step + 1}/${maxSteps} · phase=${phase} · edits=${editedPaths.size} · shell=${shellState.passed ? 'pass' : `fail×${shellState.attempts}`} · ${progressNotes.slice(-4).join(', ')}`
        onEvent({
          type: 'agent_checkpoint',
          step: step + 1,
          phase,
          summary
        })
        messages.push({
          role: 'user',
          content: `システムチェックポイント: ${summary}。verify 未成功なら edit を続け、成功したら最終回答へ。`
        })
        try {
          const dir = join(workspacePath, '.saforall')
          await mkdir(dir, { recursive: true })
          await writeFile(
            join(dir, 'agent-state.json'),
            JSON.stringify(
              {
                updatedAt: new Date().toISOString(),
                step: step + 1,
                phase,
                editedPaths: Array.from(editedPaths).slice(0, 40),
                shell: {
                  attempts: shellState.attempts,
                  passed: shellState.passed,
                  lastExit: shellState.lastExit,
                  editRecoveries: shellState.editRecoveries
                },
                summary,
                lastShellFailure: lastShellFailure?.slice(0, 2000) ?? null
              },
              null,
              2
            ),
            'utf-8'
          )
        } catch {
          // ignore checkpoint write failures
        }
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
          content: `システム: 編集提案があります（${list}）。追加編集がなければ set_phase verify へ進み、read_file 確認のあと run_shell で検証してください${
            suggestedVerify ? `（例: ${suggestedVerify}）` : ''
          }。`
        })
      }

      if (phase === 'verify') {
        const pending = unverifiedEditPaths(editedPaths, verifiedPaths)
        if (pending.length > 0 && verifyNudgeCount < 3) {
          verifyNudgeCount += 1
          const list = pending.slice(0, 12).join(', ')
          messages.push({
            role: 'user',
            content: `システム: verify 未完了です。次の編集ファイルを必ず read_file してください（確認後に run_shell）: ${list}`
          })
        } else if (
          pending.length === 0 &&
          editedPaths.size > 0 &&
          shellState.attempts === 0 &&
          shellNudgeCount < 2
        ) {
          shellNudgeCount += 1
          messages.push({
            role: 'user',
            content: `システム: ファイル確認は完了。次に run_shell で検証してください${
              suggestedVerify
                ? `（推奨: ${suggestedVerify}）`
                : '（npm test / typecheck / プロジェクトのテストコマンド）'
            }。失敗したら set_phase edit で修正し、再実行。`
          })
        } else if (
          pending.length === 0 &&
          editedPaths.size > 0 &&
          shellState.attempts > 0 &&
          !shellState.passed &&
          shellNudgeCount < 4
        ) {
          shellNudgeCount += 1
          messages.push({
            role: 'user',
            content: `システム: run_shell が失敗しています（exit=${shellState.lastExit ?? 'timeout'}）。エラーを直し set_phase edit → edit_file → 再度 run_shell してください。\n--- failure ---\n${lastShellFailure || '(no output)'}`
          })
        } else if (
          pending.length === 0 &&
          editedPaths.size > 0 &&
          shellState.passed &&
          verifyNudgeCount < 5
        ) {
          verifyNudgeCount = 5
          messages.push({
            role: 'user',
            content:
              'システム: read + run_shell 成功です。最終回答を日本語でまとめ、Composer で差分を適用するよう促してください。'
          })
        }
      }

      if (
        lastShellFailure &&
        !shellState.passed &&
        shellState.attempts >= 1 &&
        phase !== 'edit' &&
        recoverNudgeCount < 2 &&
        shellState.editRecoveries === 0
      ) {
        recoverNudgeCount += 1
        messages.push({
          role: 'user',
          content:
            'システム: シェル検証失敗からのリカバリです。set_phase edit で失敗箇所を修正し、verify で run_shell を再実行してください。\n--- failure ---\n' +
            lastShellFailure
        })
      }

      if (consecutiveToolFailures >= 3) {
        messages.push({
          role: 'user',
          content:
            'システム: ツール失敗が続いています。別の調査方法・パス・コマンドに切り替えて自己修正を続けてください。verify 未成功なら最終回答せず edit を継続。\n最近の失敗:\n' +
            recentFailures.slice(-3).join('\n---\n')
        })
        consecutiveToolFailures = 0
      }
      continue
    }

    // Model attempted to finalize without tools
    if (editedPaths.size > 0 && phase !== 'verify' && blockPhase < MAX_BLOCK_PHASE) {
      blockPhase += 1
      messages.push({
        role: 'assistant',
        content: message.content ?? null
      })
      messages.push({
        role: 'user',
        content:
          'システム: 編集提案後の最終回答は verify 完了後のみです。set_phase verify → read_file → run_shell の順で確認してください。'
      })
      continue
    }

    if (editedPaths.size > 0 && phase === 'verify') {
      const pending = unverifiedEditPaths(editedPaths, verifiedPaths)
      if (pending.length > 0 && blockUnread < MAX_BLOCK_UNREAD) {
        blockUnread += 1
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
      if (pending.length === 0 && shellState.attempts === 0 && blockNoShell < MAX_BLOCK_NO_SHELL) {
        blockNoShell += 1
        messages.push({
          role: 'assistant',
          content: message.content ?? null
        })
        messages.push({
          role: 'user',
          content: `システム: 最終回答の前に run_shell で検証してください${
            suggestedVerify ? `（推奨: ${suggestedVerify}${verifyFallbackText}）` : ''
          }。`
        })
        continue
      }
      if (
        pending.length === 0 &&
        shellState.attempts > 0 &&
        !shellState.passed &&
        blockShellFail < MAX_BLOCK_SHELL_FAIL
      ) {
        blockShellFail += 1
        messages.push({
          role: 'assistant',
          content: message.content ?? null
        })
        const canRecover = shellState.editRecoveries < 3
        messages.push({
          role: 'user',
          content: canRecover
            ? `システム: シェル検証が失敗したままです。最終回答は禁止。set_phase edit → edit_file で直し、再度 run_shell してください${
                suggestedVerify ? `（再実行例: ${suggestedVerify}）` : ''
              }。\n--- failure ---\n${lastShellFailure || '(no output)'}`
            : `システム: シェル検証が失敗し、自動リカバリ上限に達しています。失敗内容を明記したうえで最終回答し、Composer で人手確認を促してください。\n--- failure ---\n${lastShellFailure || '(no output)'}`
        })
        if (canRecover) {
          phase = 'edit'
          onEvent({
            type: 'agent_phase',
            phase: 'edit',
            note: 'finalize 阻止 → edit 継続'
          })
        }
        continue
      }
      if (pending.length > 0) {
        verifyIncomplete = true
        finalText =
          (message.content ?? '').trim() ||
          `verify 未完了のまま終了しました。未確認: ${pending.join(', ')}`
        break
      }
      if (shellState.attempts === 0 || !shellState.passed) {
        shellIncomplete = true
      }
    }

    finalText = (message.content ?? '').trim()
    break
  }

  if (verifyIncomplete && finalText) {
    finalText +=
      '\n\n⚠ verify が完了していません。Composer の差分を必ず人手で確認してください。'
  }
  if (shellIncomplete && finalText) {
    finalText +=
      '\n\n⚠ シェル検証（run_shell）が未成功です。Composer 適用前にローカルで test/typecheck を実行してください。' +
      (lastShellFailure ? `\n\n--- last failure ---\n${lastShellFailure}` : '')
  }

  if (!finalText) {
    const editList = Array.from(editedPaths).slice(0, 12).join(', ')
    if (editedPaths.size > 0 && !shellState.passed) {
      finalText = [
        'Agent がステップ上限に達しました。シェル検証は未成功です。',
        lastShellCommand ? `最後のコマンド: ${lastShellCommand}` : null,
        editList ? `未適用の編集候補: ${editList}` : null,
        lastShellFailure ? `--- failure ---\n${lastShellFailure}` : null,
        'Composer で差分を確認し、必要なら手動で修正を続けてください。'
      ]
        .filter(Boolean)
        .join('\n')
      shellIncomplete = true
    } else {
      const notes =
        progressNotes.length > 0
          ? `\n実施ログ: ${progressNotes.slice(-12).join(' · ')}`
          : ''
      finalText =
        '長時間 Agent を完了しました。Composer の差分レビューから変更を確認・適用してください。' +
        notes
    }
  }

  if (editedPaths.size > 0 && shellState.passed && !finalText.includes('Composer')) {
    finalText +=
      '\n\n✅ シェル検証は成功しています。Composer で「すべて適用」すると変更がディスクに残ります。'
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
