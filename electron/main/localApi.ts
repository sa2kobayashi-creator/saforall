import type { ApiResponse } from './api'
import {
  createSession,
  deleteSession,
  listMessages,
  listSessions
} from './chatStore'
import { getLocalUsageSummary } from './usageStore'
import { upsertWorkspaceByPath } from './workspaceStore'
import {
  ensureSettingsLoaded,
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

    if (pathname === '/ai/usage' && m === 'GET') {
      const summary = await getLocalUsageSummary()
      return ok(summary) as ApiResponse<T>
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

    if ((pathname === '/ai/inline' || pathname === '/ai/edit') && m === 'POST') {
      return fail(
        'LOCAL_UNSUPPORTED',
        'この操作はローカルモードでは未対応です。バックエンド接続時に利用してください。'
      ) as ApiResponse<T>
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
