import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ChatMessage, ChatMessageRecord, ChatSessionRecord, OpenFile } from '../types'
import './ChatPanel.css'

type Props = {
  file: OpenFile | null
  backendConnected: boolean
  workspaceId: number | null
}

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'saforall へようこそ。設定で API キーを保存すると、AI がストリーミングで回答します。会話は MySQL に保存されます。'
}

function toChatMessage(row: ChatMessageRecord): ChatMessage {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content
  }
}

export function ChatPanel({ file, backendConnected, workspaceId }: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contextLabel = useMemo(() => {
    if (!file) return 'コンテキストなし'
    return file.path.split(/[/\\]/).pop() ?? file.path
  }, [file])

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

      const streamAssistantId = `stream-${crypto.randomUUID()}`
      let sawAssistant = false

      await window.saforall.chatStream(
        {
          session_id: id,
          message: text,
          context: file
            ? {
                path: file.path,
                content: file.content,
                language: file.language
              }
            : null
        },
        {
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
        }
      )
    } finally {
      setThinking(false)
    }
  }

  return (
    <aside className="chat-panel" aria-label="AI チャット">
      <div className="chat-header">
        <div>
          <strong>AI</strong>
          <span className="chat-context">{contextLabel}</span>
          {sessionId !== null && (
            <span className="chat-session">session #{sessionId}</span>
          )}
        </div>
        <span className={`chat-backend ${backendConnected ? 'ok' : 'ng'}`}>
          {backendConnected ? 'API 接続済み' : 'API 未接続'}
        </span>
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`chat-bubble ${message.role}`}>
            <div className="chat-role">{message.role === 'user' ? 'You' : 'AI'}</div>
            <div className="chat-content">{message.content}</div>
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
            thinking ? '応答待ち…' : loading ? '履歴読み込み中…' : 'コードについて質問する…'
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
    </aside>
  )
}
