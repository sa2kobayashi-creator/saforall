import { parseMessageParts } from '../lib/codeBlocks'
import './MessageContent.css'

type Props = {
  content: string
  showApply: boolean
  onApplyCode: (code: string, pathHint?: string) => void
}

export function MessageContent({ content, showApply, onApplyCode }: Props) {
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

        return (
          <div key={`code-${index}`} className="code-block">
            <div className="code-block-header">
              <span className="code-block-meta">
                {part.language}
                {part.pathHint ? ` · ${part.pathHint}` : ''}
              </span>
              {showApply && (
                <button
                  type="button"
                  className="apply-btn"
                  onClick={() => onApplyCode(part.code, part.pathHint)}
                  title={
                    part.pathHint
                      ? `${part.pathHint} に適用`
                      : 'アクティブなファイルに適用'
                  }
                >
                  適用
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
