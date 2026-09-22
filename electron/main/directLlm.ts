import type { ChatStreamEvent } from './api'
import { extractAgentRuntimeContext } from './lib/agentContext'
import {
  ensureSettingsLoaded,
  getLocalSetting,
  hasUsableLocalLlm
} from './settingsStore'
import { hasUsableByokLlm, resolveCredential } from './ai/credentials'

function hasAnyLocalLlm(): boolean {
  return hasUsableLocalLlm() || hasUsableByokLlm()
}

type ProviderMessage = { role: string; content: string | unknown[] }

function parseJsonModels(raw: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const list = parsed.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
      if (list.length > 0) return list
    }
  } catch {
    // ignore
  }
  return fallback
}

function buildMessages(body: Record<string, unknown>): ProviderMessage[] {
  const userText = typeof body.message === 'string' ? body.message : ''
  const context =
    typeof body.context === 'object' && body.context !== null
      ? (body.context as Record<string, unknown>)
      : {}
  const parts: string[] = [
    'あなたはコードアシスタントです。簡潔に日本語で答えてください。',
    '（ローカル LLM モード: バックエンド未接続のため履歴は永続化されません）'
  ]
  if (typeof context.path === 'string' && context.path) {
    parts.push(`# Active file\n${context.path}`)
  }
  if (typeof context.content === 'string' && context.content.trim()) {
    parts.push(`\`\`\`\n${context.content.slice(0, 12000)}\n\`\`\``)
  }
  if (typeof context.index_summary === 'string' && context.index_summary.trim()) {
    parts.push(`# Codebase\n${context.index_summary.slice(0, 6000)}`)
  }
  if (Array.isArray(context.problems) && context.problems.length > 0) {
    parts.push(`# Problems\n${context.problems.slice(0, 20).join('\n')}`)
  }
  if (Array.isArray(context.files)) {
    for (const row of context.files.slice(0, 4)) {
      if (!row || typeof row !== 'object') continue
      const file = row as { path?: string; content?: string }
      if (!file.path || typeof file.content !== 'string') continue
      parts.push(`# File ${file.path}\n\`\`\`\n${file.content.slice(0, 6000)}\n\`\`\``)
    }
  }
  const selection =
    typeof context.selection === 'object' && context.selection !== null
      ? (context.selection as Record<string, unknown>)
      : null
  if (selection && typeof selection.text === 'string' && selection.text.trim()) {
    parts.push(`# Selection\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\``)
  }
  if (Array.isArray(context.images) && context.images.length > 0) {
    parts.push(
      'ユーザーが画像を添付しています。UI スクショやエラー表示を読み取り、コード修正の根拠にしてください。'
    )
  }
  return [
    { role: 'system', content: parts.join('\n\n') },
    { role: 'user', content: userText }
  ]
}

async function applyVisionToMessages(
  messages: ProviderMessage[],
  body: Record<string, unknown>,
  engine: string
): Promise<ProviderMessage[]> {
  const { parseContextImages, attachImagesToOpenAiMessages, attachImagesToClaudeMessages } =
    await import('./lib/visionMessages')
  const context =
    typeof body.context === 'object' && body.context !== null ? body.context : null
  const images = parseContextImages(context)
  if (images.length === 0) return messages
  const shaped = messages as Array<{ role: string; content: unknown }>
  if (engine === 'claude') {
    return attachImagesToClaudeMessages(shaped, images) as ProviderMessage[]
  }
  return attachImagesToOpenAiMessages(shaped, images) as ProviderMessage[]
}

