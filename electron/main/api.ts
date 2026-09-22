import { extractAgentRuntimeContext } from './lib/agentContext'
import { resolveCredential } from './ai/credentials'
import { AIError } from './ai/errors'
import { parseProviderId } from './ai/types'

function hasUsableLlm(engine: string): boolean {
  const id = parseProviderId(engine)
  if (!id || id === 'cursor') return false
  return resolveCredential(id).available
}

async function noteClaudeCreditFailure(
  message: string | null | undefined,
  engine?: string | null
): Promise<void> {
  try {
    if (engine && engine !== 'claude') return
    const { isCreditOrQuotaError } = await import('./lib/providerErrors')
    if (!isCreditOrQuotaError(message)) return
    const lower = String(message || '').toLowerCase()
    const looksAnthropic =
      !engine &&
      (lower.includes('anthropic') || lower.includes('claude') || textIncludesCreditJp(message))
    if (!engine && !looksAnthropic) return
    const { markClaudePrepaidDepleted } = await import('./lib/claudePrepaid')
    await markClaudePrepaidDepleted()
  } catch {
    // ignore
  }
}

function textIncludesCreditJp(message: string | null | undefined): boolean {
  const text = String(message || '')
  return text.includes('クレジット') || text.includes('残高')
}

export type ApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export type HealthData = {
  service: string
  status: string
  database: string
  time: string
}

export type HealthResult = {
  connected: boolean
  baseUrl: string
  message: string
  data?: HealthData
  /** php = XAMPP backend, local = packaged JSON store */
  mode?: 'php' | 'local'
}

export type ApiRequestOptions = {
  timeoutMs?: number
}

const DEFAULT_BASE_URL = 'http://localhost:8081/saforall/api'
const DEFAULT_TIMEOUT_MS = 3000

/** True when last health check reached MySQL-backed PHP. */
let phpOnline = false
/** After a failed PHP probe in packaged apps, skip re-probing for a while. */
let phpProbeCooldownUntil = 0

export function isPhpBackendOnline(): boolean {
  return phpOnline
}

/**
 * Packaged installs are meant to run without XAMPP. Probing localhost:8081 on
 * every health check / chat adds multi-second stalls when nothing is listening.
 * Dev and explicit SAFORALL_API_BASE_URL keep PHP probing.
 */
export function shouldProbePhpBackend(now = Date.now()): boolean {
  if (process.env.SAFORALL_FORCE_LOCAL === '1') return false
  if (process.env.SAFORALL_API_BASE_URL) return true
  if (phpOnline) return true
  if (now < phpProbeCooldownUntil) return false
  try {
    // Lazy require so unit tests can import this module without Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    if (electron.app?.isPackaged) return false
  } catch {
    // not running under Electron
  }
  return true
}

