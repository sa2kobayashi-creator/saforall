import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { MessageContent } from './MessageContent'
import { isShellLanguage, parseMessageParts } from '../lib/codeBlocks'
import { languageFromPath } from '../lib/language'
import { DEFAULT_COST_LIMITS, USAGE_ENGINE_KEYS, DEFAULT_ENABLED_MODELS, optionsForEngine, parseModelList, type ProviderEngine } from '../lib/llmModels'
import type {
  AiEngine,
  ApplyCodeOptions,
  ChatMessage,
  ChatMessageRecord,
  ChatMode,
  ChatSessionRecord,
  EditorSelection,
  OpenFile
} from '../types'
import type { ProblemItem } from './ProblemsPanel'
import './ChatPanel.css'

type Props = {
  file: OpenFile | null
  openFiles: OpenFile[]
  selection: EditorSelection | null
  problems?: ProblemItem[]
  backendConnected: boolean
  workspaceId: number | null
  workspacePath: string | null
  width: number
  onApplyCode: (
    code: string,
    pathHint?: string,
    language?: string,
    options?: ApplyCodeOptions
  ) => void | Promise<void>
}

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    '仕事に合った AI へ自動で切り替えます。Ask は適用前に確認、Agent は応答後に自動適用します。'
}

function toChatMessage(row: ChatMessageRecord): ChatMessage {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content
  }
}

function loadMode(): ChatMode {
  const saved = window.localStorage.getItem('saforall-chat-mode')
  return saved === 'agent' ? 'agent' : 'ask'
}

function loadEngine(): AiEngine {
  const saved = window.localStorage.getItem('saforall-ai-engine')
  if (
    saved === 'cursor' ||
    saved === 'openai' ||
    saved === 'gemini' ||
    saved === 'workers' ||
    saved === 'auto'
  ) {
    return saved
  }
  return 'auto'
}

function lastSessionStorageKey(workspaceId: number | null): string {
  return `saforall-last-session:${workspaceId ?? 'global'}`
}

