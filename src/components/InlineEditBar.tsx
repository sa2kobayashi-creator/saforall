import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import './InlineEditBar.css'

export type InlineEditTarget = {
  path: string
  language: string
  selection: string
  prefix: string
  suffix: string
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
}

type Props = {
  target: InlineEditTarget | null
  onClose: () => void
  onApplied: (edited: string) => void
}

export function InlineEditBar({ target, onClose, onApplied }: Props) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setInstruction('')
    setError(null)
    setBusy(false)
    if (target) {
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [target])

  if (!target) return null

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = instruction.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.saforall.request<{ edited: string }>(
        'POST',
        '/ai/edit',
        {
          instruction: text,
          selection: target.selection,
          prefix: target.prefix,
          suffix: target.suffix,
          language: target.language,
          path: target.path
        },
        { timeoutMs: 45_000 }
      )
      if (!result.ok || !result.data?.edited) {
        setError(result.error?.message ?? '編集に失敗しました')
        setBusy(false)
        return
      }
      onApplied(result.data.edited.replace(/\r\n/g, '\n'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="inline-edit-bar" role="dialog" aria-label="インライン編集">
      <form className="inline-edit-form" onSubmit={(event) => void submit(event)}>
        <span className="inline-edit-label">
          Ctrl+K · L{target.startLine}
          {target.endLine !== target.startLine ? `-${target.endLine}` : ''}
        </span>
        <input
          ref={inputRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="選択範囲への指示（例: エラーハンドリングを追加）"
          disabled={busy}
        />
        <button type="submit" disabled={busy || instruction.trim() === ''}>
          {busy ? '生成中…' : '適用'}
        </button>
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>
          Esc
        </button>
      </form>
      {error && <p className="inline-edit-error">{error}</p>}
    </div>
  )
}
