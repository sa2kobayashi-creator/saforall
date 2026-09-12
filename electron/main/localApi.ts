import type { ApiResponse } from './api'
import {
  createSession,
  deleteSession,
  listMessages,
  listSessions,
  truncateMessages
} from './chatStore'
import { getLocalUsageSummary } from './usageStore'
import { getFeedbackSummary } from './feedbackStore'
import { upsertWorkspaceByPath } from './workspaceStore'
import {
  ensureSettingsLoaded,
  getLocalSetting,
  getLocalSettingsMasked,
  mergeLocalSettings,
  markLocalSettingsClean
} from './settingsStore'

const DEFAULT_MODELS: Record<string, string[]> = {
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro'],
  claude: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  cursor: ['composer-2', 'composer-2.5'],
  workers: ['@cf/meta/llama-3.1-8b-instruct']
}

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data }
}

function fail(code: string, message: string): ApiResponse {
  return { ok: false, error: { code, message } }
}

function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  const raw = path.startsWith('/') ? path : `/${path}`
  const url = new URL(raw, 'http://local.saforall')
  return { pathname: url.pathname, query: url.searchParams }
}

/**
 * Local JSON-backed API mirror for packaged / offline use.
 * Keeps the same path contract as PHP so the renderer needs minimal changes.
 */
