import { useMemo, useState } from 'react'
import type { ExtensionCommand, ExtensionPermission, WorkspaceExtension } from '../types/extensions'
import {
  hasGrantedPermissions,
  inferRequiredPermissions,
  normalizePermissions,
  permissionsLabel
} from '../lib/extensionPermissions'
import './ExtensionsPanel.css'

type Props = {
  extensions: WorkspaceExtension[]
  activeFilePath: string | null
  grants: Record<string, ExtensionPermission[]>
  onGrant: (extensionId: string, permissions: ExtensionPermission[]) => void
  onRevoke: (extensionId: string) => void
  onRun: (command: string) => void
  onRefresh: () => void
}

export function ExtensionsPanel({
  extensions,
  activeFilePath,
  grants,
  onGrant,
  onRevoke,
  onRun,
  onRefresh
}: Props) {
  const [pending, setPending] = useState<{
    extension: WorkspaceExtension
    command: ExtensionCommand
    required: ExtensionPermission[]
    run: string
  } | null>(null)

  const resolveRun = (command: ExtensionCommand) =>
    command.run.replaceAll(
      '{file}',
      activeFilePath ? `"${activeFilePath.replace(/"/g, '\\"')}"` : '.'
    )

  const requestRun = (extension: WorkspaceExtension, command: ExtensionCommand) => {
    const run = resolveRun(command)
    const declared = normalizePermissions(
      command.permissions ?? extension.permissions ?? ['terminal.run']
    )
    const inferred = inferRequiredPermissions(run)
    const required = Array.from(new Set([...declared, ...inferred]))
    if (hasGrantedPermissions(grants[extension.id], required)) {
      onRun(run)
      return
    }
    setPending({ extension, command, required, run })
  }

  const pendingLabel = useMemo(
    () => (pending ? permissionsLabel(pending.required) : ''),
    [pending]
  )

  return (
    <div className="extensions-panel" aria-label="拡張機能">
      <div className="extensions-head">
        <strong>Extensions</strong>
        <button type="button" onClick={onRefresh} title="再読込">
          更新
        </button>
      </div>
      <p className="extensions-lead">
        `.saforall/extensions/*.json` を読み込みます。実行には権限承認が必要です（`{'{file}'}` =
        アクティブファイル）。
      </p>
      {extensions.length === 0 ? (
        <p className="extensions-empty">拡張はまだありません</p>
      ) : (
        <ul className="extensions-list">
          {extensions.map((ext) => {
            const granted = grants[ext.id] ?? []
            return (
              <li key={ext.id} className="extensions-card">
                <div className="extensions-card-title">{ext.name}</div>
                {ext.description && <p>{ext.description}</p>}
                <p className="extensions-perms">
                  権限: {(ext.permissions ?? ['terminal.run']).join(', ')}
                  {granted.length > 0 ? ` · 承認済み: ${granted.join(', ')}` : ' · 未承認'}
                </p>
                <div className="extensions-commands">
                  {ext.commands.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => requestRun(ext, cmd)}
                      title={cmd.run}
                    >
                      {cmd.title}
                    </button>
                  ))}
                  {granted.length > 0 && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onRevoke(ext.id)}
                      title="権限を取り消す"
                    >
                      権限を取り消す
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pending && (
        <div className="extensions-grant" role="dialog" aria-label="拡張の権限確認">
          <h3>権限の承認</h3>
          <p>
            <strong>{pending.extension.name}</strong> の「{pending.command.title}」を実行するには次の権限が必要です。
          </p>
          <p className="extensions-grant-perms">{pendingLabel}</p>
          <pre>{pending.run}</pre>
          <div className="extensions-grant-actions">
            <button type="button" onClick={() => setPending(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onGrant(pending.extension.id, pending.required)
                onRun(pending.run)
                setPending(null)
              }}
            >
              承認して実行
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
