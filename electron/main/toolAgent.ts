import type { ChatStreamEvent, MonthUsage } from './api'
import {
  formatProblemsForAgent,
  MAX_EDIT_RECOVERIES,
  problemsAffectEditedPaths
} from './lib/agentVerify'
import {
  extractTopPathsFromSearchResult,
  pathInTopHits,
  recordFeedback
} from './feedbackStore'
import { mcpManager } from './mcpClient'
import {
  excerptShellFailure,
  loadProjectRules,
  nextVerifyFallback,
  resolveWorkspacePath,
  searchFilesByName,
  suggestVerifyCommands,
  toolListDir,
  toolReadFile,
  toolRunShell,
  toolSearch,
  withMaterializedEdits,
  appendProjectMemory,
  formatSkillsCatalog,
  readProjectSkill,
  isLongRunningShellCommand,
  explainLongRunningShellCommand
} from './workspaceTools'
import { buildAgentSuccessMemoryNote } from './lib/agentMemory'
import { classifyTask, shouldAnswerWithoutTools } from './lib/taskClassify'
import {
  buildPostVerifySuccessFinal,
  isInvestigationComplete,
  isInvestigationTool,
  isRedundantPostVerifyBatch,
  isVerifyComplete,
  shouldAcceptAgentFinal,
  shouldPreferRequiredTools,
  shouldRetryEmptyToolCalls,
  shouldSkipDuplicateToolCall,
  successfulToolKey
} from './lib/agentRoundPolicy'
import {
  modelAllowsRequiredToolChoice,
  normalizeToolCalls as normalizeToolCallsImpl,
  parseRetryAfterMs as parseRetryAfterMsImpl,
  repairToolArguments as repairToolArgumentsImpl
} from './ai/agentMessages'
import { AIError } from './ai/errors'
import type { AgentChatCompletion, AgentProviderMessage, AgentToolCall, AgentToolSpec } from './ai/toolTypes'
import { mkdir, writeFile } from 'fs/promises'
import { join, relative, resolve } from 'path'

type ProviderMessage = AgentProviderMessage
type ToolCall = AgentToolCall
type ChatCompletionResponse = AgentChatCompletion

/** Coerce provider tool_calls (OpenAI / flat / sparse) into a safe list. */
export function normalizeToolCalls(raw: unknown): ToolCall[] {
  return normalizeToolCallsImpl(raw)
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
        'Propose a full-file replacement for multi-file refactors. Queued for user review in the 変更候補 panel.',
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
      name: 'get_problems',
      description:
        'List current IDE Problems (LSP/Monaco diagnostics) relevant to edited files. Use in verify before declaring success.',
      parameters: {
        type: 'object',
        properties: {
          edited_only: {
            type: 'boolean',
            description: 'If true (default), only problems touching edited paths'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Run a short finishing shell command to verify edits (npm run typecheck, npm test, lint). Do NOT use npm start / npm run dev / vite / watchers — they never exit and will time out. Pending edit_file proposals are temporarily applied for the run, then restored. Blocked: destructive system commands.',
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
            description: 'Timeout in ms (default 45000, max 120000)'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description:
        'Read a project Skill (SKILL.md) by id. Use when the Skills catalog lists a relevant workflow.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Skill id (folder name or frontmatter name), e.g. saforall-workflow'
          }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_tools',
      description:
        'List MCP tools from .saforall/mcp.json (stdio / HTTP). Use before call_mcp_tool.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_resources',
      description: 'List MCP resources (resources/list) from configured servers.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_mcp_resource',
      description: 'Read an MCP resource by uri (resources/read).',
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          serverId: { type: 'string' }
        },
        required: ['uri']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_prompts',
      description: 'List MCP prompts (prompts/list) from configured servers.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_mcp_prompt',
      description: 'Fetch an MCP prompt template by name (prompts/get).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          serverId: { type: 'string' },
          arguments: {
            type: 'object',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['name']
      }
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
            description: 'JSON arguments object for the tool',
            additionalProperties: true
          }
        },
        required: ['tool']
      }
    }
  }
]

const PHASE_TOOLS: Record<AgentPhase, Set<string>> = {
  plan: new Set([
    'set_phase',
    'list_dir',
    'search_code',
    'read_file',
    'list_mcp_tools',
    'list_mcp_resources',
    'list_mcp_prompts',
    'get_problems'
  ]),
  explore: new Set([
    'set_phase',
    'list_dir',
    'search_code',
    'read_file',
    'list_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'list_mcp_prompts',
    'get_mcp_prompt',
    'call_mcp_tool',
    'get_problems'
  ]),
  edit: new Set([
    'set_phase',
    'read_file',
    'search_code',
    'list_dir',
    'edit_file',
    'run_shell',
    'list_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'list_mcp_prompts',
    'get_mcp_prompt',
    'call_mcp_tool',
    'get_problems'
  ]),
  verify: new Set([
    'set_phase',
    'read_file',
    'search_code',
    'list_dir',
    'run_shell',
    'edit_file',
    'list_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'list_mcp_prompts',
    'get_mcp_prompt',
    'call_mcp_tool',
    'get_problems'
  ])
}

export type ToolAgentParams = {
  workspacePath: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: Array<{ role: string; content: string | unknown[] }>
  engine: string
  taskType: string
  sessionId: number
  /** Snapshot of IDE Problems panel lines (path + message). */
  problems?: string[]
  /** Open / active file paths used as search_code anchors. */
  anchorPaths?: string[]
  /** User cancel (Stop) while Agent is running. */
  signal?: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
  complete: (content: string) => Promise<{
    assistant_message: Record<string, unknown>
    estimated_usd?: number
    usage?: MonthUsage
  } | null>
}

export function normalizeAgentPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/**
 * User-facing final text when prose-only / no-edit exhaustion ends the loop.
 * Does not change Agent success criteria (edits still required for edit success).
 */
