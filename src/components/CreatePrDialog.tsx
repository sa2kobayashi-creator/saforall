import { useState, type FormEvent } from 'react'
import './CreatePrDialog.css'

type Props = {
  open: boolean
  workspacePath: string
  defaultTitle?: string
  onClose: () => void
  onCreated: (info: { url?: string; stdout?: string }) => void
}

export function CreatePrDialog({
  open,
  workspacePath,
  defaultTitle = '',
  onClose,
  onCreated
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      setError('PR タイトルが必要です')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.saforall.createPullRequest({
        cwd: workspacePath,
        title: title.trim(),
        body: body.trim() || undefined,
        base: base.trim() || undefined,
        draft
      })
      if (!result.ok) {
        setError(result.error ?? 'PR 作成に失敗しました')
        return
      }
      onCreated({ url: result.url, stdout: result.stdout })
      setTitle('')
      setBody('')
      setBase('')
      setDraft(false)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="create-pr-overlay" role="dialog" aria-label="Create Pull Request">
      <form className="create-pr-dialog" onSubmit={(event) => void onSubmit(event)}>
        <div className="create-pr-header">
          <h2>Create Pull Request</h2>
          <button type="button" onClick={onClose} disabled={busy}>
            閉じる
          </button>
        </div>
        <p className="create-pr-hint">
          GitHub CLI（gh）で PR を作成します。要: push 済みブランチと <code>gh auth login</code>。
        </p>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例: Fix terminal scrollback"
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Body（任意）
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            placeholder="変更の要約"
            disabled={busy}
          />
        </label>
        <label>
          Base branch（任意）
          <input
            value={base}
            onChange={(event) => setBase(event.target.value)}
            placeholder="空ならリポジトリ既定（main 等）"
            disabled={busy}
          />
        </label>
        <label className="create-pr-draft">
          <input
            type="checkbox"
            checked={draft}
            onChange={(event) => setDraft(event.target.checked)}
            disabled={busy}
          />
          Draft PR
        </label>
        {error && <div className="create-pr-error">{error}</div>}
        <div className="create-pr-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? '作成中…' : 'Create PR'}
          </button>
        </div>
      </form>
    </div>
  )
}