export function getApiBaseUrl(): string {
  return (process.env.SAFORALL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

async function fetchJson<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
  extraHeaders?: Record<string, string>
): Promise<ApiResponse<T>> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = extraHeaders ? { ...extraHeaders } : {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })

    const payload = (await response.json()) as ApiResponse<T>
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        error: payload.error ?? {
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}`
        }
      }
    }

    return payload
  } finally {
    clearTimeout(timer)
  }
}

export async function checkHealth(): Promise<HealthResult> {
  const baseUrl = getApiBaseUrl()

  if (shouldProbePhpBackend()) {
    try {
      const result = await fetchJson<HealthData & { hint?: string; detail?: string }>(
        'GET',
        '/health',
        undefined,
        // Packaged users rarely have XAMPP; fail fast when something is half-open.
        { timeoutMs: 800 }
      )
      if (result.ok && result.data && result.data.database === 'connected') {
        phpOnline = true
        phpProbeCooldownUntil = 0
        return {
          connected: true,
          mode: 'php',
          baseUrl,
          message: 'バックエンド接続済み（XAMPP）',
          data: result.data
        }
      }
    } catch {
      // fall through to local
    }
    // Avoid hammering a dead :8081 every 30s from the installed app / idle UI.
    phpProbeCooldownUntil = Date.now() + 60_000
  }

  phpOnline = false
  try {
    const { ensureLocalDbReady } = await import('./localDb')
    await ensureLocalDbReady()
    const { ensureSettingsLoaded } = await import('./settingsStore')
    await ensureSettingsLoaded()
  } catch {
    // still report local mode
  }

  return {
    connected: true,
    mode: 'local',
    baseUrl: 'local://userData',
    message: 'アプリは端末内保存。チャットは Model API へ接続します（XAMPP 不要）',
    data: {
      service: 'saforall-local',
      status: 'ok',
      database: 'local',
      time: new Date().toISOString()
    }
  }
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions
): Promise<ApiResponse<T>> {
  const pathName = path.replace(/^\//, '').split('?')[0]
  // Model catalog live fetch lives in Electron (listProviderModels). Do not use the
  // older PHP stub that hard-codes Claude/Cursor builtin lists when XAMPP is up.
  if (
    method.toUpperCase() === 'GET' &&
    (pathName === 'ai/agent-runs' || pathName === 'ai/models')
  ) {
    const { localApiRequest } = await import('./localApi')
    return localApiRequest<T>(method, path, body)
  }
  if (phpOnline) {
    try {
      const result = await fetchJson<T>(method, path, body, options)
      if (result.ok) {
        if (method.toUpperCase() === 'PUT' && path.replace(/^\//, '') === 'settings') {
          const settings =
            typeof body === 'object' &&
            body !== null &&
            typeof (body as { settings?: unknown }).settings === 'object' &&
            (body as { settings: Record<string, string> }).settings !== null
              ? (body as { settings: Record<string, string> }).settings
              : null
          if (settings) {
            const { mergeLocalSettings, markLocalSettingsClean } = await import('./settingsStore')
            await mergeLocalSettings(settings, { markDirty: false })
            await markLocalSettingsClean()
          }
        }
        if (
          method.toUpperCase() === 'GET' &&
          path.replace(/^\//, '').split('?')[0] === 'ai/usage' &&
          result.data
        ) {
          const data: Record<string, unknown> = {
            ...(result.data as Record<string, unknown>)
          }
          try {
            const { getFeedbackSummary } = await import('./feedbackStore')
            data.feedback = await getFeedbackSummary(7)
          } catch {
            // feedback is optional
          }
          try {
            const router = data.router as
              | { recent?: Array<{ engine: string; created_at: string }> }
              | undefined
            if (router && Array.isArray(router.recent) && router.recent.length > 0) {
              const { enrichRecentWithBillingMode, billingModeForUi } = await import('./ai/usage')
              const { resolveCredential } = await import('./ai/credentials')
              const { parseProviderId } = await import('./ai/types')
              let events: Awaited<
                ReturnType<(typeof import('./ai/usage'))['listPersistedUsageEvents']>
              > = []
              try {
                const { listPersistedUsageEvents } = await import('./ai/usage')
                events = await listPersistedUsageEvents()
              } catch {
                events = []
              }
              data.router = {
                ...router,
                recent: enrichRecentWithBillingMode(router.recent, events, (engine) => {
                  try {
                    const id = parseProviderId(engine)
                    if (!id || id === 'cursor') return null
                    return (
                      billingModeForUi(resolveCredential(id).billingMode) ?? 'DEVELOPMENT'
                    )
                  } catch {
                    return 'DEVELOPMENT'
                  }
                })
              }
            }
          } catch {
            // keep usage payload even if billingMode enrichment fails
          }
          return {
            ...result,
            data: data as T
          }
        }
        return result
      }
    } catch {
      phpOnline = false
    }
  }

  const { localApiRequest } = await import('./localApi')
  return localApiRequest<T>(method, path, body)
}

/** Pull full settings (incl. secrets) from PHP into local store. Main-only. */
export async function syncSettingsFromServer(): Promise<{ ok: boolean; message: string }> {
  if (!phpOnline) {
    return { ok: true, message: 'ローカルモードのためサーバ同期は不要です' }
  }
  const { mergeLocalSettings, markLocalSettingsClean, getLocalSettingsRaw, isLocalSettingsDirty } =
    await import('./settingsStore')
  const exported = await fetchJson<{ settings: Record<string, string> }>(
    'GET',
    '/settings/export',
    undefined,
    { timeoutMs: 10_000 },
    { 'X-Saforall-Client': 'electron-main' }
  )
  if (!exported.ok || !exported.data?.settings) {
    return {
      ok: false,
      message: exported.error?.message ?? '設定の同期に失敗しました'
    }
  }
  await mergeLocalSettings(exported.data.settings, { markDirty: false })

  if (isLocalSettingsDirty()) {
    const local = await getLocalSettingsRaw()
    const push = await fetchJson('PUT', '/settings', { settings: local }, { timeoutMs: 15_000 })
    if (push.ok) await markLocalSettingsClean()
  } else {
    await markLocalSettingsClean()
  }
  return { ok: true, message: '設定をローカルに同期しました' }
}

export type MonthUsage = Record<
  string,
  { spent: number; limit: number; remaining: number }
>

export type ChatStreamEvent =
  | { type: 'user_message'; message: Record<string, unknown> }
  | {
      type: 'route'
      engine: string
      task_type: string
      model: string
      session_id?: number
      fallback_reason?: string | null
      budget_warning?: string | null
      estimated_usd?: number
      mode?: string
      policy_profile?: string
      usage?: MonthUsage
    }
  | { type: 'delta'; text: string }
  | {
      type: 'tool_call'
      id: string
      name: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      id: string
      name: string
      ok: boolean
      summary: string
    }
  | {
      type: 'edit_proposal'
      path: string
      content: string
    }
  | {
      type: 'agent_phase'
      phase: 'plan' | 'explore' | 'edit' | 'verify'
      note?: string
      /** progress = same shell check updating in place (do not spam phase lines) */
      kind?: 'status' | 'progress'
    }
  | {
      type: 'agent_checkpoint'
      step: number
      phase: string
      summary: string
    }
  | {
      type: 'done'
      model: string
      engine?: string
      task_type?: string
      estimated_usd?: number
      usage?: MonthUsage
      assistant_message: Record<string, unknown>
      used_tools?: boolean
    }
  | { type: 'cancelled'; message?: string }
  | { type: 'error'; code: string; message: string }

type RouteData = {
  engine: 'cursor' | 'openai' | 'gemini' | 'claude' | 'workers' | 'grok'
  requested: string
  task_type: string
  fallback_from: string | null
  fallback_reason: string | null
  budget_warning?: string | null
  estimated_usd?: number
  mode?: string
  policy_profile?: string
  model: string
  session_id: number
  user_message_id: number
  user_message: Record<string, unknown>
  cursor_run_id: number | null
  usage: MonthUsage
  cursor_api_key?: string | null
  provider?: {
    /** PHP legacy only. Electron LLM execution must not read this. */
    api_key?: string
    base_url: string
    extra_headers: string[]
    messages: Array<{ role: string; content: string }>
  } | null
}

type AgentTraceHooks = {
  streamRequestId?: string
  startAgentTrace: (meta: {
    sessionId: number | null
    engine: string
    model: string
    provider: string
  }) => Promise<void>
  wrapAgent: <T>(fn: () => Promise<T>) => Promise<T>
}

export async function streamChat(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal | null,
  streamRequestId?: string
): Promise<void> {
  const { isChatAbortError } = await import('./chatAbort')
  let terminal = false
  let agentTraceActive = false
  let observeChain: Promise<void> = Promise.resolve()
  const runId = typeof streamRequestId === 'string' ? streamRequestId.trim() : ''
  const emit = (event: ChatStreamEvent): void => {
    const isTerminal =
      event.type === 'done' || event.type === 'error' || event.type === 'cancelled'
    if (isTerminal) {
      terminal = true
    }
    if (agentTraceActive && runId) {
      // Persist Trace before renderer delivery so UsagePanel refresh on `done`
      // sees run_end. Preload must not treat invoke() success as incomplete
      // until this in-flight send can arrive.
      observeChain = observeChain
        .then(async () => {
          const { observeAgentStreamEvent } = await import('./ai/agentRunTrace')
          await observeAgentStreamEvent(runId, event)
          if (isTerminal) {
            try {
              const { finalizeAgentRunIfOpen } = await import('./ai/agentRunTrace')
              await finalizeAgentRunIfOpen(
                runId,
                event.type === 'cancelled' ? 'cancelled' : 'error'
              )
            } catch {
              // persist already attempted
            }
            onEvent(event)
          }
        })
        .catch(() => {
          if (isTerminal) onEvent(event)
        })
      if (!isTerminal) {
        onEvent(event)
      }
      return
    }
    onEvent(event)
  }
  const trace: AgentTraceHooks = {
    streamRequestId: runId || undefined,
    startAgentTrace: async (meta) => {
      if (!runId) return
      const { beginAgentRun } = await import('./ai/agentRunTrace')
      await beginAgentRun({
        runId,
        sessionId: meta.sessionId,
        engine: meta.engine,
        model: meta.model,
        provider: meta.provider
      })
      agentTraceActive = true
    },
    wrapAgent: async (fn) => {
      if (!runId) return fn()
      const { runInAgentRunContext } = await import('./ai/agentRunTrace')
      return runInAgentRunContext(runId, fn)
    }
  }
  try {
    await streamChatInner(body, emit, signal, trace)
  } catch (error) {
    if (isChatAbortError(error) || signal?.aborted) {
      if (!terminal) {
        emit({
          type: 'cancelled',
          message: 'ユーザーが応答を取り消しました'
        })
      }
    } else if (!terminal) {
      emit({
        type: 'error',
        code: error instanceof AIError ? error.code : 'STREAM_FAILED',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  if (!terminal) {
    if (signal?.aborted) {
      emit({
        type: 'cancelled',
        message: 'ユーザーが応答を取り消しました'
      })
    } else {
      emit({
        type: 'error',
        code: 'STREAM_INCOMPLETE',
        message: '応答が完了しませんでした。もう一度送信してください。'
      })
    }
  }
  if (agentTraceActive && runId) {
    await observeChain
    try {
      const { finalizeAgentRunIfOpen } = await import('./ai/agentRunTrace')
      await finalizeAgentRunIfOpen(runId, signal?.aborted ? 'cancelled' : 'error')
    } catch {
      // ignore
    }
  }
}

async function streamChatInner(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal | null,
  trace?: AgentTraceHooks
): Promise<void> {
  const { throwIfChatAborted, isChatAbortError } = await import('./chatAbort')
  const requestBody =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}

  throwIfChatAborted(signal)

  // Immediate UI feedback before route / local prepare (TTFT feel).
  const requestedMode =
    typeof requestBody.mode === 'string' ? requestBody.mode : 'ask'
  onEvent({
    type: 'delta',
    text: requestedMode === 'agent' ? '⏳ Agent を準備中…\n' : '⏳ 応答を準備中…\n'
  })

  let route: ApiResponse<RouteData>
  if (!phpOnline) {
    route = {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'バックエンド未接続（ローカル経路）'
      }
    }
  } else {
    try {
      route = await fetchJson<RouteData>(
        'POST',
        '/ai/route',
        requestBody,
        { timeoutMs: 3_000 },
        { 'X-Saforall-Client': 'electron-main' }
      )
    } catch (error) {
      if (isChatAbortError(error) || signal?.aborted) throw error
      route = {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'バックエンド未接続'
        }
      }
    }
  }

  throwIfChatAborted(signal)

  if (!route.ok || !route.data) {
    try {
      const { prepareLocalRoute, completeLocalRoute } = await import('./localAiRouter')
      const local = await prepareLocalRoute(requestBody)
      const decided = local as unknown as RouteData
      onEvent({
        type: 'user_message',
        message: decided.user_message
      })
      onEvent({
        type: 'route',
        engine: decided.engine,
        task_type: decided.task_type,
        model: decided.model,
        session_id: decided.session_id,
        fallback_reason: decided.fallback_reason ?? 'local_persistence',
        mode: decided.mode,
        usage: decided.usage
      })

      if (decided.engine === 'cursor') {
        await runCursorStream(requestBody, decided, onEvent, async (content) => {
          return completeLocalRoute({
            sessionId: decided.session_id,
            content,
            engine: decided.engine,
            model: decided.model
          })
        }, signal)
        return
      }

      if (decided.task_type === 'image_gen') {
        if (decided.engine !== 'openai' || !hasUsableLlm('openai')) {
          onEvent({
            type: 'error',
            code: 'IMAGE_GEN_UNAVAILABLE',
            message:
              '画像生成には OpenAI API キーが必要です。設定で OpenAI を保存するか、用途を切り替えてください。'
          })
          return
        }
        onEvent({ type: 'delta', text: '🖼 画像を生成しています…\n' })
        const { generateOpenAiImage } = await import('./lib/imageGenerate')
        const workspacePath =
          typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
        const prompt =
          typeof requestBody.message === 'string' ? requestBody.message : ''
        const generated = await generateOpenAiImage({
          prompt,
          baseUrl: decided.provider?.base_url,
          workspacePath
        })
        onEvent({ type: 'delta', text: generated.content })
        const completed = await completeLocalRoute({
          sessionId: decided.session_id,
          content: generated.content,
          engine: decided.engine,
          model: generated.model
        })
        onEvent({
          type: 'done',
          model: generated.model,
          engine: decided.engine,
          task_type: 'image_gen',
          estimated_usd: completed.estimated_usd,
          usage: completed.usage,
          assistant_message: completed.assistant_message
        })
        return
      }

      const mode = typeof decided.mode === 'string' ? decided.mode : 'ask'
      const workspacePath =
        typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
      const canToolAgent =
        mode === 'agent' &&
        workspacePath.trim() !== '' &&
        Boolean(decided.provider) &&
        hasUsableLlm(decided.engine) &&
        (decided.engine === 'openai' || decided.engine === 'claude' || decided.engine === 'gemini' || decided.engine === 'grok')

      if (mode === 'agent' && !canToolAgent) {
        onEvent({
          type: 'error',
          code: 'AGENT_TOOLS_UNAVAILABLE',
          message:
            'ローカル Agent は OpenAI / Claude / Gemini / Grok とワークスペースが必要です。Ask に切り替えるかキーを確認してください。'
        })
        return
      }

      if (canToolAgent && decided.provider) {
        const provider = decided.provider
        await trace?.startAgentTrace({
          sessionId: decided.session_id,
          engine: decided.engine,
          model: decided.model,
          provider: decided.engine
        })
        const wrapAgent = trace?.wrapAgent ?? (async <T>(fn: () => Promise<T>) => fn())
        await wrapAgent(async () => {
          onEvent({
            type: 'agent_phase',
            phase: 'plan',
            note: 'ツール Agent 起動（edit_file / run_shell）'
          })
          onEvent({
            type: 'delta',
            text: '🔧 ツール Agent を開始します。説明だけで終わらず、ツールで編集・検証します。\n'
          })
          const { runToolAgent } = await import('./toolAgent')
          const agentCtx = extractAgentRuntimeContext(requestBody)
          await runToolAgent({
            workspacePath,
            baseUrl: provider.base_url,
            model: decided.model,
            extraHeaders: provider.extra_headers ?? [],
            messages: provider.messages ?? [],
            engine: decided.engine,
            taskType: decided.task_type,
            sessionId: decided.session_id,
            problems: agentCtx.problems,
            anchorPaths: agentCtx.anchors,
            signal: signal ?? undefined,
            onEvent,
            complete: async (content) =>
              completeLocalRoute({
                sessionId: decided.session_id,
                content,
                engine: decided.engine,
                model: decided.model
              })
          })
        })
        return
      }

      if (!hasUsableLlm(decided.engine)) {
        onEvent({
          type: 'error',
          code: 'NO_API_KEY',
          message: 'ローカルモード: Settings に API キーを保存してください'
        })
        return
      }

      throwIfChatAborted(signal)
      const { generateAssistantText } = await import('./directLlm')
      const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import(
        './lib/providerErrors'
      )
      const requestedEngine =
        typeof requestBody.engine === 'string' ? requestBody.engine.trim().toLowerCase() : 'auto'

      const runLocalText = async (
        engine: string,
        provider: NonNullable<RouteData['provider']>,
        model: string,
        taskType: string
      ): Promise<void> => {
        const content = await generateAssistantText({
          engine,
          model,
          baseUrl: provider.base_url,
          messages: provider.messages ?? [],
          sessionId: decided.session_id
        })
        onEvent({ type: 'delta', text: content })
        const completed = await completeLocalRoute({
          sessionId: decided.session_id,
          content,
          engine,
          model
        })
        onEvent({
          type: 'done',
          model,
          engine,
          task_type: taskType,
          estimated_usd: completed.estimated_usd,
          usage: completed.usage,
          assistant_message: completed.assistant_message
        })
      }

      try {
        await runLocalText(
          decided.engine,
          decided.provider!,
          decided.model,
          decided.task_type
        )
        return
      } catch (genError) {
        const { isChatAbortError } = await import('./chatAbort')
        if (isChatAbortError(genError) || signal?.aborted) throw genError
        const msg = genError instanceof Error ? genError.message : String(genError)
        const canAutoRetry =
          (requestedEngine === 'auto' || requestedEngine === '') && isCreditOrQuotaError(msg)
        if (isCreditOrQuotaError(msg)) {
          await noteClaudeCreditFailure(msg, decided.engine)
        }
        if (!canAutoRetry) throw genError

        for (const nextEngine of autoRuntimeFallbackEngines(decided.engine, mode)) {
          throwIfChatAborted(signal)
          onEvent({
            type: 'delta',
            text: `\n↻ ${decided.engine} のクレジット／上限のため ${nextEngine} に切り替えます…\n`
          })
          const retryLocal = await prepareLocalRoute({
            ...requestBody,
            engine: nextEngine,
            user_message_id: decided.user_message_id
          })
          if (!retryLocal.provider || !hasUsableLlm(retryLocal.engine)) continue
          onEvent({
            type: 'route',
            engine: retryLocal.engine,
            task_type: retryLocal.task_type,
            model: retryLocal.model,
            session_id: retryLocal.session_id,
            fallback_reason: `runtime_credit_fallback_from_${decided.engine}`,
            mode: retryLocal.mode,
            usage: retryLocal.usage
          })
          try {
            await runLocalText(
              retryLocal.engine,
              retryLocal.provider,
              retryLocal.model,
              retryLocal.task_type
            )
            return
          } catch (retryError) {
            const { isChatAbortError: isAbort } = await import('./chatAbort')
            if (isAbort(retryError) || signal?.aborted) throw retryError
            const retryMsg =
              retryError instanceof Error ? retryError.message : String(retryError)
            if (!isCreditOrQuotaError(retryMsg)) throw retryError
          }
        }
        onEvent({
          type: 'error',
          code: 'CREDIT_EXHAUSTED',
          message:
            msg +
            ' Auto で代替エンジンも試しました。Settings で OpenAI / Gemini のキーと残高を確認してください。'
        })
        return
      }
    } catch (error) {
      const { isChatAbortError } = await import('./chatAbort')
      if (isChatAbortError(error) || signal?.aborted) throw error
      onEvent({
        type: 'error',
        code: route.error?.code ?? 'ROUTE_FAILED',
        message:
          (error instanceof Error ? error.message : route.error?.message) ||
          'ローカル AI の準備に失敗しました。Settings で API キーを確認してください。'
      })
      return
    }
  }

  const decided = route.data
  onEvent({
    type: 'user_message',
    message: decided.user_message
  })
  onEvent({
    type: 'route',
    engine: decided.engine,
    task_type: decided.task_type,
    model: decided.model,
    session_id: decided.session_id,
    fallback_reason: decided.fallback_reason,
    budget_warning: decided.budget_warning,
    estimated_usd: decided.estimated_usd,
    mode: decided.mode,
    policy_profile: decided.policy_profile,
    usage: decided.usage
  })

  if (decided.engine === 'cursor') {
    await runCursorStream(requestBody, decided, onEvent, undefined, signal)
    return
  }

  const mode = typeof decided.mode === 'string' ? decided.mode : 'ask'
  const workspacePath =
    typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
  const geminiNative =
    decided.engine === 'gemini' || decided.provider?.base_url === 'gemini-native'
  const providerOk = Boolean(
    decided.provider &&
      hasUsableLlm(decided.engine) &&
      decided.provider.base_url &&
      (geminiNative || decided.provider.base_url !== 'gemini-native')
  )
  const endpointOk =
    providerOk &&
    decided.engine !== 'workers' &&
    !String(decided.model || '')
      .toLowerCase()
      .startsWith('@cf/') &&
    (() => {
      const u = String(decided.provider?.base_url || '').toLowerCase()
      if (geminiNative) return true
      if (u.includes('cloudflare.com') || u.includes('workers.ai')) return false
      if (u.includes('/client/v4/accounts/') && u.includes('/ai/')) return false
      // Claude / Anthropic Messages API is supported by toolAgent
      if (decided.engine === 'claude' || u.includes('anthropic.com')) return true
      return true
    })()
  const canToolAgent =
    mode === 'agent' && workspacePath.trim() !== '' && providerOk && endpointOk

  if (mode === 'agent') {
    if (!canToolAgent) {
      const reasons: string[] = []
      if (!workspacePath.trim()) reasons.push('ワークスペース未選択（フォルダを開く）')
      if (decided.engine === 'workers') {
        reasons.push('Workers AI は function calling 非対応（OpenAI または Claude を選択）')
      }
      if (!decided.provider) {
        reasons.push('provider 情報なし（アプリ再起動 / API 接続を確認）')
      } else {
        if (!hasUsableLlm(decided.engine)) reasons.push(`${decided.engine} の API キー未設定`)
        if (
          !decided.provider.base_url ||
          (decided.provider.base_url === 'gemini-native' && decided.engine !== 'gemini')
        ) {
          reasons.push('ツール呼び出し可能な base_url が無い')
        }
        const u = decided.provider.base_url.toLowerCase()
        if (u.includes('cloudflare.com') || u.includes('workers.ai')) {
          reasons.push('Base URL が Cloudflare（api.openai.com/v1 に変更）')
        }
      }
      onEvent({
        type: 'error',
        code: 'AGENT_TOOLS_UNAVAILABLE',
        message:
          `Agent（ツール実行）を開始できません: ${reasons.join(' / ') || '条件不足'}。` +
          'OpenAI または Claude、もしくは Gemini を選び、フォルダを開いて再実行してください。' +
          'Ask への自動フォールバックはしません（edit_file を文章で演じるのを防ぐため）。'
      })
      return
    }
  }

  if (canToolAgent && decided.provider) {
    await trace?.startAgentTrace({
      sessionId: decided.session_id,
      engine: decided.engine,
      model: decided.model,
      provider: decided.engine
    })
    const wrapAgent = trace?.wrapAgent ?? (async <T>(fn: () => Promise<T>) => fn())
    await wrapAgent(async () => {
    const requestedEngine =
      typeof requestBody.engine === 'string' ? requestBody.engine.trim().toLowerCase() : 'auto'
    const tryToolAgent = async (
      agentDecided: RouteData
    ): Promise<{ ok: boolean; cancelled?: boolean; errorMessage?: string }> => {
      if (!agentDecided.provider) {
        return { ok: false, errorMessage: 'provider 情報なし' }
      }
      try {
        onEvent({
          type: 'agent_phase',
          phase: 'plan',
          note: 'ツール Agent 起動（edit_file / run_shell）'
        })
        onEvent({
          type: 'delta',
          text: '🔧 ツール Agent を開始します。説明だけで終わらず、ツールで編集・検証します。\n'
        })
        const { runToolAgent } = await import('./toolAgent')
        const agentCtx = extractAgentRuntimeContext(requestBody)
        await runToolAgent({
          workspacePath,
          baseUrl: agentDecided.provider.base_url,
          model: agentDecided.model,
          extraHeaders: agentDecided.provider.extra_headers ?? [],
          messages: agentDecided.provider.messages ?? [],
          engine: agentDecided.engine,
          taskType: agentDecided.task_type,
          sessionId: agentDecided.session_id,
          problems: agentCtx.problems,
          anchorPaths: agentCtx.anchors,
          signal: signal ?? undefined,
          onEvent,
          complete: async (content) => {
            const completed = await fetchJson<{
              assistant_message: Record<string, unknown>
              estimated_usd: number
              usage: MonthUsage
            }>(
              'POST',
              '/ai/complete',
              {
                session_id: agentDecided.session_id,
                content,
                engine: agentDecided.engine,
                task_type: agentDecided.task_type,
                model: agentDecided.model,
                fallback_from: agentDecided.fallback_from
              },
              { timeoutMs: 15_000 }
            )
            if (!completed.ok || !completed.data) return null
            return completed.data
          }
        })
        return { ok: true }
      } catch (error) {
        const { isChatAbortError } = await import('./chatAbort')
        if (isChatAbortError(error) || signal?.aborted) {
          onEvent({
            type: 'cancelled',
            message: 'ユーザーが応答を取り消しました'
          })
          return { ok: false, cancelled: true }
        }
        return {
          ok: false,
          errorMessage: error instanceof Error ? error.message : 'Tool Agent の実行に失敗しました'
        }
      }
    }

    const first = await tryToolAgent(decided)
    if (first.cancelled) return
    if (first.ok) return

    const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import('./lib/providerErrors')
    const canAutoRetry =
      (requestedEngine === 'auto' || requestedEngine === '') &&
      isCreditOrQuotaError(first.errorMessage)
    if (isCreditOrQuotaError(first.errorMessage)) {
      await noteClaudeCreditFailure(first.errorMessage, decided.engine)
    }
    if (canAutoRetry) {
      for (const nextEngine of autoRuntimeFallbackEngines(decided.engine, mode)) {
        if (nextEngine !== 'openai' && nextEngine !== 'claude') continue
        throwIfChatAborted(signal)
        onEvent({
          type: 'delta',
          text: `\n↻ ${decided.engine} のクレジット／上限のため ${nextEngine} に切り替えます…\n`
        })
        const retryRoute = await fetchJson<RouteData>(
          'POST',
          '/ai/route',
          {
            ...requestBody,
            engine: nextEngine,
            user_message_id: decided.user_message_id
          },
          { timeoutMs: 8_000 },
          { 'X-Saforall-Client': 'electron-main' }
        )
        if (!retryRoute.ok || !retryRoute.data?.provider) continue
        onEvent({
          type: 'route',
          engine: retryRoute.data.engine,
          task_type: retryRoute.data.task_type,
          model: retryRoute.data.model,
          session_id: retryRoute.data.session_id,
          fallback_reason: `runtime_credit_fallback_from_${decided.engine}`,
          mode,
          usage: retryRoute.data.usage
        })
        const retry = await tryToolAgent(retryRoute.data)
        if (retry.cancelled) return
        if (retry.ok) return
        if (!isCreditOrQuotaError(retry.errorMessage)) {
          onEvent({
            type: 'error',
            code: 'TOOL_AGENT_FAILED',
            message: retry.errorMessage ?? 'Tool Agent の実行に失敗しました'
          })
          return
        }
      }
      onEvent({
        type: 'error',
        code: 'CREDIT_EXHAUSTED',
        message:
          (first.errorMessage ?? 'クレジット不足') +
          ' Auto で代替エンジンも試しました。Settings で OpenAI のキーを確認するか、Anthropic をチャージしてください。'
      })
      return
    }

    onEvent({
      type: 'error',
      code: 'TOOL_AGENT_FAILED',
      message: first.errorMessage ?? 'Tool Agent の実行に失敗しました'
    })
    })
    return
  }

  throwIfChatAborted(signal)
  const requestedEngine =
    typeof requestBody.engine === 'string' ? requestBody.engine.trim().toLowerCase() : 'auto'
  const streamResult = await streamProviderChat(
    {
      ...requestBody,
      engine: decided.engine,
      user_message_id: decided.user_message_id,
      resolved_engine: decided.engine,
      requested: decided.requested,
      task_type: decided.task_type,
      fallback_from: decided.fallback_from,
      fallback_reason: decided.fallback_reason
    },
    onEvent,
    signal,
    { emitErrors: false }
  )
  if (streamResult.cancelled) return
  if (streamResult.ok) return

  const { isCreditOrQuotaError, autoRuntimeFallbackEngines } = await import('./lib/providerErrors')
  const canAutoRetry =
    (requestedEngine === 'auto' || requestedEngine === '') &&
    isCreditOrQuotaError(streamResult.errorMessage)

  if (isCreditOrQuotaError(streamResult.errorMessage)) {
    await noteClaudeCreditFailure(streamResult.errorMessage, decided.engine)
  }

  if (!canAutoRetry) {
    onEvent({
      type: 'error',
      code: streamResult.errorCode ?? 'STREAM_FAILED',
      message: streamResult.errorMessage ?? 'ストリームに失敗しました'
    })
    return
  }

  for (const nextEngine of autoRuntimeFallbackEngines(decided.engine, mode)) {
    throwIfChatAborted(signal)
    onEvent({
      type: 'delta',
      text: `\n↻ ${decided.engine} のクレジット／上限のため ${nextEngine} に切り替えます…\n`
    })
    onEvent({
      type: 'route',
      engine: nextEngine,
      task_type: decided.task_type,
      model: decided.model,
      session_id: decided.session_id,
      fallback_reason: `runtime_credit_fallback_from_${decided.engine}`,
      mode,
      usage: decided.usage
    })
    const retry = await streamProviderChat(
      {
        ...requestBody,
        engine: nextEngine,
        user_message_id: decided.user_message_id,
        resolved_engine: nextEngine,
        requested: 'auto',
        task_type: decided.task_type,
        fallback_from: decided.engine,
        fallback_reason: `runtime_credit_fallback_from_${decided.engine}`
      },
      onEvent,
      signal,
      { emitErrors: false }
    )
    if (retry.cancelled) return
    if (retry.ok) return
    if (!isCreditOrQuotaError(retry.errorMessage)) {
      onEvent({
        type: 'error',
        code: retry.errorCode ?? 'STREAM_FAILED',
        message: retry.errorMessage ?? 'ストリームに失敗しました'
      })
      return
    }
  }

  onEvent({
    type: 'error',
    code: 'CREDIT_EXHAUSTED',
    message:
      (streamResult.errorMessage ?? 'クレジット不足') +
      ' Auto で代替エンジンも試しました。Settings で OpenAI / Gemini のキーと残高を確認するか、Anthropic をチャージしてください。'
  })
}

async function runCursorStream(
  requestBody: Record<string, unknown>,
  decided: RouteData,
  onEvent: (event: ChatStreamEvent) => void,
  completeOverride?: (
    content: string
  ) => Promise<{
    assistant_message: Record<string, unknown>
    estimated_usd?: number
    usage?: MonthUsage
  } | null>,
  signal?: AbortSignal | null
): Promise<void> {
  const cwd =
    typeof requestBody.workspace_path === 'string'
      ? requestBody.workspace_path
      : ''
  const prompt =
    typeof requestBody.message === 'string' ? requestBody.message : ''
  const apiKey =
    decided.cursor_api_key ||
    resolveCredential('cursor').credential?.secret ||
    process.env.CURSOR_API_KEY ||
    ''
  const { parseContextImages, toCursorSdkImages } = await import('./lib/visionMessages')
  const cursorImages = toCursorSdkImages(parseContextImages(requestBody.context))

  if (cwd.trim() === '') {
    onEvent({
      type: 'error',
      code: 'NO_WORKSPACE',
      message: 'Cursor Agent にはワークスペース（フォルダを開く）が必要です'
    })
    return
  }
  if (apiKey.trim() === '') {
    onEvent({
      type: 'error',
      code: 'LLM_NOT_CONFIGURED',
      message: 'Cursor API キーが未設定です'
    })
    return
  }

  const runtimeRaw =
    typeof requestBody.cursor_runtime === 'string'
      ? requestBody.cursor_runtime.trim().toLowerCase()
      : 'auto'
  const runtime =
    runtimeRaw === 'local' || runtimeRaw === 'cloud' || runtimeRaw === 'auto'
      ? runtimeRaw
      : 'auto'
  const autoCreatePR = requestBody.cursor_auto_create_pr !== false

  try {
    const { runCursorAgent } = await import('./cursorAgent')
    const { throwIfChatAborted } = await import('./chatAbort')
    throwIfChatAborted(signal)
    const result = await runCursorAgent({
      apiKey,
      model: decided.model,
      cwd,
      prompt,
      images: cursorImages,
      runtime,
      autoCreatePR,
      signal,
      onDelta: (text) => {
        if (signal?.aborted) return
        onEvent({ type: 'delta', text })
      }
    })
    // Cancel after agent: do not verify/complete/done as success.
    if (signal?.aborted) {
      throw Object.assign(new Error('Chat cancelled by user'), { name: 'AbortError' })
    }
    throwIfChatAborted(signal)

    // Post-run local verify so Cursor path also surfaces pass/fail.
    // Cloud Agent edits remote VM / PR — skip local verify.
    let verifyAppendix = ''
    if (result.runtime === 'cloud') {
      verifyAppendix =
        '\n\n---\n☁ Cloud Agent 完了。ローカル検証はスキップ（PR / Cursor ダッシュボードを確認）'
      onEvent({ type: 'delta', text: verifyAppendix })
    } else {
      try {
        const { suggestVerifyCommand, toolRunShell } = await import('./workspaceTools')
        const command = await suggestVerifyCommand(cwd)
        if (command) {
          const verifyId = `cursor-verify-${Date.now()}`
          onEvent({ type: 'agent_phase', phase: 'verify', note: 'Cursor 完了後のローカル検証' })
          onEvent({
            type: 'tool_call',
            id: verifyId,
            name: 'run_shell',
            args: { command }
          })
          const shell = await toolRunShell(cwd, command, { timeoutMs: 90_000 })
          onEvent({
            type: 'tool_result',
            id: verifyId,
            name: 'run_shell',
            ok: shell.ok,
            summary: shell.timedOut
              ? `timeout: ${command}`
              : `exit ${shell.exitCode ?? '?'} · ${command}`
          })
          verifyAppendix = shell.ok
            ? `\n\n---\n✅ ローカル検証成功: \`${command}\``
            : `\n\n---\n⚠ ローカル検証失敗: \`${command}\` (exit=${shell.exitCode ?? 'timeout'})\n` +
              [shell.stderr, shell.stdout].filter(Boolean).join('\n').slice(0, 2500)
          if (verifyAppendix) {
            onEvent({ type: 'delta', text: verifyAppendix })
          }
        }
      } catch (verifyError) {
        verifyAppendix =
          `\n\n---\n⚠ ローカル検証を実行できませんでした: ` +
          (verifyError instanceof Error ? verifyError.message : String(verifyError))
        onEvent({ type: 'delta', text: verifyAppendix })
      }
    }

    const finalContent = `${result.text}${verifyAppendix}`.trim()

    const completed = completeOverride
      ? await completeOverride(finalContent)
      : (
          await fetchJson<{
            assistant_message: Record<string, unknown>
            estimated_usd: number
            usage: MonthUsage
          }>(
            'POST',
            '/ai/complete',
            {
              session_id: decided.session_id,
              content: finalContent,
              engine: 'cursor',
              task_type: decided.task_type,
              model: decided.model,
              cursor_run_id: decided.cursor_run_id,
              agent_id: result.agentId,
              sdk_run_id: result.runId,
              status: result.status === 'error' ? 'error' : 'done',
              fallback_from: decided.fallback_from
            },
            { timeoutMs: 15_000 }
          )
        ).data ?? null

    if (!completed) {
      onEvent({
        type: 'error',
        code: 'COMPLETE_FAILED',
        message: 'Cursor 結果の保存に失敗しました'
      })
      return
    }

    onEvent({
      type: 'done',
      model: decided.model,
      engine: 'cursor',
      task_type: decided.task_type,
      estimated_usd: completed.estimated_usd,
      usage: completed.usage,
      assistant_message: completed.assistant_message
    })
  } catch (error) {
    const { isChatAbortError } = await import('./chatAbort')
    if (isChatAbortError(error) || signal?.aborted) {
      onEvent({
        type: 'cancelled',
        message: 'ユーザーが応答を取り消しました'
      })
      return
    }
    onEvent({
      type: 'error',
      code: 'CURSOR_SDK_FAILED',
      message: error instanceof Error ? error.message : 'Cursor SDK の実行に失敗しました'
    })
  }
}