function readLastSessionId(workspaceId: number | null): number | null {
  const raw = window.localStorage.getItem(lastSessionStorageKey(workspaceId))
  if (!raw) return null
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

function writeLastSessionId(workspaceId: number | null, id: number | null): void {
  const key = lastSessionStorageKey(workspaceId)
  if (id === null) {
    window.localStorage.removeItem(key)
    return
  }
  window.localStorage.setItem(key, String(id))
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

export function ChatPanel({
  file,
  openFiles,
  selection,
  problems = [],
  backendConnected,
  workspaceId,
  workspacePath,
  width,
  onApplyCode
}: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<{
    phase: 'thinking' | 'streaming' | 'applying'
    detail?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode>(loadMode)
  const [engine, setEngine] = useState<AiEngine>(loadEngine)
  const [modelChoice, setModelChoice] = useState('auto-within-engine')
  const [enabledByEngine, setEnabledByEngine] = useState<Record<ProviderEngine, string[]>>({
    ...DEFAULT_ENABLED_MODELS
  })
  const [routeLabel, setRouteLabel] = useState<string | null>(null)
  const [usageText, setUsageText] = useState<string | null>(null)
  const [autoAppliedIds, setAutoAppliedIds] = useState<Record<string, boolean>>({})
  const [attachedPaths, setAttachedPaths] = useState<string[]>([])
  const [pendingAction, setPendingAction] = useState<{
    code: string
    pathHint?: string
    language?: string
    kind: 'run'
  } | null>(null)
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  const modeRef = useRef(mode)
  modeRef.current = mode
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const prevChatWidthRef = useRef(width)

  // 幅を狭めたタイミングだけ履歴を自動で畳む
  useEffect(() => {
    if (width < 340 && prevChatWidthRef.current >= 340) {
      setHistoryOpen(false)
    }
    prevChatWidthRef.current = width
  }, [width])

  const activeSession = useMemo(
    () => sessions.find((row) => Number(row.id) === sessionId) ?? null,
    [sessions, sessionId]
  )

  useEffect(() => {
    if (!backendConnected) return

    let cancelled = false
    ;(async () => {
      const [usageResult, settingsResult] = await Promise.all([
        window.saforall.request<{
          month: string
          usage: Record<string, { spent: number; limit: number; remaining: number }>
        }>('GET', '/ai/usage'),
        window.saforall.request<{ settings: Record<string, string | boolean> }>(
          'GET',
          '/settings'
        )
      ])
      if (cancelled) return

      if (usageResult.ok && usageResult.data?.usage) {
        const parts = USAGE_ENGINE_KEYS.map((key) => {
          const row = usageResult.data!.usage[key]
          const spent = row?.spent ?? 0
          const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
          return `${key} $${spent.toFixed(2)}/$${limit}`
        })
        setUsageText(parts.join(' · '))
      }

      if (settingsResult.ok && settingsResult.data?.settings) {
        const settings = settingsResult.data.settings
        setEnabledByEngine({
          openai: parseModelList(settings['llm.openai.models'], DEFAULT_ENABLED_MODELS.openai),
          gemini: parseModelList(settings['llm.gemini.models'], DEFAULT_ENABLED_MODELS.gemini),
          workers: parseModelList(
            settings['llm.workers.models'] ?? settings['llm.simple.models'],
            DEFAULT_ENABLED_MODELS.workers
          ),
          cursor: parseModelList(settings['llm.cursor.models'], DEFAULT_ENABLED_MODELS.cursor)
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [backendConnected])

  const changeEngine = (next: AiEngine) => {
    setEngine(next)
    window.localStorage.setItem('saforall-ai-engine', next)
    setModelChoice('auto-within-engine')
  }

  const contextLabel = useMemo(() => {
    const bits: string[] = []
    if (selection?.text) {
      const name = selection.path.split(/[/\\]/).pop() ?? selection.path
      bits.push(
        `選択 ${name}:${selection.startLine}${selection.endLine !== selection.startLine ? `-${selection.endLine}` : ''}`
      )
    } else if (file) {
      bits.push(file.path.split(/[/\\]/).pop() ?? file.path)
    }
    if (attachedPaths.length > 0) {
      bits.push(`+${attachedPaths.length} ファイル`)
    }
    return bits.length > 0 ? bits.join(' · ') : 'コンテキストなし'
  }, [file, selection, attachedPaths])

  const toggleAttached = useCallback((path: string) => {
    setAttachedPaths((current) =>
      current.includes(path) ? current.filter((row) => row !== path) : [...current, path]
    )
  }, [])

  const buildContextPayload = useCallback(async () => {
    const mentioned = new Set<string>()
    const atMatches = input.match(/@([^\s@]+)/g) ?? []
    for (const token of atMatches) {
      const needle = token.slice(1).toLowerCase()
      for (const open of openFiles) {
        const base = (open.path.split(/[/\\]/).pop() ?? open.path).toLowerCase()
        if (base === needle || open.path.toLowerCase().endsWith(needle)) {
          mentioned.add(open.path)
        }
      }
      if (workspacePath && typeof window.saforall.searchFiles === 'function') {
        try {
          const found = await window.saforall.searchFiles(workspacePath, needle)
          for (const rel of found.slice(0, 3)) {
            const abs = rel.includes(':') || rel.startsWith('/') || rel.startsWith('\\')
              ? rel
              : `${workspacePath.replace(/[\\/]+$/, '')}${workspacePath.includes('\\') ? '\\' : '/'}${rel.replace(/^[\\/]+/, '')}`
            mentioned.add(abs)
          }
        } catch {
          // ignore search failures
        }
      }
    }

    const filePaths = new Set<string>([...attachedPaths, ...Array.from(mentioned)])
    if (file?.path) filePaths.delete(file.path)

    const files: Array<{ path: string; content: string; language?: string }> = []
    for (const open of openFiles) {
      if (!filePaths.has(open.path)) continue
      files.push({
        path: open.path,
        content: open.content,
        language: open.language
      })
      filePaths.delete(open.path)
    }
    for (const path of Array.from(filePaths)) {
      try {
        const content = await window.saforall.readFile(path)
        files.push({
          path,
          content,
          language: languageFromPath(path)
        })
      } catch {
        // skip unreadable
      }
    }

    const selectionPayload =
      selection && selection.text.trim() !== ''
        ? {
            path: selection.path,
            text: selection.text,
            start_line: selection.startLine,
            end_line: selection.endLine
          }
        : null

    let rules: string | null = null
    if (workspacePath && typeof window.saforall.loadProjectRules === 'function') {
      try {
        rules = await window.saforall.loadProjectRules(workspacePath)
      } catch {
        rules = null
      }
    }

    const problemLines = problems.slice(0, 20).map((row) => {
      const loc = row.path ? row.path : 'unknown'
      return `${row.severity}: ${loc} ${row.message}`
    })

    if (!file && files.length === 0 && !selectionPayload && !rules && problemLines.length === 0) {
      return null
    }

    return {
      path: file?.path ?? null,
      content: file?.content ?? null,
      language: file?.language ?? null,
      selection: selectionPayload,
      files,
      rules,
      problems: problemLines
    }
  }, [attachedPaths, file, input, openFiles, problems, selection, workspacePath])

  const changeMode = (next: ChatMode) => {
    setMode(next)
    window.localStorage.setItem('saforall-chat-mode', next)
  }

  const runAgentActions = useCallback(
    async (messageId: string, content: string) => {
      if (modeRef.current !== 'agent') return

      const parts = parseMessageParts(content).filter((part) => part.type === 'code')
      if (parts.length === 0) return

      setBusy({
        phase: 'applying',
        detail: `変更候補を準備（0/${parts.length}）`
      })

      let count = 0
      for (const part of parts) {
        count += 1
        const label = isShellLanguage(part.language)
          ? `コマンド実行中（${count}/${parts.length}）`
          : part.pathHint
            ? `候補追加（${count}/${parts.length}）: ${part.pathHint}`
            : `候補追加（${count}/${parts.length}）`
        setBusy({ phase: 'applying', detail: label })
        if (isShellLanguage(part.language)) {
          await onApplyCode(part.code, part.pathHint, part.language, { auto: true })
        } else {
          await onApplyCode(part.code, part.pathHint, part.language, {
            auto: true,
            review: true
          })
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200))
      }

      setAutoAppliedIds((current) => ({ ...current, [messageId]: true }))
      setBusy({
        phase: 'applying',
        detail: `変更候補をキューに追加（${parts.length}件）。差分を確認して適用してください。`
      })
    },
    [onApplyCode]
  )

  const requestApply = useCallback(
    (code: string, pathHint?: string, language?: string) => {
      if (isShellLanguage(language)) {
        if (modeRef.current === 'agent') {
          void onApplyCode(code, pathHint, language, { auto: true })
          return
        }
        setPendingAction({
          code,
          pathHint,
          language,
          kind: 'run'
        })
        return
      }

      // コード適用は差分ダイアログで確認（Ask / 手動適用）
      if (modeRef.current === 'agent') {
        void onApplyCode(code, pathHint, language, { auto: true, review: true })
        return
      }
      void onApplyCode(code, pathHint, language)
    },
    [onApplyCode]
  )

  const sessionsQuery = useCallback(() => {
    return workspaceId
      ? `/chat/sessions?workspace_id=${workspaceId}&limit=40`
      : '/chat/sessions?limit=40'
  }, [workspaceId])

  const refreshSessions = useCallback(async (): Promise<ChatSessionRecord[]> => {
    if (!backendConnected) {
      setSessions([])
      return []
    }
    const list = await window.saforall.request<{ sessions: ChatSessionRecord[] }>(
      'GET',
      sessionsQuery()
    )
    if (!list.ok || !list.data?.sessions) {
      return []
    }
    setSessions(list.data.sessions)
    return list.data.sessions
  }, [backendConnected, sessionsQuery])

  const loadMessagesForSession = useCallback(async (id: number) => {
    const history = await window.saforall.request<{ messages: ChatMessageRecord[] }>(
      'GET',
      `/chat/sessions/${id}/messages`
    )
    if (history.ok && history.data?.messages && history.data.messages.length > 0) {
      setMessages(history.data.messages.map(toChatMessage))
    } else {
      setMessages([welcomeMessage])
    }
    setAutoAppliedIds({})
  }, [])

  const selectSession = useCallback(
    async (id: number) => {
      if (busy) return
      setLoading(true)
      setError(null)
      try {
        setSessionId(id)
        writeLastSessionId(workspaceId, id)
        await loadMessagesForSession(id)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    },
    [busy, loadMessagesForSession, workspaceId]
  )

  const createSession = useCallback(async (): Promise<number | null> => {
    const created = await window.saforall.request<{ session: ChatSessionRecord }>(
      'POST',
      '/chat/sessions',
      {
        title: 'New chat',
        workspace_id: workspaceId
      }
    )
    if (!created.ok || !created.data?.session) {
      setError(created.error?.message ?? 'セッション作成に失敗しました')
      return null
    }
    const id = Number(created.data.session.id)
    setSessions((current) => [created.data!.session, ...current.filter((row) => Number(row.id) !== id)])
    return id
  }, [workspaceId])

  const startNewChat = useCallback(async () => {
    if (!backendConnected || busy) return
    setLoading(true)
    setError(null)
    try {
      const id = await createSession()
      if (id === null) return
      setSessionId(id)
      writeLastSessionId(workspaceId, id)
      setMessages([welcomeMessage])
      setAutoAppliedIds({})
      setInput('')
    } finally {
      setLoading(false)
    }
  }, [backendConnected, busy, createSession, workspaceId])

  const deleteSession = useCallback(
    async (id: number) => {
      if (!backendConnected || busy) return
      setPendingDeleteId(null)
      setLoading(true)
      setError(null)
      try {
        const result = await window.saforall.request('DELETE', `/chat/sessions/${id}`)
        if (!result.ok) {
          setError(result.error?.message ?? 'チャットの削除に失敗しました')
          return
        }

        const remaining = sessions.filter((row) => Number(row.id) !== id)
        setSessions(remaining)

        if (sessionIdRef.current === id) {
          if (remaining[0]) {
            const nextId = Number(remaining[0].id)
            setSessionId(nextId)
            writeLastSessionId(workspaceId, nextId)
            await loadMessagesForSession(nextId)
          } else {
            const createdId = await createSession()
            if (createdId === null) {
              setSessionId(null)
              writeLastSessionId(workspaceId, null)
              setMessages([welcomeMessage])
              return
            }
            setSessionId(createdId)
            writeLastSessionId(workspaceId, createdId)
            setMessages([welcomeMessage])
            setAutoAppliedIds({})
          }
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    },
    [backendConnected, busy, createSession, loadMessagesForSession, sessions, workspaceId]
  )

  const ensureSession = useCallback(async (): Promise<number | null> => {
    if (!backendConnected) return null
    if (sessionId !== null) return sessionId

    const id = await createSession()
    if (id === null) return null
    setSessionId(id)
    writeLastSessionId(workspaceId, id)
    return id
  }, [backendConnected, createSession, sessionId, workspaceId])

  useEffect(() => {
    if (!backendConnected) {
      setSessionId(null)
      setSessions([])
      setMessages([welcomeMessage])
      setError(null)
      return
    }

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await window.saforall.request<{ sessions: ChatSessionRecord[] }>(
          'GET',
          sessionsQuery()
        )
        if (cancelled) return

        let rows = list.ok && list.data?.sessions ? list.data.sessions : []
        setSessions(rows)

        const remembered = readLastSessionId(workspaceId)
        let activeSessionId =
          remembered !== null && rows.some((row) => Number(row.id) === remembered)
            ? remembered
            : rows[0]
              ? Number(rows[0].id)
              : null

        if (activeSessionId === null) {
          const created = await window.saforall.request<{ session: ChatSessionRecord }>(
            'POST',
            '/chat/sessions',
            {
              title: 'New chat',
              workspace_id: workspaceId
            }
          )
          if (cancelled) return
          if (created.ok && created.data?.session) {
            activeSessionId = Number(created.data.session.id)
            rows = [created.data.session]
            setSessions(rows)
          }
        }

        if (activeSessionId === null) {
          setError('セッションを準備できませんでした')
          return
        }

        setSessionId(activeSessionId)
        writeLastSessionId(workspaceId, activeSessionId)
        await loadMessagesForSession(activeSessionId)
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [backendConnected, loadMessagesForSession, sessionsQuery, workspaceId])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy || loading) return

    setBusy({ phase: 'thinking', detail: 'AI に問い合わせ中…' })
    setError(null)
    setInput('')

    const localUser: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text
    }
    setMessages((prev) => [...prev.filter((m) => m.id !== 'welcome'), localUser])

    try {
      if (!backendConnected) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `（オフライン）「${text}」を受け取りました。XAMPP を起動し、設定で API キーを保存してください。`
          }
        ])
        return
      }

      const id = await ensureSession()
      if (id === null) return

      const payload = {
        session_id: id,
        message: text,
        engine,
        mode,
        model:
          engine === 'auto' || modelChoice === 'auto-within-engine'
            ? undefined
            : modelChoice,
        workspace_path: workspacePath,
        context: await buildContextPayload()
      }

      if (typeof window.saforall.chatStream !== 'function') {
        const result = await window.saforall.request<{
          user_message: ChatMessageRecord
          assistant_message: ChatMessageRecord
        }>('POST', '/ai/chat', payload, { timeoutMs: 120_000 })

        if (!result.ok || !result.data) {
          const message = result.error?.message ?? 'AI 応答に失敗しました'
          setError(message)
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `エラー: ${message}`
            }
          ])
          return
        }

        const assistant = toChatMessage(result.data.assistant_message)
        setMessages((prev) => {
          const withoutLocalUser = prev.filter((message) => message.id !== localUser.id)
          return [
            ...withoutLocalUser,
            toChatMessage(result.data!.user_message),
            assistant
          ]
        })
        if (engine !== 'cursor') {
          await runAgentActions(assistant.id, assistant.content)
        }
        void refreshSessions()
        return
      }

      const streamAssistantId = `stream-${crypto.randomUUID()}`
      let sawAssistant = false
      let finalAssistantId: string | null = null
      let finalAssistantContent: string | null = null
      let usedEngine: string = engine
      let usedTools = false

      await window.saforall.chatStream(payload, {
        onEvent: (event) => {
          if (event.type === 'user_message') {
            setBusy({ phase: 'thinking', detail: '応答生成を待機中…' })
            const savedUser = toChatMessage(event.message as unknown as ChatMessageRecord)
            setMessages((prev) =>
              prev.map((message) =>
                message.id === localUser.id ? savedUser : message
              )
            )
            return
          }

          if (event.type === 'route') {
            usedEngine = event.engine
            const reason = event.fallback_reason ? `（${event.fallback_reason}）` : ''
            const profile = event.policy_profile ? ` · ${event.policy_profile}` : ''
            const modeTag = event.mode ? ` · ${event.mode}` : ''
            setRouteLabel(
              `${event.engine} · ${event.model} / ${event.task_type}${modeTag}${profile}${reason}`
            )
            if (event.usage) {
              const parts = USAGE_ENGINE_KEYS.map((key) => {
                const row = event.usage?.[key]
                const spent = row?.spent ?? 0
                const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
                return `${key} $${spent.toFixed(2)}/$${limit}`
              })
              setUsageText(parts.join(' · '))
            }
            setBusy({
              phase: 'thinking',
              detail: `${event.engine} · ${event.model} で応答中…`
            })
            return
          }

          if (event.type === 'tool_call') {
            setBusy({ phase: 'thinking', detail: `ツール実行: ${event.name}` })
            const line = `\n\n🔧 \`${event.name}\` …`
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                { id: streamAssistantId, role: 'assistant', content: line.trim() }
              ])
            } else {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: message.content + line }
                    : message
                )
              )
            }
            return
          }

          if (event.type === 'tool_result') {
            setBusy({
              phase: 'thinking',
              detail: event.ok ? `完了: ${event.summary}` : `失敗: ${event.summary}`
            })
            const line = event.ok ? ` ✓ ${event.summary}` : ` ✗ ${event.summary}`
            setMessages((prev) =>
              prev.map((message) =>
                message.id === streamAssistantId
                  ? { ...message, content: message.content + line }
                  : message
              )
            )
            return
          }

          if (event.type === 'edit_proposal') {
            setBusy({ phase: 'applying', detail: `変更候補: ${event.path}` })
            void onApplyCode(event.content, event.path, languageFromPath(event.path), {
              auto: true,
              review: true
            })
            return
          }

          if (event.type === 'delta') {
            if (!event.text) return
            setBusy({ phase: 'streaming', detail: '応答を受信中…' })
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                {
                  id: streamAssistantId,
                  role: 'assistant',
                  content: event.text
                }
              ])
              return
            }

            setMessages((prev) =>
              prev.map((message) =>
                message.id === streamAssistantId
                  ? { ...message, content: message.content + event.text }
                  : message
              )
            )
            return
          }

          if (event.type === 'done') {
            if (event.engine) {
              usedEngine = event.engine
            }
            if (event.used_tools) {
              usedTools = true
            }
            if (event.usage) {
              const parts = USAGE_ENGINE_KEYS.map((key) => {
                const row = event.usage?.[key]
                const spent = row?.spent ?? 0
                const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
                return `${key} $${spent.toFixed(2)}/$${limit}`
              })
              setUsageText(parts.join(' · '))
            }
            const savedAssistant = toChatMessage(
              event.assistant_message as unknown as ChatMessageRecord
            )
            finalAssistantId = savedAssistant.id
            finalAssistantContent = savedAssistant.content
            setMessages((prev) =>
              prev.map((message) =>
                message.id === streamAssistantId ? savedAssistant : message
              )
            )
            return
          }

          if (event.type === 'error') {
            setError(event.message)
            setMessages((prev) => {
              const withoutStream = prev.filter(
                (message) => message.id !== streamAssistantId
              )
              return [
                ...withoutStream,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: `エラー: ${event.message}`
                }
              ]
            })
          }
        }
      })

      if (finalAssistantId && finalAssistantContent && usedEngine !== 'cursor' && !usedTools) {
        await runAgentActions(finalAssistantId, finalAssistantContent)
      }
      void refreshSessions()
    } finally {
      setBusy(null)
    }
  }

  const busyLabel =
    busy?.detail ??
    (busy?.phase === 'applying'
      ? 'コード適用・コマンド実行中…'
      : busy?.phase === 'streaming'
        ? '応答を受信中…'
        : busy
          ? 'AI 応答待ち…'
          : null)

  return (
    <aside className="chat-panel" aria-label="AI チャット" style={{ width }}>
      <div className="chat-layout">
        <div className="chat-main">
          <div className="chat-header">
            <div className="chat-header-left">
              <button
                type="button"
                className={`chat-history-toggle${historyOpen ? ' is-active' : ''}`}
                onClick={() => setHistoryOpen((open) => !open)}
                title={historyOpen ? '履歴を隠す' : '履歴を表示'}
              >
                履歴
              </button>
              <div>
                <strong>{activeSession?.title || 'AI'}</strong>
                <span className="chat-context">{contextLabel}</span>
              </div>
              <button
                type="button"
                className="chat-new-btn"
                disabled={!backendConnected || busy !== null || loading}
                onClick={() => void startNewChat()}
                title="新しいチャット"
              >
                新規
              </button>
            </div>
            <div className="chat-header-right">
              <fieldset className="engine-picker">
                <legend>AI</legend>
                {(
                  [
                    ['auto', '自動（おすすめ）'],
                    ['cursor', 'Cursor'],
                    ['openai', 'OpenAI'],
                    ['gemini', 'Gemini'],
                    ['workers', 'Workers AI']
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="saforall-engine"
                      checked={engine === value}
                      onChange={() => changeEngine(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {engine !== 'auto' && (
                <label className="model-select">
                  <span className="sr-only">Model</span>
                  <select
                    value={modelChoice}
                    disabled={!backendConnected}
                    title="このエンジン内のモデル"
                    onChange={(event) => setModelChoice(event.target.value)}
                  >
                    <option value="auto-within-engine">モデル自動（安い/作業向け）</option>
                    {enabledByEngine[engine].map((id) => {
                      const meta = optionsForEngine(engine, enabledByEngine[engine]).find(
                        (row) => row.id === id
                      )
                      return (
                        <option key={id} value={id}>
                          {meta?.label ?? id}
                        </option>
                      )
                    })}
                  </select>
                </label>
              )}
              <div className="mode-switch" role="group" aria-label="チャットモード">
                <button
                  type="button"
                  className={mode === 'ask' ? 'active' : ''}
                  onClick={() => changeMode('ask')}
                  title="適用・実行の前に確認します"
                >
                  Ask
                </button>
                <button
                  type="button"
                  className={mode === 'agent' ? 'active' : ''}
                  onClick={() => changeMode('agent')}
                  title="応答後にコード適用とコマンド実行を自動で行います"
                >
                  Agent
                </button>
              </div>
              <span className={`chat-backend ${backendConnected ? 'ok' : 'ng'}`}>
                {backendConnected ? 'API 接続済み' : 'API 未接続'}
              </span>
            </div>
          </div>

          <div className={`mode-banner ${mode}`}>
            {engine === 'auto'
              ? '自動: 設定の「Auto パイプライン」で有効にした AI だけを作業に合わせて切替'
              : engine === 'cursor'
                ? 'Cursor 固定: 下のリストからモデル選択、またはエンジン内自動'
                : engine === 'gemini'
                  ? 'Gemini 固定: モデルはリスト選択 / 自動可'
                  : engine === 'workers'
                    ? 'Workers AI 固定: 簡単な作業向けモデルをリスト選択'
                    : 'OpenAI 固定: モデルはリスト選択 / 自動可'}
            {routeLabel ? ` · 今回: ${routeLabel}` : ''}
            {mode === 'ask' ? ' · Ask（差分確認）' : ' · Agent（複数変更をレビュー）'}
          </div>
          {usageText && <div className="usage-bar">今月 {usageText}</div>}

          {error && <div className="chat-error">{error}</div>}

          <div className="chat-messages">
            {messages.map((message) => (
              <div key={message.id} className={`chat-bubble ${message.role}`}>
                <div className="chat-role">{message.role === 'user' ? 'You' : 'AI'}</div>
                {message.role === 'assistant' ? (
                  <MessageContent
                    content={message.content}
                    showApply={message.id !== 'welcome'}
                    mode={mode}
                    autoApplied={autoAppliedIds[message.id] === true}
                    onApplyCode={requestApply}
                  />
                ) : (
                  <div className="chat-content">{message.content}</div>
                )}
              </div>
            ))}
            {busy && busy.phase !== 'streaming' && (
              <div className="chat-bubble assistant busy">
                <div className="chat-role">AI</div>
                <div className="chat-content chat-busy-inline">
                  <span className="chat-busy-spinner" aria-hidden />
                  {busyLabel}
                </div>
              </div>
            )}
          </div>

          {busy && (
            <div
              className={`chat-busy-bar phase-${busy.phase}`}
              role="status"
              aria-live="polite"
            >
              <span className="chat-busy-spinner" aria-hidden />
              <span>{busyLabel}</span>
            </div>
          )}

          <div className="chat-context-bar">
            {selection?.text ? (
              <span className="chat-context-chip is-selection" title={selection.path}>
                選択 L{selection.startLine}
                {selection.endLine !== selection.startLine ? `-${selection.endLine}` : ''}
              </span>
            ) : null}
            {openFiles.map((open) => {
              const name = open.path.split(/[/\\]/).pop() ?? open.path
              const active = open.path === file?.path
              const attached = attachedPaths.includes(open.path)
              return (
                <button
                  key={open.path}
                  type="button"
                  className={`chat-context-chip${active ? ' is-active' : ''}${attached ? ' is-attached' : ''}`}
                  title={
                    active
                      ? 'アクティブファイル（常に送信）'
                      : attached
                        ? 'コンテキストから外す'
                        : '@ で追加（クリック）'
                  }
                  disabled={active}
                  onClick={() => toggleAttached(open.path)}
                >
                  {active ? '● ' : attached ? '@ ' : '+ '}
                  {name}
                </button>
              )
            })}
            {openFiles.length === 0 && (
              <span className="chat-context-hint">開いているファイルを @ で追加できます</span>
            )}
          </div>

          <form className="chat-input" onSubmit={(event) => void onSubmit(event)}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                busy
                  ? busyLabel ?? '実行中…'
                  : loading
                    ? '履歴読み込み中…'
                    : mode === 'agent'
                      ? 'Agent に依頼する…（例: @App.tsx を直して）'
                      : 'コードについて質問する…（選択範囲や @ファイル名 も使えます）'
              }
              rows={3}
              disabled={busy !== null || loading}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button type="submit" disabled={busy !== null || loading || input.trim() === ''}>
              {busy ? '実行中…' : '送信'}
            </button>
          </form>
        </div>

        <div className={`chat-history${historyOpen ? ' is-open' : ''}`} aria-label="チャット履歴">
          <div className="chat-history-head">
            <strong>履歴</strong>
            <button
              type="button"
              className="chat-history-new"
              disabled={!backendConnected || busy !== null || loading}
              onClick={() => void startNewChat()}
              title="新しいチャット"
            >
              ＋ 新規
            </button>
          </div>
          <div className="chat-history-list">
            {sessions.length === 0 ? (
              <p className="chat-history-empty">まだ履歴がありません</p>
            ) : (
              sessions.map((row) => {
                const id = Number(row.id)
                const active = id === sessionId
                return (
                  <div
                    key={id}
                    className={`chat-history-item${active ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="chat-history-open"
                      disabled={busy !== null || loading}
                      onClick={() => void selectSession(id)}
                      title={row.title}
                    >
                      <span className="chat-history-title">{row.title || 'New chat'}</span>
                      <span className="chat-history-time">
                        {formatSessionTime(row.updated_at || row.created_at)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-history-delete"
                      disabled={busy !== null || loading}
                      title="削除"
                      onClick={() => setPendingDeleteId(id)}
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title="コマンドを実行しますか？"
        message={
          pendingAction
            ? `次のコマンドをターミナルで実行します。\n\n${pendingAction.code}`
            : ''
        }
        confirmLabel="実行する"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return
          const action = pendingAction
          setPendingAction(null)
          void onApplyCode(action.code, action.pathHint, action.language)
        }}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="チャットを削除しますか？"
        message="このチャットの履歴は削除され、元に戻せません。"
        confirmLabel="削除する"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId === null) return
          void deleteSession(pendingDeleteId)
        }}
      />
    </aside>
  )
}
