import { useEffect, useState, type FormEvent } from 'react'
import './ApplyPathDialog.css'

type Props = {
  open: boolean
  defaultPath: string
  onCancel: () => void
  onConfirm: (relativePath: string) => void
}

export function ApplyPathDialog({ open, defaultPath, onCancel, onConfirm }: Props) {
  const [path, setPath] = useState(defaultPath)

  useEffect(() => {
    if (open) setPath(defaultPath)
  }, [open, defaultPath])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = path.trim()
    if (!next) return
    onConfirm(next)
  }

  return (
    <div className="apply-path-overlay" role="dialog" aria-label="適用先の指定">
      <form className="apply-path-dialog" onSubmit={submit}>
        <h2>ファイルに適用</h2>
        <p>ワークスペースからの相対パスを指定してください。</p>
        <input
          autoFocus
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="index.js"
        />
        <div className="apply-path-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={path.trim() === ''}>
            保存して適用
          </button>
        </div>
      </form>
    </div>
  )
}
