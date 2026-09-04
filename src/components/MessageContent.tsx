import { isShellLanguage, parseMessageParts } from '../lib/codeBlocks'
import type { ChatMode } from '../types'
import './MessageContent.css'

type Props = {
  content: string
  showApply: boolean
  mode: ChatMode
  autoApplied?: boolean
  onApplyCode: (code: string, pathHint?: string, language?: string) => void
}

export function MessageContent({
  content,
  showApply,
  mode,
  autoApplied = false,
  onApplyCode
}: Props) {
  const parts = parseMessageParts(content)

  return (
    <div className="message-content">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          if (part.text.trim() === '') return null
          return (
            <div key={`text-${index}`} className="message-text">
              {part.text}
            </div>
          )
        }

        const shell = isShellLanguage(part.language)
        const actionLabel = shell ? '実行' : '適用'
        const actionTitle = shell
          ? mode === 'agent'
            ? '安全なコマンドのみ自動実行'
            : '確認してからターミナルで実行'
          : mode === 'agent'
            ? part.pathHint
              ? `${part.pathHint} を差分レビューへ`
              : '差分レビューへ追加'
            : part.pathHint
              ? `${part.pathHint} の差分を確認して適用`
              : '差分を確認してファイルに適用'

        return (
          <div key={`code-${index}`} className="code-block">
            <div className="code-block-header">
              <span className="code-block-meta">
                {part.language}
                {part.pathHint ? ` · ${part.pathHint}` : ''}
                {shell ? ' · コマンド' : ''}
                {autoApplied ? ' · レビュー候補追加済み' : ''}
              </span>
              {showApply && (
                <button
                  type="button"
                  className={`apply-btn ${shell ? 'run' : ''}`}
                  onClick={() => onApplyCode(part.code, part.pathHint, part.language)}
                  title={actionTitle}
                >
                  {mode === 'ask' ? `${actionLabel}…` : actionLabel}
                </button>
              )}
            </div>
            <pre className="code-block-body">
              <code>{part.code}</code>
            </pre>
          </div>
        )
      })}
    </div>
  )
}
