import { useEffect, useState } from 'react'
import {
  DEFAULT_KEYBINDING_COMMANDS,
  loadWorkspaceKeybindings,
  saveWorkspaceKeybindings,
  type KeybindingEntry
} from '../lib/keybindings'
import './KeybindingsEditor.css'

type Props = {
  workspacePath: string | null
  onStatusMessage?: (message: string) => void
}

export function KeybindingsEditor({ workspacePath, onStatusMessage }: Props) {
  const [rows, setRows] = useState<KeybindingEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) {
      setRows([])
      return
    }
    let cancelled = false
    void loadWorkspaceKeybindings(workspacePath).then((entries) => {
      if (!cancelled) setRows(entries.length > 0 ? entries : [{ key: 'ctrl+s', command: 'file.save' }])
    })
    return () => {
      cancelled = true
    }
  }, [workspacePath])

  if (!workspacePath) {
    return <p className="kb-hint">フォルダを開くと `.saforall/keybindings.json` を編集できます</p>
  }

  return (
    <div className="kb-editor">
      <p className="kb-hint">
        ワークスペースのキーバインド（例: ctrl+shift+f → view.search）
      </p>
      {error && <p className="kb-error">{error}</p>}
      <div className="kb-rows">
        {rows.map((row, index) => (
          <div key={`kb-${index}`} className="kb-row">
            <input
              value={row.key}
              placeholder="ctrl+shift+p"
              onChange={(event) => {
                const next = [...rows]
                next[index] = { ...row, key: event.target.value }
                setRows(next)
              }}
            />
            <select
              value={
                DEFAULT_KEYBINDING_COMMANDS.includes(
                  row.command as (typeof DEFAULT_KEYBINDING_COMMANDS)[number]
                )
                  ? row.command
                  : '__custom__'
              }
              onChange={(event) => {
                const value = event.target.value
                const next = [...rows]
                next[index] = {
                  ...row,
                  command: value === '__custom__' ? row.command : value
                }
                setRows(next)
              }}
            >
              {DEFAULT_KEYBINDING_COMMANDS.map((cmd) => (
                <option key={cmd} value={cmd}>
                  {cmd}
                </option>
              ))}
              <option value="__custom__">custom…</option>
            </select>
            {!DEFAULT_KEYBINDING_COMMANDS.includes(
              row.command as (typeof DEFAULT_KEYBINDING_COMMANDS)[number]
            ) && (
              <input
                value={row.command}
                placeholder="custom.command"
                onChange={(event) => {
                  const next = [...rows]
                  next[index] = { ...row, command: event.target.value }
                  setRows(next)
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="kb-actions">
        <button type="button" onClick={() => setRows([...rows, { key: '', command: 'file.save' }])}>
          行を追加
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void saveWorkspaceKeybindings(workspacePath, rows)
              .then((path) => {
                onStatusMessage?.(`キーバインドを保存しました: ${path}`)
              })
              .catch((err) => setError(String(err)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? '保存中…' : 'keybindings.json を保存'}
        </button>
      </div>
    </div>
  )
}