async function streamProviderChat(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  outerSignal?: AbortSignal | null,
  options?: { emitErrors?: boolean }
): Promise<{ ok: boolean; cancelled?: boolean; errorMessage?: string; errorCode?: string }> {
  const emitErrors = options?.emitErrors !== false
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}/ai/chat/stream`
  const { linkedAbortSignal, isChatAbortError, throwIfChatAborted } = await import('./chatAbort')
  const linked = linkedAbortSignal(120_000, outerSignal)

  const fail = (
    code: string,
    message: string
  ): { ok: false; errorMessage: string; errorCode: string } => {
    if (emitErrors) {
      onEvent({ type: 'error', code, message })
    }
    return { ok: false, errorMessage: message, errorCode: code }
  }

  try {
    throwIfChatAborted(outerSignal)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: linked.signal
    })

    const contentType = response.headers.get('content-type') ?? ''

    // ストリーム開始前の JSON エラー（未設定キーなど）
    if (!contentType.includes('text/event-stream')) {
      const payload = (await response.json()) as ApiResponse
      return fail(
        payload.error?.code ?? 'HTTP_ERROR',
        payload.error?.message ?? `HTTP ${response.status}`
      )
    }

    if (!response.body) {
      return fail('NETWORK_ERROR', 'ストリーム本文がありません')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      throwIfChatAborted(outerSignal)
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const chunk = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const line = chunk
          .split('\n')
          .map((part) => part.trim())
          .find((part) => part.startsWith('data:'))

        if (line) {
          const data = line.slice(5).trim()
          try {
            const event = JSON.parse(data) as ChatStreamEvent
            if (event.type === 'user_message' || event.type === 'route') {
              separator = buffer.indexOf('\n\n')
              continue
            }
            if (event.type === 'error') {
              if (emitErrors) onEvent(event)
              return {
                ok: false,
                errorMessage: event.message,
                errorCode: event.code
              }
            }
            onEvent(event)
            if (event.type === 'done' || event.type === 'cancelled') {
              return event.type === 'cancelled'
                ? { ok: false, cancelled: true }
                : { ok: true }
            }
          } catch {
            // ignore malformed event
          }
        }

        separator = buffer.indexOf('\n\n')
      }
    }

    return fail('STREAM_INCOMPLETE', '応答ストリームが途中終了しました。もう一度送信してください。')
  } catch (error) {
    if (isChatAbortError(error) || outerSignal?.aborted) {
      onEvent({
        type: 'cancelled',
        message: 'ユーザーが応答を取り消しました'
      })
      return { ok: false, cancelled: true }
    }
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'バックエンド応答タイムアウト'
        : error instanceof Error
          ? error.message
          : 'バックエンド未接続'

    return fail('NETWORK_ERROR', message)
  } finally {
    linked.dispose()
  }
}