export function buildAgentProseExhaustionFinalText(input: {
  anyToolCall: boolean
  editedPathCount: number
  fakingTools: boolean
}): string {
  if (input.anyToolCall && input.editedPathCount === 0 && !input.fakingTools) {
    return (
      'Agent はツールを実行しましたが、今回の実行では編集候補が作成されませんでした。' +
      '変更候補が必要な場合は、編集対象と変更内容を明示して再試行してください。' +
      '（編集候補が出るまで Agent の編集成功条件は満たしていません。）'
    )
  }
  return (
    'Agent がツールを正しく呼び出せませんでした（文章での「手順: edit_file」などは無効です）。' +
    'モデルを OpenAI にし、フォルダを開いた状態で再試行してください。変更候補に差分が出るまで成功ではありません。'
  )
}

/** Detect when the model roleplays tools in markdown instead of calling them. */
export function looksLikeFakeToolProse(text: string): boolean {
  const raw = (text || '').trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  const names = [
    'set_phase',
    'edit_file',
    'read_file',
    'run_shell',
    'search_code',
    'list_dir',
    'list_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'list_mcp_prompts',
    'get_mcp_prompt',
    'call_mcp_tool',
    'read_skill'
  ]
  const hitCount = names.filter((name) => lower.includes(name)).length
  if (hitCount >= 2) return true
  if (/手順\s*\d+/.test(raw) && hitCount >= 1) return true
  if (/```(?:bash|shell|sh|powershell)?\s*\n?\s*(set_phase|edit_file|read_file|run_shell)\b/i.test(raw)) {
    return true
  }
  return false
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
  return repairToolArgumentsImpl(raw)
}

function toolSignature(name: string, argsJson: string): string {
  return `${name}:${argsJson}`
}

function isAgentPhase(value: string): value is AgentPhase {
  return value === 'plan' || value === 'explore' || value === 'edit' || value === 'verify'
}

export function isToolAgentCompatibleEndpoint(engine: string, baseUrl: string, model: string): boolean {
  if (engine === 'workers' || engine === 'cursor') {
    return false
  }
  const id = (model || '').trim().toLowerCase()
  if (id.startsWith('@cf/')) return false
  const u = (baseUrl || '').trim().toLowerCase()
  if (engine === 'gemini' || u === 'gemini-native') {
    return true
  }
  if (engine === 'grok' || u.includes('api.x.ai')) {
    return true
  }
  if (!u) return false
  if (engine === 'claude' || u.includes('anthropic.com')) {
    return true
  }
  if (u.includes('cloudflare.com') || u.includes('workers.ai')) {
    return false
  }
  // Cloudflare Workers OpenAI-compat path
  if (u.includes('/client/v4/accounts/') && u.includes('/ai/')) return false
  return true
}

function isAnthropicEndpoint(engine: string, baseUrl: string): boolean {
  if (engine === 'claude') return true
  return (baseUrl || '').toLowerCase().includes('anthropic.com')
}

function isGeminiEndpoint(engine: string, baseUrl: string): boolean {
  if (engine === 'gemini') return true
  return (baseUrl || '').trim().toLowerCase() === 'gemini-native'
}

function isGrokEndpoint(engine: string, baseUrl: string): boolean {
  if (engine === 'grok') return true
  return (baseUrl || '').toLowerCase().includes('api.x.ai')
}

function agentLlmProvider(engine: string, baseUrl: string): 'openai' | 'claude' | 'gemini' | 'grok' {
  if (isGeminiEndpoint(engine, baseUrl)) return 'gemini'
  if (isAnthropicEndpoint(engine, baseUrl)) return 'claude'
  if (isGrokEndpoint(engine, baseUrl)) return 'grok'
  return 'openai'
}

export function parseRetryAfterMs(message: string, attempt: number): number {
  return parseRetryAfterMsImpl(message, attempt)
}

async function callAgentLlm(params: {
  engine: string
  baseUrl: string
  model: string
  extraHeaders: string[]
  messages: ProviderMessage[]
  tools?: typeof TOOLS
  toolChoice?: 'auto' | 'required'
  timeoutMs?: number
  signal?: AbortSignal | null
  sessionId?: number
}): Promise<ChatCompletionResponse> {
  const { executeAiWithTools } = await import('./ai/router')
  const provider = agentLlmProvider(params.engine, params.baseUrl)
  return executeAiWithTools({
    provider,
    model: params.model,
    messages: params.messages,
    tools: params.tools as AgentToolSpec[] | undefined,
    toolChoice: params.toolChoice,
    extraHeaders: params.extraHeaders,
    baseUrl: params.baseUrl,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    sessionId: params.sessionId ?? null
  })
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
  shellState: {
    attempts: number
    passed: boolean
    lastExit: number | null
    editRecoveries: number
    triedVerifyCommands: string[]
  },
  verifyHint?: { primary: string; fallbacks: string[] } | null,
  problemsSnapshot: string[] = [],
  searchAnchors: Set<string> = new Set(),
  sessionSearchTops: string[] = [],
  signal?: AbortSignal | null
): Promise<{ content: string; ok: boolean; nextPhase?: AgentPhase }> {
  const { throwIfChatAborted, isChatAbortError } = await import('./chatAbort')
  throwIfChatAborted(signal)
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
      try {
        searchAnchors.add(toWorkspaceRelativePath(workspacePath, path))
      } catch {
        searchAnchors.add(path.replace(/\\/g, '/'))
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
      const result = await toolSearch(
        workspacePath,
        query,
        glob,
        Array.from(searchAnchors).slice(0, 12),
        'toolAgent'
      )
      for (const path of extractTopPathsFromSearchResult(result, 5)) {
        if (!sessionSearchTops.includes(path)) sessionSearchTops.push(path)
      }
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
      if (!rawPath) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: 'path required'
        })
        return {
          content: JSON.stringify({ ok: false, error: 'path required' }),
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

      let existingOnDisk: string | null = null
      try {
        existingOnDisk = await toolReadFile(workspacePath, path)
      } catch {
        // new file
      }

      const { assessEditContent } = await import('./lib/editGuards')
      const shrink = assessEditContent({
        path,
        nextContent: content,
        previousContent: existingOnDisk
      })
      if (!shrink.ok) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: `rejected ${shrink.reason} ${path}`
        })
        recordFeedback({
          kind: 'tool',
          source: 'toolAgent',
          tool: 'edit_file',
          phase,
          path,
          ok: false,
          detail: shrink.reason
        })
        return {
          content: JSON.stringify({
            ok: false,
            error: shrink.reason,
            path,
            warning: shrink.message,
            note:
              shrink.reason === 'entry_gutted'
                ? 'Do not blank main.js / index.html / App entry files. Restore full bootstrap content.'
                : 'Do not queue truncated or empty replacements. Call edit_file again with the full file content.'
          }),
          ok: false
        }
      }

      const alreadyRead = Array.from(readCache.keys()).some((key) => pathKeyMatchLoose(key, path))
      if (existingOnDisk !== null && !alreadyRead) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: `read required before edit ${path}`
        })
        recordFeedback({
          kind: 'tool',
          source: 'toolAgent',
          tool: 'edit_file',
          phase,
          path,
          ok: false,
          detail: 'read_required'
        })
        return {
          content: JSON.stringify({
            ok: false,
            error: 'read_required',
            path,
            note: 'Call read_file on this path before edit_file for existing files.'
          }),
          ok: false
        }
      }

      editedPaths.add(path)
      searchAnchors.add(path)
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
        summary: `queued edit ${path}`
      })
      recordFeedback({
        kind: 'tool',
        source: 'toolAgent',
        tool: 'edit_file',
        phase,
        path,
        ok: true,
        detail: 'queued',
        topHit:
          sessionSearchTops.length > 0 ? pathInTopHits(path, sessionSearchTops.slice(0, 5)) : undefined,
        searchTopPaths: sessionSearchTops.slice(0, 8)
      })
      return {
        content: JSON.stringify({
          ok: true,
          queued: true,
          path,
          note: 'Queued for 変更候補 review. Use run_shell in verify to test with proposals temporarily applied.'
        }),
        ok: true
      }
    }

    if (name === 'get_problems') {
      const editedOnly = args.edited_only !== false
      const source = problemsSnapshot
      const hits = editedOnly
        ? problemsAffectEditedPaths(source, editedPaths, { errorsOnly: true })
        : source.slice(0, 40)
      const payload = {
        ok: true,
        count: hits.length,
        editedOnly,
        problems: hits,
        note:
          hits.length === 0
            ? 'No matching Problems for edited paths (or snapshot empty). Still run_shell to verify.'
            : 'Fix these diagnostics with edit_file before finishing verify.'
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: hits.length === 0 ? 'problems: none' : `problems: ${hits.length}`
      })
      return { content: JSON.stringify(payload), ok: hits.length === 0 }
    }

    if (name === 'run_shell') {
      const command = String(args.command ?? '')
      const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
      const timeoutMs =
        typeof args.timeout_ms === 'number'
          ? args.timeout_ms
          : typeof args.timeoutMs === 'number'
            ? args.timeoutMs
            : 45_000

      if (isLongRunningShellCommand(command)) {
        const preferred = verifyHint?.primary ?? null
        const message = explainLongRunningShellCommand(command, preferred)
        onEvent({
          type: 'agent_phase',
          phase: 'verify',
          kind: 'progress',
          note: message
        })
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: `検証向きではないコマンド: ${command.trim().slice(0, 80)}`
        })
        return {
          content: JSON.stringify({
            ok: false,
            rejected: 'long_running',
            command: command.trim(),
            preferredVerify: preferred,
            error: message,
            note: 'Pick a command that exits (typecheck/test/lint). Do not use start/dev/serve/watch.'
          }),
          ok: false
        }
      }

      const limitSec = Math.round(Math.min(Math.max(timeoutMs, 5_000), 120_000) / 1000)
      const shortCmd = (cmd: string) => {
        const t = cmd.trim()
        return t.length > 80 ? `${t.slice(0, 80)}…` : t
      }

      const runOnce = async (cmd: string) => {
        throwIfChatAborted(signal)
        const startedAt = Date.now()
        const progress = setInterval(() => {
          if (signal?.aborted) return
          const sec = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
          onEvent({
            type: 'agent_phase',
            phase: 'verify',
            kind: 'progress',
            note: `変更が正しいか確認中です。ターミナルで「${shortCmd(cmd)}」を実行しています（${sec}秒経過 / 上限約${limitSec}秒）。終わると成功・失敗が分かります。`
          })
        }, 8_000)
        try {
          return await withMaterializedEdits(workspacePath, pendingEdits, () =>
            toolRunShell(workspacePath, cmd, { cwd, timeoutMs, signal })
          )
        } finally {
          clearInterval(progress)
        }
      }

      let activeCommand = command
      onEvent({
        type: 'agent_phase',
        phase: 'verify',
        kind: 'progress',
        note: `変更が正しいか確認するため、ターミナルで「${shortCmd(activeCommand)}」を実行します。数秒〜数十秒かかることがあります。`
      })
      let result = await runOnce(activeCommand)
      shellState.attempts += 1
      shellState.triedVerifyCommands.push(activeCommand.trim())
      shellState.lastExit = result.exitCode
      shellState.passed = result.ok

      // Auto-chain at most one fallback (typecheck → lint). Avoid long npm test chains.
      const autoTried: string[] = []
      while (!result.ok && autoTried.length < 1) {
        throwIfChatAborted(signal)
        const next = nextVerifyFallback(
          activeCommand,
          verifyHint ?? null,
          shellState.triedVerifyCommands
        )
        if (!next) break
        autoTried.push(next)
        shellState.triedVerifyCommands.push(next)
        onEvent({
          type: 'tool_call',
          id: `${callId}-fb-${autoTried.length}`,
          name: 'run_shell',
          args: { command: next, auto_fallback: true }
        })
        onEvent({
          type: 'agent_phase',
          phase: 'verify',
          kind: 'progress',
          note: `最初の確認が失敗したので、別コマンド「${shortCmd(next)}」でもう一度確認します。`
        })
        result = await runOnce(next)
        shellState.attempts += 1
        shellState.lastExit = result.exitCode
        shellState.passed = result.ok
        activeCommand = next
        onEvent({
          type: 'tool_result',
          id: `${callId}-fb-${autoTried.length}`,
          name: 'run_shell',
          ok: result.ok,
          summary: result.timedOut
            ? `時間切れ: ${shortCmd(next)}（代替）`
            : result.ok
              ? `確認OK（代替）: ${shortCmd(next)}`
              : `確認NG（代替）: ${shortCmd(next)}`
        })
        if (result.ok) break
      }

      const failureExcerpt = excerptShellFailure(result.stderr, result.stdout, 5_000)
      const remaining = nextVerifyFallback(
        activeCommand,
        verifyHint ?? null,
        shellState.triedVerifyCommands
      )
      const fallbackNote =
        result.ok && autoTried.length > 0
          ? ` Auto-fallback succeeded after trying: ${autoTried.join(' → ')}`
          : result.timedOut && remaining
            ? ` Timed out — next candidate: ${remaining}`
            : !result.ok && remaining
              ? ` Remaining verify candidates: ${remaining}`
              : !result.ok && autoTried.length > 0
                ? ` Auto-tried fallbacks: ${autoTried.join(' → ')}`
                : ''
      const payload = {
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cwd: result.cwd,
        command: result.command,
        autoFallbacksTried: autoTried,
        appliedPendingEdits: Array.from(pendingEdits.keys()).slice(0, 40),
        stdout: result.stdout,
        stderr: result.stderr,
        errorExcerpt: result.ok ? undefined : failureExcerpt,
        note: result.ok
          ? `Command succeeded${autoTried.length > 0 ? ' via auto-fallback' : ''}. Pending edits were restored after the run; accept 変更候補 to keep them on disk.${fallbackNote}`
          : `Command failed. Inspect errorExcerpt (tail-focused), set_phase edit, edit_file, then run_shell again.${fallbackNote}`
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: result.ok,
        summary: result.timedOut
          ? `時間切れ（約${limitSec}秒以内に終わらず停止）: ${shortCmd(activeCommand)}`
          : result.ok
            ? `確認OK（終了コード ${result.exitCode ?? 0}）: ${shortCmd(activeCommand)}`
            : `確認NG（終了コード ${result.exitCode ?? '?'}）: ${shortCmd(activeCommand)}${autoTried.length ? ' · 代替も試行' : ''}`
      })
      if (!result.ok && shellState.editRecoveries < MAX_EDIT_RECOVERIES) {
        shellState.editRecoveries += 1
        onEvent({
          type: 'agent_phase',
          phase: 'edit',
          note: `確認に失敗したので、修正し直します（${shellState.editRecoveries}/${MAX_EDIT_RECOVERIES}）`
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
      // Shell succeeded — still fail verify if Problems hit edited files.
      if (result.ok && editedPaths.size > 0 && problemsSnapshot.length > 0) {
        const problemHits = problemsAffectEditedPaths(problemsSnapshot, editedPaths, {
          errorsOnly: true
        })
        if (problemHits.length > 0) {
          shellState.passed = false
          if (shellState.editRecoveries < MAX_EDIT_RECOVERIES) {
            shellState.editRecoveries += 1
            onEvent({
              type: 'agent_phase',
              phase: 'edit',
              note: `エディタのエラーが残っているので、修正し直します（${shellState.editRecoveries}/${MAX_EDIT_RECOVERIES}）`
            })
            return {
              content: JSON.stringify({
                ...payload,
                ok: false,
                problemsBlocking: problemHits,
                autoRecoveredPhase: 'edit',
                note: 'Shell passed but Problems still report errors on edited files. Fix with edit_file.'
              }),
              ok: false,
              nextPhase: 'edit'
            }
          }
        }
      }
      return { content: JSON.stringify(payload), ok: result.ok }
    }

    if (name === 'read_skill') {
      const id = String(args.id ?? '').trim()
      if (!id) {
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: false,
          summary: 'skill id が空です'
        })
        return {
          content: JSON.stringify({ ok: false, error: 'skill id required' }),
          ok: false
        }
      }
      try {
        const skill = await readProjectSkill(workspacePath, id)
        onEvent({
          type: 'tool_result',
          id: callId,
          name,
          ok: true,
          summary: `skill ${skill.id} (${skill.path})`
        })
        return {
          content: JSON.stringify({
            ok: true,
            id: skill.id,
            name: skill.name,
            description: skill.description,
            path: skill.path,
            content: skill.content
          }),
          ok: true
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
        return {
          content: JSON.stringify({ ok: false, error: message }),
          ok: false
        }
      }
    }

    if (name === 'list_mcp_tools') {
      const listed = await mcpManager.listWorkspaceTools(workspacePath)
      const payload = {
        ok: true,
        servers: listed.servers.map((row) => ({
          id: row.id,
          command: row.command,
          args: row.args,
          url: row.url
        })),
        tools: listed.tools.map((row) => ({
          name: row.name,
          serverId: row.serverId,
          description: row.description
        })),
        resourceCount: listed.resources.length,
        promptCount: listed.prompts.length,
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
        summary: `mcp tools ${listed.tools.length} · resources ${listed.resources.length} · prompts ${listed.prompts.length}`
      })
      return { content: JSON.stringify(payload), ok: true }
    }

    if (name === 'list_mcp_resources') {
      const listed = await mcpManager.listWorkspaceTools(workspacePath)
      const payload = {
        ok: true,
        resources: listed.resources.map((row) => ({
          uri: row.uri,
          name: row.name,
          description: row.description,
          serverId: row.serverId,
          mimeType: row.mimeType
        }))
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `mcp resources ${listed.resources.length}`
      })
      return { content: JSON.stringify(payload), ok: true }
    }

    if (name === 'read_mcp_resource') {
      const uri = String(args.uri ?? '')
      if (!uri) {
        onEvent({ type: 'tool_result', id: callId, name, ok: false, summary: 'uri required' })
        return { content: JSON.stringify({ ok: false, error: 'uri required' }), ok: false }
      }
      const serverId = typeof args.serverId === 'string' ? args.serverId : undefined
      const result = await mcpManager.readResource(workspacePath, { uri, serverId })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: result.ok,
        summary: result.ok ? `resource ${uri.slice(0, 60)}` : `resource fail: ${result.error ?? ''}`
      })
      return {
        content: JSON.stringify({
          ok: result.ok,
          serverId: result.serverId,
          content: result.content,
          error: result.error
        }),
        ok: result.ok
      }
    }

    if (name === 'list_mcp_prompts') {
      const listed = await mcpManager.listWorkspaceTools(workspacePath)
      const payload = {
        ok: true,
        prompts: listed.prompts.map((row) => ({
          name: row.name,
          description: row.description,
          serverId: row.serverId
        }))
      }
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: true,
        summary: `mcp prompts ${listed.prompts.length}`
      })
      return { content: JSON.stringify(payload), ok: true }
    }

    if (name === 'get_mcp_prompt') {
      const promptName = String(args.name ?? '')
      if (!promptName) {
        onEvent({ type: 'tool_result', id: callId, name, ok: false, summary: 'name required' })
        return { content: JSON.stringify({ ok: false, error: 'name required' }), ok: false }
      }
      const serverId = typeof args.serverId === 'string' ? args.serverId : undefined
      const promptArgs =
        args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
          ? (args.arguments as Record<string, string>)
          : {}
      const result = await mcpManager.getPrompt(workspacePath, {
        name: promptName,
        serverId,
        arguments: promptArgs
      })
      onEvent({
        type: 'tool_result',
        id: callId,
        name,
        ok: result.ok,
        summary: result.ok
          ? `prompt ${promptName}`
          : `prompt fail: ${result.error ?? ''}`
      })
      return {
        content: JSON.stringify({
          ok: result.ok,
          serverId: result.serverId,
          content: result.content,
          error: result.error
        }),
        ok: result.ok
      }
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
    if (isChatAbortError(error) || signal?.aborted) {
      throw error
    }
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
  if (isGeminiEndpoint(params.engine, params.baseUrl)) {
    const { runWithGeminiThoughtState } = await import('./ai/adapters/geminiTools')
    return runWithGeminiThoughtState(() => runToolAgentSession(params))
  }
  return runToolAgentSession(params)
}

async function runToolAgentSession(params: ToolAgentParams): Promise<void> {
  const {
    workspacePath,
    baseUrl,
    model,
    extraHeaders,
    messages: seed,
    engine,
    taskType,
    sessionId,
    onEvent,
    complete,
    problems: problemsParam,
    anchorPaths: anchorPathsParam,
    signal
  } = params
  const { throwIfChatAborted } = await import('./chatAbort')
  throwIfChatAborted(signal)
  const problemsSnapshot = Array.isArray(problemsParam) ? problemsParam : []
  const searchAnchors = new Set(
    (Array.isArray(anchorPathsParam) ? anchorPathsParam : [])
      .map((row) => row.replace(/\\/g, '/').replace(/^\.\//, '').trim())
      .filter(Boolean)
  )
  const sessionSearchTops: string[] = []
  const sessionKey = `agent-${Date.now()}`

  if (!isToolAgentCompatibleEndpoint(engine, baseUrl, model)) {
    onEvent({
      type: 'error',
      code: 'AGENT_UNSUPPORTED',
      message:
        'このエンドポイントはツール Agent 非対応です（Cloudflare Workers AI など）。' +
        '設定で OpenAI、Claude、Gemini、または Grok を選んで再実行してください。'
    })
    return
  }

  const latestUserText = (() => {
    for (let i = seed.length - 1; i >= 0; i -= 1) {
      const row = seed[i]
      if (row?.role !== 'user') continue
      if (typeof row.content === 'string') return row.content
      if (Array.isArray(row.content)) {
        return row.content
          .map((part) => {
            if (!part || typeof part !== 'object') return ''
            const block = part as Record<string, unknown>
            return typeof block.text === 'string' ? block.text : ''
          })
          .filter(Boolean)
          .join('\n')
      }
    }
    return ''
  })()

  // Pure questions ("これは何ですか") must not enter edit/verify/run_shell.
  if (shouldAnswerWithoutTools(latestUserText)) {
    onEvent({
      type: 'agent_phase',
      phase: 'plan',
      note: '質問のためツールなしで回答'
    })
    onEvent({
      type: 'delta',
      text: '💬 質問のため、編集・検証ツールは使わずに回答します。\n'
    })
    const taskTypeHint = classifyTask(latestUserText, null)
    const qaMessages: ProviderMessage[] = [
      {
        role: 'system',
        content:
          'あなたは saforall のアシスタントです。ユーザーの質問に簡潔に日本語で答えてください。' +
          'コード修正・ファイル編集・シェル実行は不要です。警告文の意味を聞かれたら、そのまま説明してください。' +
          `（task=${taskTypeHint}）`
      },
      ...seed
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row) => ({
          role: row.role as 'user' | 'assistant',
          content: row.content
        }))
    ]
    try {
      const completion = await callAgentLlm({
        engine,
        baseUrl,
        model,
        extraHeaders,
        messages: qaMessages,
        signal,
        sessionId
      })
      const text =
        (completion.choices?.[0]?.message?.content ?? '').trim() ||
        '（回答を生成できませんでした。Ask モードで再送してください。）'
      onEvent({ type: 'delta', text: text.startsWith('💬') ? text : `\n${text}` })
      const completed = await complete(text)
      if (!completed) {
        onEvent({
          type: 'error',
          code: 'COMPLETE_FAILED',
          message: '応答の保存に失敗しました'
        })
        return
      }
      onEvent({
        type: 'done',
        model,
        engine,
        task_type: taskType,
        assistant_message: completed.assistant_message,
        estimated_usd: completed.estimated_usd,
        usage: completed.usage,
        used_tools: false
      })
    } catch (error) {
      const { isChatAbortError } = await import('./chatAbort')
      if (isChatAbortError(error) || signal?.aborted) throw error
      onEvent({
        type: 'error',
        code: 'AGENT_QA_FAILED',
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return
  }

  // Show progress before disk/MCP work so the UI is not silent.
  onEvent({ type: 'agent_phase', phase: 'plan', note: '計画を開始' })

  const [rules, verifySuggestion, skillsCatalog] = await Promise.all([
    loadProjectRules(workspacePath),
    suggestVerifyCommands(workspacePath),
    formatSkillsCatalog(workspacePath)
  ])
  const suggestedVerify = verifySuggestion?.primary ?? null
  const verifyFallbackText =
    verifySuggestion && verifySuggestion.fallbacks.length > 0
      ? ` / 代替: ${verifySuggestion.fallbacks.join(' · ')}`
      : ''
  // Defer MCP spawn/list — listing at start can block several seconds (up to ~12s).
  // Agent can call list_mcp_tools when needed.

  const agentSystem = [
    'あなたは saforall の長時間コーディング Agent です。大規模リファクタも担当します。',
    'ユーザー入力に誤字・変換ミスがあっても、文脈から意図を汲み取って作業してください。',
    '必ずフェーズを進めます: plan → explore → edit → verify。',
    'set_phase でフェーズを宣言してから作業してください。',
    'plan: 変更方針を短く立てる（必要なら軽く list/search）。',
    'explore: read_file / search_code / MCP / read_skill で深く調査（関連ファイルを複数読む）。',
    'edit: 既存ファイルは必ず先に read_file してから edit_file。複数ファイルを提案（変更候補パネル用。即時永続保存されない）。完全なファイル内容を送る（断片・切り捨て禁止）。',
    'verify: 編集ファイルを read_file で確認し、run_shell（typecheck/test/lint など終わるコマンド）と get_problems で検証する。失敗したら errorExcerpt / Problems を読んで edit に戻り、修正後に再実行。',
    '禁止: verify で npm start / npm run dev / vite / serve / watch など起動しっぱなしのコマンドを使わない（タイムアウトになる）。',
    '重要: 修正内容を markdown のコードブロックで説明するだけでは終了しない。必ず edit_file ツールで変更候補に載せる。',
    '重要: ツール呼び出しなしの最終回答は禁止。少なくとも調査（read/search）を行う。依頼が修正のときだけ edit_file + run_shell を行う。',
    '重要: 調査のみの依頼（読取・検索・説明）で編集が不要なら、read/search のあと追加の edit/verify に進まず最終回答してよい。',
    '重要: verify（read + run_shell）成功後は、同じツールの再実行や余分な set_phase をせず、すぐに最終回答する。',
    '重要: 「適用して」「反映して」「差分を適用」は編集依頼。edit_file で変更を変更候補に載せ、verify する。「編集できない」と断るのは禁止。',
    '重要: ユーザーが verify 警告文を引用して適用を求めたら、直前の作業内容を再開し edit_file で再提案する。警告文そのものを説明して終わりにしない。',
    '重要: 既存ファイルへの edit_file は read_file 済みパスのみ許可。未読なら read_required で拒否される。',
    '禁止: main.js / index.html / App 入口ファイルを空や数行のスタブにすること。画面が出ない障害の主因になる。',
    '禁止: set_phase / edit_file / read_file / run_shell を文章・bash・手順リストとして書くこと。必ず tools / function 呼び出しで呼ぶ。',
    'run_shell は提案中の edit を一時適用してから実行し、終了後にディスクを元に戻す。',
    'Skills: カタログに関連があれば read_skill で本文を読み、手順に従う（.saforall/skills/<id>/SKILL.md）。',
    'MCP: list_mcp_tools / list_mcp_resources / list_mcp_prompts / call_mcp_tool / read_mcp_resource / get_mcp_prompt を使える（.saforall/mcp.json）。必要なら先に list_mcp_tools で一覧を取得する。',
    `編集リカバリ上限: ${MAX_EDIT_RECOVERIES} 回まで verify 失敗→edit 自動復帰。`,
    '破壊的コマンドは禁止。まず短い検証（typecheck）を通し、必要なら test を追加。',
    'ツール失敗時は別パス/クエリ/コマンドで自己修正。同じ呼び出しを繰り返さない。失敗理由を読み、仮説を変える。',
    'シェル未成功のまま最終回答しない。直せる限り edit → run_shell を続ける。',
    '最終回答は日本語で、変更ファイル一覧・シェル結果・変更候補の適用案内を短くまとめる。ユーザー向けに「Composer」という語は使わず「変更候補」と言う。',
    `ワークスペース: ${workspacePath}`,
    suggestedVerify
      ? `推奨検証コマンド: ${suggestedVerify}${verifyFallbackText}`
      : 'package.json / テスト設定を探し、適切な検証コマンドを run_shell で実行する。'
  ]
  if (rules) {
    agentSystem.push('プロジェクトルール:\n' + rules)
  }
  if (skillsCatalog) {
    agentSystem.push(skillsCatalog)
  }
  const problemsBlock = formatProblemsForAgent(
    problemsSnapshot,
    30,
    Array.from(searchAnchors)
  )
  if (problemsBlock) {
    agentSystem.push(
      '現在の Problems（編集対象に関連し得る診断）:\n' +
        problemsBlock +
        '\nverify では get_problems で再確認し、error が残るなら edit_file で直す。'
    )
  }
  if (
    seed.some(
      (row) =>
        row.role === 'user' &&
        Array.isArray(row.content) &&
        row.content.some((part) => {
          if (!part || typeof part !== 'object') return false
          const block = part as Record<string, unknown>
          return (
            block.type === 'image_url' ||
            block.type === 'image' ||
            Boolean(block.inline_data) ||
            Boolean(block.source)
          )
        })
    )
  ) {
    agentSystem.push(
      'ユーザーが画像（UI スクショ等）を添付しています。見た目・エラー表示を読み取り、編集の根拠にしてください。'
    )
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

  let finalText = ''
  const maxSteps = 56
  let consecutiveToolFailures = 0
  const recentFailures: string[] = []
  const recentSignatures: string[] = []
  const successfulToolKeys = new Set<string>()
  let investigated = false
  let verifyFinalNudgeSent = false
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
    editRecoveries: 0,
    triedVerifyCommands: [] as string[]
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
  let proseOnlyBlocks = 0
  let emptyToolRetries = 0
  let anyToolCall = false
  const MAX_PROSE_ONLY_BLOCKS = 5
  const MAX_EMPTY_TOOL_RETRIES = 3

  for (let step = 0; step < maxSteps; step += 1) {
    throwIfChatAborted(signal)
    const pendingUnverified = unverifiedEditPaths(editedPaths, verifiedPaths)
    const verifyComplete = isVerifyComplete({
      editedCount: editedPaths.size,
      pendingUnverifiedCount: pendingUnverified.length,
      shellPassed: shellState.passed
    })
    const investigationComplete = isInvestigationComplete({
      anyToolCall,
      editedCount: editedPaths.size,
      investigated
    })
    const preferRequiredTools = shouldPreferRequiredTools({
      modelAllowsRequired: modelAllowsRequiredToolChoice(model),
      anyToolCall,
      editedCount: editedPaths.size,
      shellPassed: shellState.passed,
      editRecoveries: shellState.editRecoveries,
      maxEditRecoveries: MAX_EDIT_RECOVERIES,
      step,
      verifyComplete,
      investigationComplete
    })

    let completion: ChatCompletionResponse
    try {
      completion = await callAgentLlm({
        engine,
        baseUrl,
        model,
        extraHeaders,
        messages,
        tools: TOOLS,
        toolChoice: preferRequiredTools ? 'required' : 'auto',
        signal,
        sessionId
      })
    } catch (error) {
      const { isChatAbortError } = await import('./chatAbort')
      if (isChatAbortError(error) || signal?.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      // Surface provider detail immediately (avoid opaque "LLM HTTP 400")
      if (step === 0) {
        if (error instanceof AIError) throw error
        throw new Error(
          message.includes('LLM HTTP')
            ? message
            : `ツール Agent の LLM 呼び出しに失敗: ${message}`
        )
      }
      messages.push({
        role: 'user',
        content: `システム: LLM 呼び出し失敗（${message}）。これまでに分かったことと残作業を日本語で短くまとめてください。`
      })
      try {
        const fallback = await callAgentLlm({
          engine,
          baseUrl,
          model,
          extraHeaders,
          messages,
          signal,
          sessionId
        })
        finalText = (fallback.choices?.[0]?.message?.content ?? '').trim()
        if (finalText) break
      } catch (fallbackError) {
        const { isChatAbortError: isAbort } = await import('./chatAbort')
        if (isAbort(fallbackError) || signal?.aborted) throw fallbackError
        // fall through
      }
      throw error
    }

    const message = completion.choices?.[0]?.message
    if (!message) {
      throw new Error('LLM からメッセージを取得できませんでした')
    }

    const toolCalls = normalizeToolCalls(message.tool_calls)
    if (toolCalls.length > 0) {
      anyToolCall = true
      const verifyFinalNudgeSentBeforeBatch = verifyFinalNudgeSent
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: toolCalls
      })

      const canParallel = (name: string) =>
        name === 'read_file' ||
        name === 'list_dir' ||
        name === 'search_code' ||
        name === 'read_skill' ||
        name === 'list_mcp_tools' ||
        name === 'list_mcp_resources' ||
        name === 'list_mcp_prompts'
      const maxParallel = phase === 'explore' ? 8 : phase === 'verify' ? 4 : 5

      type OrderedRow = {
        call: ToolCall
        result: Awaited<ReturnType<typeof runTool>> | null
        skippedDup: boolean
      }
      const orderedResults: OrderedRow[] = []

      let i = 0
      while (i < toolCalls.length) {
        throwIfChatAborted(signal)
        const batch: ToolCall[] = []
        while (i < toolCalls.length) {
          const next = toolCalls[i]
          if (!next?.function?.name || !canParallel(next.function.name)) break
          const sig = toolSignature(
            next.function.name,
            repairToolArguments(next.function.arguments)
          )
          if (
            shouldSkipDuplicateToolCall({
              name: next.function.name,
              signature: sig,
              phase,
              successfulKeys: successfulToolKeys
            }) ||
            recentSignatures.includes(sig)
          ) {
            orderedResults.push({ call: next, result: null, skippedDup: true })
            i += 1
            continue
          }
          recentSignatures.push(sig)
          if (recentSignatures.length > 24) recentSignatures.shift()
          batch.push(next)
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
                verifySuggestion,
                problemsSnapshot,
                searchAnchors,
                sessionSearchTops,
                signal
              )
              return { call, result, skippedDup: false as const }
            })
          )
          orderedResults.push(...settled)
          continue
        }

        const call = toolCalls[i]
        i += 1
        if (!call?.function?.name) {
          continue
        }
        const sig = toolSignature(
          call.function.name,
          repairToolArguments(call.function.arguments)
        )
        if (
          call.function.name !== 'set_phase' &&
          (shouldSkipDuplicateToolCall({
            name: call.function.name,
            signature: sig,
            phase,
            successfulKeys: successfulToolKeys
          }) ||
            recentSignatures.includes(sig))
        ) {
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
          verifySuggestion,
          problemsSnapshot,
          searchAnchors,
          sessionSearchTops,
          signal
        )
        orderedResults.push({ call, result, skippedDup: false })
      }

      for (const row of orderedResults) {
        const { call } = row
        if (row.skippedDup || !row.result) {
          const dup = JSON.stringify({
            ok: true,
            duplicate: true,
            note: 'duplicate tool call skipped — already succeeded or recently attempted with same args; change path/query or advance phase'
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
            ok: true,
            summary: 'duplicate skipped'
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content: dup })
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
          const sig = toolSignature(
            call.function.name,
            repairToolArguments(call.function.arguments)
          )
          successfulToolKeys.add(successfulToolKey(phase, sig))
          if (isInvestigationTool(call.function.name)) investigated = true
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
          verifyFinalNudgeSent = true
          messages.push({
            role: 'user',
            content:
              'システム: read + run_shell 成功です。追加のツール呼び出しは不要です。最終回答を日本語でまとめ、エディタ上部の「変更候補」から差分を適用するよう促してください（「Composer」という語は使わない）。'
          })
        }
      }

      if (
        lastShellFailure &&
        !shellState.passed &&
        shellState.attempts >= 1 &&
        phase !== 'edit' &&
        recoverNudgeCount < 3 &&
        shellState.editRecoveries < MAX_EDIT_RECOVERIES
      ) {
        recoverNudgeCount += 1
        messages.push({
          role: 'user',
          content:
            'システム: シェル検証失敗からのリカバリです。set_phase edit で失敗箇所を修正し、verify で run_shell を再実行してください。get_problems も確認。\n--- failure ---\n' +
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

      // Only cut AFTER a prior verify-success nudge. Do not treat the success batch itself as redundant.
      if (
        verifyFinalNudgeSentBeforeBatch &&
        isRedundantPostVerifyBatch({
          verifyComplete: true,
          rows: orderedResults.map((row) => ({
            name: row.call.function.name,
            skippedDup: Boolean(row.skippedDup),
            ok: row.result ? row.result.ok : row.skippedDup ? true : null
          }))
        })
      ) {
        finalText =
          (message.content ?? '').trim() || buildPostVerifySuccessFinal(editedPaths)
        break
      }
      continue
    }

    // Empty tool_calls: dedicated retry before treating as prose-only answer.
    if (
      toolCalls.length === 0 &&
      shouldRetryEmptyToolCalls({
        emptyToolRetries,
        maxEmptyToolRetries: MAX_EMPTY_TOOL_RETRIES,
        verifyComplete,
        investigationComplete
      })
    ) {
      emptyToolRetries += 1
      recordFeedback({
        kind: 'agent_signal',
        source: 'toolAgent',
        detail: 'empty_tool_calls',
        ok: false,
        sessionKey,
        phase
      })
      messages.push({
        role: 'assistant',
        content: message.content ?? null
      })
      messages.push({
        role: 'user',
        content:
          'システム: tool_calls が空です。必ず API の function/tool_calls で少なくとも1つ呼び出してください（set_phase / read_file / search_code / edit_file / run_shell）。文章だけの応答は無効です。'
      })
      continue
    }

    // Model tried to answer in prose without any tool calls — block hard in Agent mode.
    const prose = (message.content ?? '').trim()
    const fakingTools = looksLikeFakeToolProse(prose)
    const mayAcceptFinal = shouldAcceptAgentFinal({
      anyToolCall,
      editedCount: editedPaths.size,
      verifyComplete,
      investigationComplete,
      fakingTools
    })
    if (!mayAcceptFinal && (!anyToolCall || editedPaths.size === 0 || fakingTools)) {
      if (proseOnlyBlocks < MAX_PROSE_ONLY_BLOCKS) {
        proseOnlyBlocks += 1
        messages.push({
          role: 'assistant',
          content: message.content ?? null
        })
        messages.push({
          role: 'user',
          content: fakingTools
            ? 'システム: ツール名を文章や bash コードブロックで書くのは無効です。API の function/tool_calls として set_phase / read_file / edit_file / run_shell を実際に呼び出してください。説明手順は禁止です。'
            : editedPaths.size === 0
              ? 'システム: Agent モードでは説明や markdown コード提示だけでは終了できません。必ずツールを呼び出してください（set_phase → read_file/search_code）。修正依頼のときだけ edit_file が必要です。調査のみなら read/search のあと最終回答して構いません。'
              : 'システム: まだツール実行が不十分です。verify のため run_shell を実行するか、追加の edit_file を行ってください。文章だけの最終回答は禁止です。'
        })
        continue
      }
      finalText = buildAgentProseExhaustionFinalText({
        anyToolCall,
        editedPathCount: editedPaths.size,
        fakingTools
      })
      break
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
        const canRecover = shellState.editRecoveries < MAX_EDIT_RECOVERIES
        messages.push({
          role: 'user',
          content: canRecover
            ? `システム: シェル検証が失敗したままです。最終回答は禁止。set_phase edit → edit_file で直し、再度 run_shell してください${
                suggestedVerify ? `（再実行例: ${suggestedVerify}）` : ''
              }。\n--- failure ---\n${lastShellFailure || '(no output)'}`
            : `システム: シェル検証が失敗し、自動リカバリ上限に達しています。失敗内容を明記したうえで最終回答し、変更候補で人手確認を促してください。\n--- failure ---\n${lastShellFailure || '(no output)'}`
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
      '\n\n⚠ verify が完了していません。変更候補の差分を必ず人手で確認してください。'
  }
  if (shellIncomplete && finalText) {
    finalText +=
      '\n\n⚠ シェル検証（run_shell）が未成功です。変更候補を適用する前にローカルで test/typecheck を実行してください。' +
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
        '変更候補で差分を確認し、必要なら手動で修正を続けてください。'
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
        '長時間 Agent を完了しました。エディタ上部の「変更候補」から変更を確認・適用してください。' +
        notes
    }
  }

  if (editedPaths.size > 0 && shellState.passed && !finalText.includes('変更候補')) {
    finalText +=
      '\n\n✅ シェル検証は成功しています。変更候補バーまたは一覧で「すべて適用」すると変更がディスクに残ります。'
  }

  if (
    editedPaths.size > 0 &&
    shellState.passed &&
    !verifyIncomplete &&
    !shellIncomplete
  ) {
    try {
      await appendProjectMemory(
        workspacePath,
        buildAgentSuccessMemoryNote({
          editedPaths: Array.from(editedPaths),
          verifyCommand: suggestedVerify,
          summary: finalText.slice(0, 280)
        })
      )
    } catch {
      // memory write is best-effort
    }
  }

  const editedList = Array.from(editedPaths)
  const topHit =
    editedList.length > 0 && sessionSearchTops.length > 0
      ? editedList.some((path) => pathInTopHits(path, sessionSearchTops.slice(0, 5)))
      : undefined
  let outcomeDetail = 'completed'
  if (verifyIncomplete || shellIncomplete || (editedList.length > 0 && !shellState.passed)) {
    outcomeDetail = 'verify_incomplete'
  } else if (editedList.length > 0 && shellState.passed) {
    outcomeDetail = 'verify_pass'
  } else if (editedList.length === 0) {
    outcomeDetail = 'no_edits'
  }
  recordFeedback({
    kind: 'agent_outcome',
    source: 'toolAgent',
    ok: outcomeDetail === 'verify_pass' || outcomeDetail === 'completed',
    detail: outcomeDetail,
    editedPaths: editedList,
    searchTopPaths: sessionSearchTops.slice(0, 12),
    topHit,
    sessionKey
  })
  if (outcomeDetail === 'verify_incomplete') {
    recordFeedback({
      kind: 'agent_signal',
      source: 'toolAgent',
      detail: 'verify_incomplete',
      ok: false,
      sessionKey
    })
  } else if (outcomeDetail === 'verify_pass') {
    recordFeedback({
      kind: 'agent_signal',
      source: 'toolAgent',
      detail: 'verify_pass',
      ok: true,
      sessionKey
    })
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