function resolveLocalEngine(requested: string): {
  engine: string
  model: string
  baseUrl?: string
} | null {
  const order =
    requested === 'auto'
      ? ['openai', 'claude', 'gemini', 'grok', 'cursor']
      : [requested]

  for (const engine of order) {
    if (engine === 'cursor') {
      const cred = resolveCredential('cursor').credential
      if (!cred) continue
      const models = parseJsonModels(getLocalSetting('llm.cursor.models', ''), [
        getLocalSetting('llm.cursor.model', 'composer-2')
      ])
      return { engine: 'cursor', model: models[0] || 'composer-2' }
    }
    const id =
      engine === 'openai' || engine === 'claude' || engine === 'gemini' || engine === 'workers' || engine === 'grok'
        ? engine
        : null
    if (!id) continue
    const cred = resolveCredential(id).credential
    if (!cred) continue
    const models =
      id === 'openai'
        ? parseJsonModels(getLocalSetting('llm.openai.models', ''), [
            getLocalSetting('llm.openai.model', 'gpt-4.1-mini')
          ])
        : id === 'claude'
          ? parseJsonModels(getLocalSetting('llm.claude.models', ''), [
              getLocalSetting('llm.claude.model', 'claude-sonnet-5')
            ])
          : id === 'gemini'
            ? parseJsonModels(getLocalSetting('llm.gemini.models', ''), [
                getLocalSetting('llm.gemini.model', 'gemini-2.0-flash')
              ])
            : id === 'grok'
              ? parseJsonModels(getLocalSetting('llm.grok.models', ''), [
                  getLocalSetting('llm.grok.model', 'grok-4.6')
                ])
            : parseJsonModels(getLocalSetting('llm.workers.models', ''), [
                getLocalSetting('llm.workers.model', '@cf/meta/llama-3.1-8b-instruct')
              ])
    return {
      engine: id,
      model: models[0] || '',
      baseUrl: cred.baseUrl || undefined
    }
  }
  return null
}

/** Tab / Ctrl+K: prefer fast chat APIs (skip Cursor Agent). */
export function resolveCompletionEngine(): {
  engine: string
  model: string
  baseUrl?: string
} | null {
  for (const engine of ['openai', 'gemini', 'claude', 'grok']) {
    const resolved = resolveLocalEngine(engine)
    if (resolved) return resolved
  }
  return null
}

function stripCodeFences(text: string): string {
  let out = text.trim()
  if (out.startsWith('```')) {
    out = out.replace(/^```[a-zA-Z0-9_+-]*\n?/, '').replace(/\n?```$/, '')
  }
  return out.trim()
}

