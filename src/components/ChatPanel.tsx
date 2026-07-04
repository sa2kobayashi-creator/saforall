import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { MessageContent } from './MessageContent'
import { isShellLanguage, parseMessageParts } from '../lib/codeBlocks'
import type {
  ApplyCodeOptions,
  ChatMessage,
  ChatMessageRecord,
  ChatMode,
  ChatSessionRecord,
  OpenFile
} from '../types'
import './ChatPanel.css'

type Props = {
  file: OpenFile | null
  backendConnected: boolean
  workspaceId: number | null
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
    'Ask モードは適用・実行の前に確認します。Agent モードは応答後にコード適用とコマンド実行を自動で行います。'
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

export function ChatPanel({
  file,
  backendConnected,
  workspaceId,
  width,
  onApplyCode
}: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode>(loadMode)
  const [autoAppliedIds, setAutoAppliedIds] = useState<Record<string, boolean>>({})
  const [pendingAction, setPendingAction] = useState<{
    code: string
    pathHint?: string
    language?: string
    kind: 'run' | 'apply'
  } | null>(null)

  const modeRef = useRef(mode)
  modeRef.current = mode

  const contextLabel = useMemo(() => {
    if (!file) return 'コンテキストなし'
    return file.path.split(/[/\\]/).pop() ?? file.path
  }, [file])

  const changeMode = (next: ChatMode) => {
    setMode(next)
    window.localStorage.setItem('saforall-chat-mode', next)
  }

  const runAgentActions = useCallback(
    async (messageId: string, content: string) => {
      if (modeRef.current !== 'agent') return

      const parts = parseMessageParts(content)
      let count = 0
      for (const part of parts) {
        if (part.type !== 'code') continue
        count += 1
        await onApplyCode(part.code, part.pathHint, part.language, { auto: true })
        await new Promise((resolve) => window.setTimeout(resolve, 350))
      }

      if (count > 0) {
        setAutoAppliedIds((current) => ({ ...current, [messageId]: true }))
      }
    },
    [onApplyCode]
  )

  const requestApply = useCallback(
    (code: string, pathHint?: string, language?: string) => {
      if (modeRef.current === 'agent') {
        void onApplyCode(code, pathHint, language, { auto: true })
        return
      }

      setPendingAction({
        code,
        pathHint,
        language,
        kind: isShellLanguage(language) ? 'run' : 'apply'
      })
    },
    [onApplyCode]
  )

  const ensureSession = useCallback(async (): Promise<number | null> => {
    if (!backendConnected) return null
    if (sessionId !== null) return sessionId

    const list = await window.saforall.request<{ sessions: ChatSessionRecord[] }>(
      'GET',
      workspaceId
        ? `/chat/sessions?workspace_id=${workspaceId}&limit=1`
        : '/chat/sessions?limit=1'
    )

    if (list.ok && list.data?.sessions?.[0]) {
      const id = Number(list.data.sessions[0].id)
      setSessionId(id)
      return id
    }

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
    setSessionId(id)
    return id
  }, [backendConnected, sessionId, workspaceId])

  useEffect(() => {
    if (!backendConnected) {
      setSessionId(null)
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
          workspaceId
            ? `/chat/sessions?workspace_id=${workspaceId}&limit=1`
            : '/chat/sessions?limit=1'
        )

        if (cancelled) return

        let activeSessionId: number | null = null
        if (list.ok && list.data?.sessions?.[0]) {
          activeSessionId = Number(list.data.sessions[0].id)
        } else {
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
          }
        }

        if (activeSessionId === null) {
          setError('セッションを準備できませんでした')
          return
        }

        setSessionId(activeSessionId)

        const history = await window.saforall.request<{ messages: ChatMessageRecord[] }>(
          'GET',
          `/chat/sessions/${activeSessionId}/messages`
        )
        if (cancelled) return

        if (history.ok && history.data?.messages && history.data.messages.length > 0) {
          setMessages(history.data.messages.map(toChatMessage))
        } else {
          setMessages([welcomeMessage])
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [backendConnected, workspaceId])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || thinking || loading) return

    setThinking(true)
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
        context: file
          ? {
              path: file.path,
              content: file.content,
              language: file.language
            }
          : null
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
        await runAgentActions(assistant.id, assistant.content)
        return
      }

      const streamAssistantId = `stream-${crypto.randomUUID()}`
      let sawAssistant = false
      let finalAssistantId: string | null = null
      let finalAssistantContent: string | null = null

      await window.saforall.chatStream(payload, {
        onEvent: (event) => {
          if (event.type === 'user_message') {
            setThinking(false)
            const savedUser = toChatMessage(event.message as unknown as ChatMessageRecord)
            setMessages((prev) =>
              prev.map((message) =>
                message.id === localUser.id ? savedUser : message
              )
            )
            return
          }

          if (event.type === 'delta') {
            setThinking(false)
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
            setThinking(false)
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

      if (finalAssistantId && finalAssistantContent) {
        await runAgentActions(finalAssistantId, finalAssistantContent)
      }
    } finally {
      setThinking(false)
    }
  }

  return (
    <aside className="chat-panel" aria-label="AI チャット" style={{ width }}>
      <div className="chat-header">
        <div>
          <strong>AI</strong>
          <span className="chat-context">{contextLabel}</span>
          {sessionId !== null && (
            <span className="chat-session">session #{sessionId}</span>
          )}
        </div>
        <div className="chat-header-right">
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
        {mode === 'ask'
          ? 'Ask: 適用 / 実行のたびに確認します'
          : 'Agent: 応答に含まれるコードとコマンドを自動で適用・実行します'}
      </div>

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
        {thinking && (
          <div className="chat-bubble assistant">
            <div className="chat-role">AI</div>
            <div className="chat-content">考え中…</div>
          </div>
        )}
      </div>

      <form className="chat-input" onSubmit={(event) => void onSubmit(event)}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            thinking
              ? '応答待ち…'
              : loading
                ? '履歴読み込み中…'
                : mode === 'agent'
                  ? 'Agent に依頼する…'
                  : 'コードについて質問する…'
          }
          rows={3}
          disabled={thinking || loading}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button type="submit" disabled={thinking || loading || input.trim() === ''}>
          送信
        </button>
      </form>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.kind === 'run' ? 'コマンドを実行しますか？' : 'コードを適用しますか？'}
        message={
          pendingAction
            ? pendingAction.kind === 'run'
              ? `次のコマンドをターミナルで実行します。\n\n${pendingAction.code}`
              : `次のコードをファイルに適用します。\n${pendingAction.pathHint ? `パス: ${pendingAction.pathHint}\n` : ''}\n${pendingAction.code.slice(0, 400)}${pendingAction.code.length > 400 ? '…' : ''}`
            : ''
        }
        confirmLabel={pendingAction?.kind === 'run' ? '実行する' : '適用する'}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return
          const action = pendingAction
          setPendingAction(null)
          void onApplyCode(action.code, action.pathHint, action.language)
        }}
      />
    </aside>
  )
}
