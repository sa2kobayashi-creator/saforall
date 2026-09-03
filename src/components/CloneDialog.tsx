import { useState, type FormEvent } from 'react'
import './CloneDialog.css'

type Props = {
  open: boolean
  onClose: () => void
  onCloned: (path: string) => void
}

export function CloneDialog({ open, onClose, onCloned }: Props) {
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [folderName, setFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const pickParent = async () => {
    const path = await window.saforall.openDirectory()
    if (path) setParentDir(path)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim() || !parentDir.trim()) {
      setError('URL と保存先フォルダが必要です')
      return
    }

    setBusy(true)
    setError(null)
    const result = await window.saforall.gitClone({
      url: url.trim(),
      parentDir: parentDir.trim(),
      folderName: folderName.trim() || undefined
    })
    setBusy(false)

    if (!result.ok || !result.targetPath) {
      setError(result.error ?? 'clone に失敗しました')
      return
    }

    onCloned(result.targetPath)
    setUrl('')
    setFolderName('')
    onClose()
  }

  return (
    <div className="clone-overlay" role="dialog" aria-label="Clone Repository">
      <form className="clone-dialog" onSubmit={(event) => void onSubmit(event)}>
        <div className="clone-header">
          <h2>Clone Repository</h2>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
        <p className="clone-hint">
          GitHub / Bitbucket などの HTTPS または SSH URL を指定します。認証は git / OS に任せます。
        </p>
        <label>
          Repository URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/org/repo.git"
            autoFocus
          />
        </label>
        <label>
          Parent folder
          <div className="clone-row">
            <input value={parentDir} readOnly placeholder="保存先を選択" />
            <button type="button" onClick={() => void pickParent()}>
              参照…
            </button>
          </div>
        </label>
        <label>
          Folder name（任意）
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="省略時はリポジトリ名"
          />
        </label>
        {error && <p className="clone-error">{error}</p>}
        <div className="clone-actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </form>
    </div>
  )
}