export async function completeInlineLocal(body: Record<string, unknown>): Promise<{
  completion: string
  model: string
  engine: string
}> {
  await ensureSettingsLoaded()
  if (!hasAnyLocalLlm()) {
    throw new Error('API キーがありません。設定で OpenAI / Gemini / Claude を保存してください。')
  }
  const resolved = resolveCompletionEngine()
  if (!resolved) {
    throw new Error('Tab 補完用の LLM がありません（Cursor のみでは未対応です）')
  }

  let prefix = typeof body.prefix === 'string' ? body.prefix : ''
  let suffix = typeof body.suffix === 'string' ? body.suffix : ''
  let nearby = typeof body.nearby === 'string' ? body.nearby.trim() : ''
  const language = typeof body.language === 'string' ? body.language : 'plaintext'
  const path = typeof body.path === 'string' ? body.path : ''
  if (prefix.length > 3500) prefix = prefix.slice(-3500)
  if (suffix.length > 1200) suffix = suffix.slice(0, 1200)
  if (nearby.length > 600) nearby = nearby.slice(0, 600)
  if (!prefix.trim() && !suffix.trim()) {
    throw new Error('prefix or suffix is required')
  }

  const system = [
    'You are a code completion engine like Cursor Tab.',
    'Return ONLY the text that should be inserted at the cursor.',
    'Do not repeat the prefix. Do not wrap in markdown fences.',
    'Prefer a short continuation (1-12 lines). Stop early when a statement/block completes.',
    'Match indentation and style of the surrounding code.',
    `Language: ${language}`,
    path ? `File: ${path}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const userParts = [`PREFIX:\n${prefix}`, `SUFFIX:\n${suffix}`]
  if (nearby) userParts.push(`NEARBY SYMBOLS:\n${nearby}`)
  userParts.push('Insert completion now:')

  const raw = await generateAssistantText({
    engine: resolved.engine,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userParts.join('\n\n') }
    ]
  })
  let completion = stripCodeFences(raw)
  if (completion.length > 1200) completion = completion.slice(0, 1200)
  return { completion, model: resolved.model, engine: resolved.engine }
}

export async function completeEditLocal(body: Record<string, unknown>): Promise<{
  edited: string
  model: string
  engine: string
}> {
  await ensureSettingsLoaded()
  if (!hasAnyLocalLlm()) {
    throw new Error('API キーがありません。設定で OpenAI / Gemini / Claude を保存してください。')
  }
  const resolved = resolveCompletionEngine()
  if (!resolved) {
    throw new Error('インライン編集用の LLM がありません（Cursor のみでは未対応です）')
  }

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  let selection = typeof body.selection === 'string' ? body.selection : ''
  let prefix = typeof body.prefix === 'string' ? body.prefix : ''
  let suffix = typeof body.suffix === 'string' ? body.suffix : ''
  const language = typeof body.language === 'string' ? body.language : 'plaintext'
  const path = typeof body.path === 'string' ? body.path : ''
  if (!instruction) throw new Error('instruction is required')
  if (!selection.trim()) throw new Error('selection is required')
  if (selection.length > 12000) selection = selection.slice(0, 12000)
  if (prefix.length > 2500) prefix = prefix.slice(-2500)
  if (suffix.length > 1500) suffix = suffix.slice(0, 1500)

  const system = [
    'You are an inline code editor like Cursor Ctrl+K.',
    'Rewrite ONLY the selected code according to the user instruction.',
    'Return ONLY the replacement code for the selection.',
    'Do not wrap in markdown fences. Do not add explanations.',
    'Preserve indentation style of the selection unless asked otherwise.',
    `Language: ${language}`,
    path ? `File: ${path}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const user = [
    'INSTRUCTION:',
    instruction,
    '',
    'PREFIX (context before selection):',
    prefix || '(none)',
    '',
    'SELECTION:',
    selection,
    '',
    'SUFFIX (context after selection):',
    suffix || '(none)',
    '',
    'Return the edited selection now:'
  ].join('\n')

  const raw = await generateAssistantText({
    engine: resolved.engine,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  })
  return { edited: stripCodeFences(raw), model: resolved.model, engine: resolved.engine }
}

export async function generateAssistantText(params: {
  engine: string
  model: string
  baseUrl?: string
  messages: ProviderMessage[]
  sessionId?: number | null
}): Promise<string> {
  const { executeAi } = await import('./ai')
  const { parseProviderId } = await import('./ai/types')
  const provider = parseProviderId(params.engine)
  if (!provider || provider === 'cursor') {
    throw new Error(`LLM Router 対象外の engine: ${params.engine}`)
  }
  const response = await executeAi({
    provider,
    routingMode: 'manual',
    model: params.model,
    messages: params.messages,
    baseUrl: params.baseUrl,
    metadata: params.sessionId != null ? { sessionId: params.sessionId } : undefined
  })
  const content = response.content
  if (!content?.trim()) {
    throw new Error('LLM から空の応答が返りました')
  }
  return content
}

/**
 * Backend-down chat path. Keys stay in Main (settingsStore). Returns true if handled.
 */
export async function streamChatDirect(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void
): Promise<boolean> {
  await ensureSettingsLoaded()
  if (!hasAnyLocalLlm()) return false

  const requestBody =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const requested = typeof requestBody.engine === 'string' ? requestBody.engine : 'auto'
  const mode = typeof requestBody.mode === 'string' ? requestBody.mode : 'ask'
  const resolved = resolveLocalEngine(requested)
  if (!resolved) return false

  const ephemeralId = `local-${Date.now()}`
  const userMessage = {
    id: ephemeralId,
    role: 'user',
    content: typeof requestBody.message === 'string' ? requestBody.message : ''
  }

  onEvent({ type: 'user_message', message: userMessage })
  onEvent({
    type: 'route',
    engine: resolved.engine,
    task_type: 'local',
    model: resolved.model,
    fallback_reason: 'backend_offline_local_llm',
    mode,
    usage: undefined
  })

  try {
    if (resolved.engine === 'cursor') {
      const cwd =
        typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
      if (!cwd.trim()) {
        onEvent({
          type: 'error',
          code: 'NO_WORKSPACE',
          message: 'ローカル Cursor Agent にはワークスペースが必要です'
        })
        return true
      }
      const { runCursorAgent } = await import('./cursorAgent')
      const { parseContextImages, toCursorSdkImages } = await import('./lib/visionMessages')
      const runtimeRaw =
        typeof requestBody.cursor_runtime === 'string'
          ? requestBody.cursor_runtime.trim().toLowerCase()
          : getLocalSetting('llm.cursor.runtime', 'auto')
      const runtime =
        runtimeRaw === 'local' || runtimeRaw === 'cloud' || runtimeRaw === 'auto'
          ? runtimeRaw
          : 'auto'
      const cursorCred = resolveCredential('cursor').credential
      const result = await runCursorAgent({
        cwd,
        prompt: String(requestBody.message ?? ''),
        images: toCursorSdkImages(parseContextImages(requestBody.context)),
        apiKey: cursorCred?.secret ?? '',
        model: resolved.model,
        runtime,
        onDelta: (text) => onEvent({ type: 'delta', text })
      })
      onEvent({
        type: 'done',
        model: resolved.model,
        engine: 'cursor',
        task_type: 'local',
        assistant_message: {
          id: `local-assistant-${Date.now()}`,
          role: 'assistant',
          content: result.text
        }
      })
      return true
    }

    if (mode === 'agent') {
      const workspacePath =
        typeof requestBody.workspace_path === 'string' ? requestBody.workspace_path : ''
      if (!workspacePath.trim()) {
        onEvent({
          type: 'error',
          code: 'NO_WORKSPACE',
          message: 'ローカル Agent にはワークスペースが必要です'
        })
        return true
      }
      if (resolved.engine !== 'openai' && resolved.engine !== 'claude' && resolved.engine !== 'gemini' && resolved.engine !== 'grok') {
        onEvent({
          type: 'error',
          code: 'AGENT_TOOLS_UNAVAILABLE',
          message: 'オフライン Agent は OpenAI、Claude、Gemini、または Grok のみ対応です'
        })
        return true
      }
      const { runToolAgent } = await import('./toolAgent')
      const messages = await applyVisionToMessages(
        buildMessages(requestBody),
        requestBody,
        resolved.engine
      )
      const agentCtx = extractAgentRuntimeContext(requestBody)
      await runToolAgent({
        workspacePath,
        baseUrl:
          resolved.engine === 'claude'
            ? 'https://api.anthropic.com'
            : resolved.engine === 'gemini'
              ? 'gemini-native'
              : resolved.engine === 'grok'
                ? resolved.baseUrl || 'https://api.x.ai/v1'
                : resolved.baseUrl || 'https://api.openai.com/v1',
        model: resolved.model,
        extraHeaders: [],
        messages,
        engine: resolved.engine,
        taskType: 'local',
        sessionId: 0,
        problems: agentCtx.problems,
        anchorPaths: agentCtx.anchors,
        onEvent,
        complete: async (content) => ({
          assistant_message: {
            id: `local-assistant-${Date.now()}`,
            role: 'assistant',
            content
          },
          estimated_usd: 0,
          usage: {
            cursor: { spent: 0, limit: 0, remaining: 0 },
            openai: { spent: 0, limit: 0, remaining: 0 },
            gemini: { spent: 0, limit: 0, remaining: 0 },
            claude: { spent: 0, limit: 0, remaining: 0 },
            workers: { spent: 0, limit: 0, remaining: 0 }
          }
        })
      })
      return true
    }

    const messages = await applyVisionToMessages(
      buildMessages(requestBody),
      requestBody,
      resolved.engine
    )
    const content = await generateAssistantText({
      engine: resolved.engine,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      messages
    })
    if (!content.trim()) {
      throw new Error('LLM から空の応答が返りました')
    }

    onEvent({ type: 'delta', text: content })
    onEvent({
      type: 'done',
      model: resolved.model,
      engine: resolved.engine,
      task_type: 'local',
      assistant_message: {
        id: `local-assistant-${Date.now()}`,
        role: 'assistant',
        content
      }
    })
    return true
  } catch (error) {
    onEvent({
      type: 'error',
      code: 'LOCAL_LLM_FAILED',
      message: error instanceof Error ? error.message : 'ローカル LLM に失敗しました'
    })
    return true
  }
}
