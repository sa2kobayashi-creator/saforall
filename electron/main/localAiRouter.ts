import {
  ensureSettingsLoaded,
  getLocalSetting
} from './settingsStore'
import { appendMessage, createSession, getSession, listMessages } from './chatStore'
import { getLocalUsageSummary, recordLocalUsage, type MonthUsage } from './usageStore'
import {
  agentPreferenceChain,
  classifyTask,
  engineForTask
} from './lib/taskClassify'
import {
  detectRouterCategoryId,
  parseRouterCategoryId,
  resolveCategoryPreference,
  type RouterCategoryId
} from './lib/routerCategories'
import { extraHeadersFor, resolveCredential } from './ai/credentials'
import { parseProviderId } from './ai/types'

export type LocalRouteResult = {
  engine: string
  requested: string
  task_type: string
  router_category: string
  fallback_from: string | null
  fallback_reason: string | null
  mode: string
  model: string
  session_id: number
  user_message_id: number
  user_message: Record<string, unknown>
  cursor_run_id: number | null
  usage: MonthUsage
  provider: {
    base_url: string
    extra_headers: string[]
    messages: Array<{ role: string; content: string }>
  } | null
  estimated_usd?: number
}

function parseModels(raw: string, fallback: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const list = parsed.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
      if (list.length > 0) return list
    }
  } catch {
    // ignore
  }
  const single = getLocalSetting(fallback, '')
  return single ? [single] : []
}

function enabledCategoryIds(): Set<RouterCategoryId> {
  const raw = getLocalSetting('router.enabled_categories', '')
  const all: RouterCategoryId[] = [
    'auto',
    'dev_design',
    'dev_implement',
    'dev_test',
    'dev_docs',
    'writing',
    'summarize',
    'vision',
    'explain_learn',
    'brainstorm',
    'data_format',
    'research',
    'support_copy',
    'slides',
    'meeting_notes',
    'image_gen',
    'video_understand'
  ]
  if (!raw.trim()) {
    return new Set(all)
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const set = new Set(
        parsed
          .filter((row): row is string => typeof row === 'string')
          .map((row) => parseRouterCategoryId(row))
      )
      set.add('auto')
      return set
    }
  } catch {
    // fall through
  }
  return new Set<RouterCategoryId>(['auto'])
}