export async function localApiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  await ensureSettingsLoaded()
  const m = method.toUpperCase()
  const { pathname, query } = parsePath(path)

  try {
    if (pathname === '/settings' && m === 'GET') {
      return ok({ settings: await getLocalSettingsMasked() }) as ApiResponse<T>
    }
    if (pathname === '/settings' && m === 'PUT') {
      const settings =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { settings?: unknown }).settings === 'object'
          ? ((body as { settings: Record<string, string> }).settings ?? {})
          : {}
      await mergeLocalSettings(settings, { markDirty: false })
      await markLocalSettingsClean()
      return ok({ saved: true }) as ApiResponse<T>
    }

    if (pathname === '/workspaces' && m === 'POST') {
      const pathValue =
        typeof body === 'object' && body !== null && typeof (body as { path?: unknown }).path === 'string'
          ? (body as { path: string }).path
          : ''
      const name =
        typeof body === 'object' && body !== null && typeof (body as { name?: unknown }).name === 'string'
          ? (body as { name: string }).name
          : undefined
      if (!pathValue.trim()) return fail('INVALID_BODY', 'path is required') as ApiResponse<T>
      const workspace = await upsertWorkspaceByPath(pathValue, name)
      return ok({ workspace }) as ApiResponse<T>
    }

    if (pathname === '/chat/sessions' && m === 'GET') {
      const workspaceId = Number(query.get('workspace_id') || 0)
      const limit = Number(query.get('limit') || 40)
      const sessions = await listSessions({
        workspaceId: workspaceId > 0 ? workspaceId : null,
        limit
      })
      return ok({ sessions }) as ApiResponse<T>
    }

    if (pathname === '/chat/sessions' && m === 'POST') {
      const title =
        typeof body === 'object' && body !== null && typeof (body as { title?: unknown }).title === 'string'
          ? (body as { title: string }).title
          : 'New chat'
      const workspaceId =
        typeof body === 'object' && body !== null
          ? Number((body as { workspace_id?: unknown }).workspace_id)
          : 0
      const session = await createSession({
        title,
        workspaceId: Number.isFinite(workspaceId) ? workspaceId : null
      })
      return ok({ session }) as ApiResponse<T>
    }

    const sessionMatch = pathname.match(/^\/chat\/sessions\/(\d+)$/)
    if (sessionMatch && m === 'DELETE') {
      const id = Number(sessionMatch[1])
      const deleted = await deleteSession(id)
      if (!deleted) return fail('NOT_FOUND', 'session not found') as ApiResponse<T>
      return ok({ deleted: true }) as ApiResponse<T>
    }

    const messagesMatch = pathname.match(/^\/chat\/sessions\/(\d+)\/messages$/)
    if (messagesMatch && m === 'GET') {
      const id = Number(messagesMatch[1])
      const messages = await listMessages(id)
      return ok({ messages }) as ApiResponse<T>
    }

    const truncateMatch = pathname.match(/^\/chat\/sessions\/(\d+)\/messages\/truncate$/)
    if (truncateMatch && m === 'POST') {
      const id = Number(truncateMatch[1])
      const payload =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
      const messageId = Number(payload.message_id)
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return fail('INVALID_BODY', 'message_id is required') as ApiResponse<T>
      }
      const modeRaw = typeof payload.mode === 'string' ? payload.mode : 'deleteFrom'
      const mode = modeRaw === 'keepThrough' ? 'keepThrough' : 'deleteFrom'
      const content = typeof payload.content === 'string' ? payload.content : undefined
      try {
        const result = await truncateMessages({
          sessionId: id,
          messageId,
          content,
          mode
        })
        return ok(result) as ApiResponse<T>
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('not found')) {
          return fail('NOT_FOUND', message) as ApiResponse<T>
        }
        return fail('INVALID_BODY', message) as ApiResponse<T>
      }
    }

    if (pathname === '/ai/usage' && m === 'GET') {
      const summary = await getLocalUsageSummary()
      const feedback = await getFeedbackSummary(7)
      const usage = summary.usage
      let totalSpent = 0
      let totalLimit = 0
      for (const row of Object.values(usage)) {
        totalSpent += row.spent
        totalLimit += row.limit
      }
      const routerMonthRaw = (query.get('month') || '').trim()
      const routerMonth = /^\d{4}-\d{2}$/.test(routerMonthRaw)
        ? routerMonthRaw
        : summary.month
      const {
        listPersistedUsageEvents,
        usageEventsToRecentRows,
        billingModeForUi,
        countFailoverChains,
        groupUsageEventsByFailoverId,
        analyzeFailoverChains,
        analyzeUsageEventProviderStatus
      } = await import('./ai/usage')
      const { resolveCredential } = await import('./ai/credentials')
      const { parseProviderId } = await import('./ai/types')
      const allEvents = await listPersistedUsageEvents()
      const usageEvents = allEvents.filter((event) =>
        String(event.timestamp || '').startsWith(routerMonth)
      )
      // credentialId comes only from UsageEvent; never invent from current vault.
      const recent = usageEventsToRecentRows(usageEvents, 200).map((row) => {
        if (row.billingMode) return row
        const id = parseProviderId(row.engine)
        if (!id || id === 'cursor') return row
        return {
          ...row,
          billingMode: billingModeForUi(resolveCredential(id).billingMode)
        }
      })
      const byEngineMap = new Map<string, { engine: string; count: number; estimated_usd: number }>()
      for (const event of usageEvents) {
        const cur = byEngineMap.get(event.provider) ?? {
          engine: event.provider,
          count: 0,
          estimated_usd: 0
        }
        cur.count += 1
        cur.estimated_usd += Number(event.estimatedCost) || 0
        byEngineMap.set(event.provider, cur)
      }
      const routerFailoverChains = countFailoverChains(usageEvents)
      // Derived at read time from existing UsageEvents (failoverId). Not a new schema.
      const routerFailoverChainSummaries = groupUsageEventsByFailoverId(usageEvents)
      // Phase 3-A: read-time analysis from summaries only (Single Source).
      const routerFailoverAnalysis = analyzeFailoverChains(routerFailoverChainSummaries)
      // Phase 9-B: all UsageEvent provider status (separate population from Chain analysis).
      const usageEventProviderStatus = analyzeUsageEventProviderStatus(usageEvents)
      const router = {
        total: usageEvents.length,
        fallbacks: 0,
        fallback_rate: 0,
        router_failover_chains: routerFailoverChains,
        router_failover_chain_summaries: routerFailoverChainSummaries,
        router_failover_analysis: routerFailoverAnalysis,
        usage_event_provider_status: usageEventProviderStatus,
        by_engine: Array.from(byEngineMap.values()).map((row) => ({
          ...row,
          estimated_usd: Math.round(row.estimated_usd * 10000) / 10000
        })),
        by_task: [] as Array<{ task_type: string; engine: string; count: number }>,
        recent,
        month: routerMonth,
        recent_total: usageEvents.length,
        hints:
          usageEvents.length === 0
            ? [
                {
                  code: 'no_logs',
                  level: 'info',
                  text: 'まだ Usage イベントがありません。チャットすると記録されます。'
                }
              ]
            : []
      }
      return ok({
        month: summary.month,
        router_month: routerMonth,
        usage,
        models: [],
        total: {
          spent: totalSpent,
          limit: totalLimit,
          remaining: Math.max(0, totalLimit - totalSpent),
          requests: 0
        },
        router,
        feedback,
        claude_prepaid: (() => {
          const raw = getLocalSetting('llm.claude.prepaid_remaining_usd', '')
          const warnRaw = getLocalSetting('llm.claude.prepaid_warn_usd', '1')
          if (raw.trim() === '') {
            return { tracking: false, remaining: null, warn_at: Number(warnRaw) || 1 }
          }
          const remaining = Number(raw)
          return {
            tracking: true,
            remaining: Number.isFinite(remaining) ? remaining : 0,
            warn_at: Number(warnRaw) || 1
          }
        })(),
        note:
          'ローカル usage + 直近7日の検索/Agentフィードバック。Claude の「Anthropic 残高」は手入力のチャージ残です（公式残高APIなし）。'
      }) as ApiResponse<T>
    }

    if (pathname === '/ai/feedback' && m === 'GET') {
      const days = Number(query.get('days') || 7)
      const feedback = await getFeedbackSummary(Number.isFinite(days) ? days : 7)
      return ok(feedback) as ApiResponse<T>
    }

    if (pathname === '/ai/models' && m === 'GET') {
      const engine = query.get('engine') || 'openai'
      const models = DEFAULT_MODELS[engine] ?? DEFAULT_MODELS.openai
      return ok({
        engine,
        models: models.map((id) => ({ id, label: id }))
      }) as ApiResponse<T>
    }

    if (pathname === '/ai/test' && m === 'POST') {
      return ok({
        ok: true,
        model: 'local',
        sample: 'ローカルモードでは接続テストをスキップします（キーは保存済みなら利用できます）'
      }) as ApiResponse<T>
    }

    if (pathname === '/ai/inline' && m === 'POST') {
      await ensureSettingsLoaded()
      const bodyObj =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
      try {
        const { completeInlineLocal } = await import('./directLlm')
        const { recordLocalUsage } = await import('./usageStore')
        const result = await completeInlineLocal(bodyObj)
        await recordLocalUsage({ engine: result.engine, estimatedUsd: 0.0004 })
        return ok({
          completion: result.completion,
          model: result.model,
          engine: result.engine
        }) as ApiResponse<T>
      } catch (error) {
        return fail(
          'INLINE_FAILED',
          error instanceof Error ? error.message : String(error)
        ) as ApiResponse<T>
      }
    }

    if (pathname === '/ai/edit' && m === 'POST') {
      await ensureSettingsLoaded()
      const bodyObj =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
      try {
        const { completeEditLocal } = await import('./directLlm')
        const { recordLocalUsage } = await import('./usageStore')
        const result = await completeEditLocal(bodyObj)
        await recordLocalUsage({ engine: result.engine, estimatedUsd: 0.001 })
        return ok({
          edited: result.edited,
          model: result.model,
          engine: result.engine
        }) as ApiResponse<T>
      } catch (error) {
        return fail(
          'EDIT_FAILED',
          error instanceof Error ? error.message : String(error)
        ) as ApiResponse<T>
      }
    }

    if (pathname === '/ai/chat' && m === 'POST') {
      return fail(
        'USE_STREAM',
        'ローカルモードでは chatStream を使ってください'
      ) as ApiResponse<T>
    }

    return fail('NOT_FOUND', `local api: ${m} ${pathname}`) as ApiResponse<T>
  } catch (error) {
    return fail(
      'LOCAL_API_ERROR',
      error instanceof Error ? error.message : String(error)
    ) as ApiResponse<T>
  }
}
