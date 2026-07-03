import { useMemo, useState, type FormEvent } from 'react'
import type { ChatMessage, OpenFile } from '../types'
import './ChatPanel.css'

type Props = {
  file: OpenFile | null
}

export function ChatPanel({ file }: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'saforall へようこそ。いまは UI の土台だけです。次のステップで LLM API を接続し、コード編集・説明・修正をここに載せます。'
    }
  ])

  const contextLabel = useMemo(() => {
    if (!file) return 'コンテキストなし'
    return file.path.split(/[/\\]/).pop() ?? file.path
  }, [file])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: file
        ? `（プレースホルダ）「${text}」を受け取りました。現在のファイルは ${contextLabel} です。AI バックエンド接続後にここで回答します。`
        : `（プレースホルダ）「${text}」を受け取りました。ファイルを開くとコンテキスト付きで回答できます。`
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
  }

  return (
    <aside className="chat-panel" aria-label="AI チャット">
      <div className="chat-header">
        <div>
          <strong>AI</strong>
          <span className="chat-context">{contextLabel}</span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`chat-bubble ${message.role}`}>
            <div className="chat-role">{message.role === 'user' ? 'You' : 'AI'}</div>
            <div className="chat-content">{message.content}</div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="コードについて質問する…"
          rows={3}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button type="submit">送信</button>
      </form>
    </aside>
  )
}