function pickEngine(
  requested: string,
  mode: string,
  message: string,
  context: Record<string, unknown> | null,
  routerCategoryRaw: unknown
): {
  engine: string
  reason: string | null
  taskType: string
  categoryId: RouterCategoryId
  systemHint: string | null
} {
  let taskType: string = classifyTask(message, context)
  if (mode === 'agent' && (taskType === 'light_qa' || taskType === 'summarize')) {
    taskType = 'codegen'
  }

  const allowedCats = enabledCategoryIds()
  let categoryId = parseRouterCategoryId(routerCategoryRaw)
  if (categoryId !== 'auto' && !allowedCats.has(categoryId)) {
    categoryId = 'auto'
  }
  if (categoryId === 'auto') {
    const images = Array.isArray(context?.images) ? context.images : []
    const detected = detectRouterCategoryId(message, images.length > 0)
    if (detected !== 'auto' && allowedCats.has(detected)) {
      categoryId = detected
    }
  }
  const catPref = resolveCategoryPreference(categoryId, mode)
  if (catPref.taskType) {
    taskType = catPref.taskType
  }

  if (requested && requested !== 'auto') {
    return {
      engine: requested,
      reason: null,
      taskType,
      categoryId,
      systemHint: catPref.systemHint
    }
  }

  const enabledRaw = getLocalSetting('router.enabled_engines', '["openai","gemini","claude"]')
  let enabled: string[] = ['openai', 'gemini', 'claude']
  try {
    const parsed = JSON.parse(enabledRaw) as unknown
    if (Array.isArray(parsed)) {
      enabled = parsed.filter((row): row is string => typeof row === 'string')
    }
  } catch {
    // keep default
  }

  const preferred =
    catPref.engine ??
    (taskType === 'image_gen'
      ? 'openai'
      : engineForTask(taskType as Parameters<typeof engineForTask>[0], mode))

  const hasKey = (engine: string): boolean => {
    const id = parseProviderId(engine)
    if (!id) return false
    if (!resolveCredential(id).available) return false
    if (engine === 'claude') {
      try {
        const raw = getLocalSetting('llm.claude.prepaid_remaining_usd', '')
        if (raw.trim() !== '') {
          const n = Number(raw)
          if (Number.isFinite(n) && n <= 0) return false
        }
      } catch {
        // ignore
      }
    }
    return true
  }

  if (taskType === 'image_gen' && hasKey('openai')) {
    return {
      engine: 'openai',
      reason: 'auto_image_gen_openai',
      taskType,
      categoryId: categoryId === 'auto' ? 'image_gen' : categoryId,
      systemHint: catPref.systemHint
    }
  }

  if (mode === 'agent') {
    for (const engine of agentPreferenceChain(preferred)) {
      if ((enabled.includes(engine) || engine === 'openai' || engine === 'claude') && hasKey(engine)) {
        return {
          engine,
          reason: preferred === engine ? `auto_agent_${engine}` : `auto_agent_fallback_${engine}`,
          taskType,
          categoryId,
          systemHint: catPref.systemHint
        }
      }
    }
  }

  const askChain =
    preferred === 'claude'
      ? ['claude', 'openai', 'gemini', 'cursor']
      : preferred === 'gemini'
        ? ['gemini', 'openai', 'claude', 'cursor']
        : ['openai', 'claude', 'gemini', 'cursor']

  for (const engine of askChain) {
    if (enabled.includes(engine) && hasKey(engine)) {
      return {
        engine,
        reason: preferred === engine ? `auto_${taskType}_${engine}` : `auto_fallback_${engine}`,
        taskType,
        categoryId,
        systemHint: catPref.systemHint
      }
    }
  }

  if (resolveCredential('openai').available) {
    return {
      engine: 'openai',
      reason: 'auto_fallback_openai',
      taskType,
      categoryId,
      systemHint: catPref.systemHint
    }
  }
  if (resolveCredential('claude').available) {
    return {
      engine: 'claude',
      reason: 'auto_fallback_claude',
      taskType,
      categoryId,
      systemHint: catPref.systemHint
    }
  }
  if (resolveCredential('gemini').available) {
    return {
      engine: 'gemini',
      reason: 'auto_fallback_gemini',
      taskType,
      categoryId,
      systemHint: catPref.systemHint
    }
  }
  return {
    engine: 'openai',
    reason: 'auto_fallback_openai',
    taskType,
    categoryId,
    systemHint: catPref.systemHint
  }
}

function buildHistoryMessages(
  history: Array<{ role: string; content: string }>,
  context: Record<string, unknown> | null,
  userText: string,
  systemHint?: string | null
): Array<{ role: string; content: string }> {
  const systemParts = [
    'あなたはコードアシスタントです。簡潔に日本語で答えてください。',
    '（ローカル永続化モード）'
  ]
  if (systemHint) {
    systemParts.push(systemHint)
  }
  if (context) {
    if (typeof context.path === 'string' && context.path) {
      systemParts.push(`# Active file\n${context.path}`)
    }
    if (typeof context.content === 'string' && context.content.trim()) {
      systemParts.push(`\`\`\`\n${String(context.content).slice(0, 12000)}\n\`\`\``)
    }
    const selection = context.selection
    if (selection && typeof selection === 'object') {
      const sel = selection as {
        path?: string
        text?: string
        start_line?: number
        end_line?: number
      }
      if (typeof sel.text === 'string' && sel.text.trim()) {
        systemParts.push(
          `# Selection ${sel.path ?? ''} ${sel.start_line ?? ''}-${sel.end_line ?? ''}\n\`\`\`\n${sel.text.slice(0, 4000)}\n\`\`\``
        )
      }
    }
    if (Array.isArray(context.problems) && context.problems.length > 0) {
      systemParts.push(
        `# Problems\n${context.problems
          .slice(0, 30)
          .map((row) => String(row))
          .join('\n')}`
      )
    }
    if (Array.isArray(context.files)) {
      for (const row of context.files.slice(0, 4)) {
        if (!row || typeof row !== 'object') continue
        const file = row as { path?: string; content?: string }
        if (!file.path || typeof file.content !== 'string') continue
        systemParts.push(
          `# File ${file.path}\n\`\`\`\n${file.content.slice(0, 6000)}\n\`\`\``
        )
      }
    }
    if (typeof context.index_summary === 'string' && context.index_summary.trim()) {
      systemParts.push(`# Codebase\n${String(context.index_summary).slice(0, 6000)}`)
    }
    if (typeof context.rules === 'string' && context.rules.trim()) {
      systemParts.push(`# Project rules\n${String(context.rules).slice(0, 12000)}`)
    }
    if (typeof context.skills === 'string' && context.skills.trim()) {
      systemParts.push(`# Skills\n${String(context.skills).slice(0, 6000)}`)
    }
  }
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemParts.join('\n\n') }
  ]
  for (const row of history.slice(-12)) {
    if (row.role === 'user' || row.role === 'assistant') {
      messages.push({ role: row.role, content: row.content })
    }
  }
  messages.push({ role: 'user', content: userText })
  return messages
}

