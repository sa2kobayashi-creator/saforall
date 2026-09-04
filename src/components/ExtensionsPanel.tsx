import type { WorkspaceExtension } from '../types/extensions'
import './ExtensionsPanel.css'

type Props = {
  extensions: WorkspaceExtension[]
  activeFilePath: string | null
  onRun: (command: string) => void
  onRefresh: () => void
}

export function ExtensionsPanel({ extensions, activeFilePath, onRun, onRefresh }: Props) {
  return (
    <div className="extensions-panel" aria-label="拡張機能">
      <div className="extensions-head">
        <strong>Extensions</strong>
        <button type="button" onClick={onRefresh} title="再読込">
          更新
        </button>
      </div>
      <p className="extensions-lead">
        `.saforall/extensions/*.json` から読み込みます。`{'{file}'}` はアクティブファイルに置換されます。
      </p>
      {extensions.length === 0 ? (
        <p className="extensions-empty">拡張はまだありません</p>
      ) : (
        <ul className="extensions-list">
          {extensions.map((ext) => (
            <li key={ext.id} className="extensions-card">
              <div className="extensions-card-title">{ext.name}</div>
              {ext.description && <p>{ext.description}</p>}
              <div className="extensions-commands">
                {ext.commands.map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => {
                      const run = cmd.run.replaceAll(
                        '{file}',
                        activeFilePath ? `"${activeFilePath.replace(/"/g, '\\"')}"` : '.'
                      )
                      onRun(run)
                    }}
                    title={cmd.run}
                  >
                    {cmd.title}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