export async function prepareLocalRoute(body: Record<string, unknown>): Promise<LocalRouteResult> {
  await ensureSettingsLoaded()
  let sessionId = Number(body.session_id)
  const workspaceIdRaw = body.workspace_id
  const workspaceId =
    typeof workspaceIdRaw === 'number' && Number.isFinite(workspaceIdRaw) && workspaceIdRaw > 0
      ? workspaceIdRaw
      : typeof workspaceIdRaw === 'string' && Number(workspaceIdRaw) > 0
        ? Number(workspaceIdRaw)
        : null

  let session =
    Number.isFinite(sessionId) && sessionId > 0 ? await getSession(sessionId) : null

  // Stale UI id after PHP↔local switch / deleted session / wiped local-db.
  if (!session) {
    session = await createSession({
      title: 'New chat',
      workspaceId
    })
    sessionId = session.id
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) throw new Error('message is required')

  const mode = typeof body.mode === 'string' ? body.mode : 'ask'
  const requested = typeof body.engine === 'string' ? body.engine : 'auto'
  const context =
    typeof body.context === 'object' && body.context !== null
      ? (body.context as Record<string, unknown>)
      : null
  const { engine, reason, taskType, categoryId, systemHint } = pickEngine(
    requested,
    mode,
    message,
    context,
    body.router_category
  )

  const reuseId = Number(body.user_message_id)
  let userMessage
  if (Number.isFinite(reuseId) && reuseId > 0) {
    const { truncateMessages } = await import('./chatStore')
    const truncated = await truncateMessages({
      sessionId,
      messageId: reuseId,
      content: message,
      mode: 'keepThrough'
    })
    if (!truncated.kept) throw new Error('user message not found')
    userMessage = truncated.kept
  } else {
    userMessage = await appendMessage({
      sessionId,
      role: 'user',
      content: message
    })
  }

  const history = await listMessages(sessionId)
  const prior = history
    .filter((row) => row.id !== userMessage.id)
    .map((row) => ({ role: row.role, content: row.content }))

  let model = typeof body.model === 'string' && body.model ? body.model : ''
  let baseUrl = 'https://api.openai.com/v1'
  let extraHeaders: string[] = []
  let provider: LocalRouteResult['provider'] = null

  const providerId = parseProviderId(engine)
  const cred = providerId ? resolveCredential(providerId).credential : null
  if (engine === 'openai') {
    baseUrl = cred?.baseUrl || getLocalSetting('llm.openai.base_url', 'https://api.openai.com/v1')
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.openai.models', ''), 'llm.openai.model')[0] ||
        getLocalSetting('llm.openai.model', 'gpt-4.1-mini')
    }
  } else if (engine === 'claude') {
    baseUrl = cred?.baseUrl || 'https://api.anthropic.com'
    extraHeaders = cred ? extraHeadersFor(cred) : []
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.claude.models', ''), 'llm.claude.model')[0] ||
        getLocalSetting('llm.claude.model', 'claude-sonnet-5')
    }
  } else if (engine === 'gemini') {
    baseUrl = 'gemini-native'
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.gemini.models', ''), 'llm.gemini.model')[0] ||
        getLocalSetting('llm.gemini.model', 'gemini-2.0-flash')
    }
  } else if (engine === 'workers') {
    baseUrl = cred?.baseUrl || ''
    extraHeaders = cred ? extraHeadersFor(cred) : []
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.workers.models', ''), 'llm.workers.model')[0] ||
        getLocalSetting('llm.workers.model', '@cf/meta/llama-3.1-8b-instruct')
    }
  } else if (engine === 'deepseek') {
    baseUrl = cred?.baseUrl || getLocalSetting('llm.deepseek.base_url', 'https://api.deepseek.com')
    model =
      model ||
      parseModels(getLocalSetting('llm.deepseek.models', ''), 'llm.deepseek.model')[0] ||
      getLocalSetting('llm.deepseek.model', 'deepseek-flash')
  } else if (engine === 'grok') {
    baseUrl = cred?.baseUrl || getLocalSetting('llm.grok.base_url', 'https://api.x.ai/v1')
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.grok.models', ''), 'llm.grok.model')[0] ||
        getLocalSetting('llm.grok.model', 'grok-4.6')
    }
  } else if (engine === 'cursor') {
    if (!model) {
      model =
        parseModels(getLocalSetting('llm.cursor.models', ''), 'llm.cursor.model')[0] ||
        getLocalSetting('llm.cursor.model', 'composer-2')
    }
  }

  if (engine === 'openai' || engine === 'claude' || engine === 'workers' || engine === 'grok' || engine === 'deepseek') {
    const { parseContextImages, attachImagesToOpenAiMessages, attachImagesToClaudeMessages } =
      await import('./lib/visionMessages')
    let messages = buildHistoryMessages(prior, context, message, systemHint) as Array<{
      role: string
      content: unknown
    }>
    const images = parseContextImages(context)
    if (images.length > 0) {
      messages =
        engine === 'claude'
          ? attachImagesToClaudeMessages(messages, images)
          : attachImagesToOpenAiMessages(messages, images)
    }
    provider = {
      base_url: baseUrl,
      extra_headers: extraHeaders,
      messages: messages as Array<{ role: string; content: string }>
    }
  } else if (engine === 'gemini') {
    const { parseContextImages, attachImagesToOpenAiMessages } = await import('./lib/visionMessages')
    let messages = buildHistoryMessages(prior, context, message, systemHint) as Array<{
      role: string
      content: unknown
    }>
    const images = parseContextImages(context)
    if (images.length > 0) {
      messages = attachImagesToOpenAiMessages(messages, images)
    }
    provider = {
      base_url: baseUrl,
      extra_headers: [],
      messages: messages as Array<{ role: string; content: string }>
    }
  }

  const usageSummary = await getLocalUsageSummary()
  return {
    engine,
    requested,
    task_type: taskType,
    router_category: categoryId,
    fallback_from: null,
    fallback_reason: reason,
    mode,
    model,
    session_id: sessionId,
    user_message_id: userMessage.id,
    user_message: userMessage as unknown as Record<string, unknown>,
    cursor_run_id: null,
    usage: usageSummary.usage,
    provider,
    estimated_usd: 0.002
  }
}

export async function completeLocalRoute(params: {
  sessionId: number
  content: string
  engine: string
  model: string
  estimatedUsd?: number
}): Promise<{
  assistant_message: Record<string, unknown>
  estimated_usd: number
  usage: MonthUsage
}> {
  const assistant = await appendMessage({
    sessionId: params.sessionId,
    role: 'assistant',
    content: params.content
  })
  const usage = await recordLocalUsage({
    engine: params.engine,
    estimatedUsd: params.estimatedUsd ?? 0.002
  })
  return {
    assistant_message: assistant as unknown as Record<string, unknown>,
    estimated_usd: params.estimatedUsd ?? 0.002,
    usage
  }
}
