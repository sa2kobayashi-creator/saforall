import { useEffect, useState } from 'react'
import {
  folderNameFromPath,
  loadRecentWorkspaces,
  removeRecentWorkspace,
  type RecentWorkspace
} from '../lib/recentWorkspaces'
import { useI18n } from '../i18n'
import './WelcomeScreen.css'

type Props = {
  backendConnected: boolean
  backendMessage: string
  backendBaseUrl?: string
  onOpenFolder: () => void
  onOpenRecent: (path: string) => void
  onClone: () => void
  onOpenSettings: () => void
  onRecheckBackend?: () => void
}

export function WelcomeScreen({
  backendConnected,
  backendMessage,
  backendBaseUrl = '',
  onOpenFolder,
  onOpenRecent,
  onClone,
  onOpenSettings,
  onRecheckBackend
}: Props) {
  const { t } = useI18n()
  const [recents, setRecents] = useState<RecentWorkspace[]>(() => loadRecentWorkspaces())

  useEffect(() => {
    setRecents(loadRecentWorkspaces())
  }, [])

  return (
    <div className="welcome-screen" aria-label="スタート">
      <div className="welcome-hero">
        <p className="welcome-brand">saforall</p>
        <h1>フォルダを開いて始める</h1>
        <p className="welcome-lead">
          Cursor のように、まずワークスペースを選んでから編集・Agent を使います。
        </p>
        <div className="welcome-actions">
          <button type="button" className="welcome-primary" onClick={onOpenFolder}>
            フォルダを開く
          </button>
          <button type="button" className="welcome-secondary" onClick={onClone}>
            Git リポジトリをクローン
          </button>
          <button type="button" className="welcome-secondary" onClick={onOpenSettings}>
            設定
          </button>
        </div>
        <p className={`welcome-backend ${backendConnected ? 'ok' : 'ng'}`}>
          {backendConnected ? t('status.connected') : backendMessage || t('status.disconnected')}
        </p>
        {!backendConnected && (
          <div className="welcome-xampp" role="status">
            <strong>バックエンド起動手順（XAMPP）</strong>
            <ol>
              <li>XAMPP Control Panel を開く</li>
              <li>
                <strong>Apache</strong> と <strong>MySQL</strong> を Start
              </li>
              <li>
                確認 URL:{' '}
                <code>
                  {(backendBaseUrl || 'http://localhost:8081/saforall/api').replace(/\/$/, '')}
                  /health
                </code>
              </li>
            </ol>
            <p className="welcome-xampp-note">
              既定は <code>http://localhost:8081/saforall/api</code> です。ポートが違う場合は環境変数{' '}
              <code>SAFORALL_API_BASE_URL</code> を合わせてください。
            </p>
            <div className="welcome-xampp-actions">
              {onRecheckBackend && (
                <button type="button" className="welcome-secondary" onClick={onRecheckBackend}>
                  再確認
                </button>
              )}
              <button type="button" className="welcome-secondary" onClick={onOpenSettings}>
                設定を開く
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="welcome-recents" aria-label="最近使ったフォルダ">
        <div className="welcome-recents-head">
          <h2>最近使ったフォルダ</h2>
        </div>
        {recents.length === 0 ? (
          <p className="welcome-empty">まだ履歴がありません</p>
        ) : (
          <ul className="welcome-recent-list">
            {recents.map((row) => (
              <li key={row.path}>
                <button
                  type="button"
                  className="welcome-recent-open"
                  onClick={() => onOpenRecent(row.path)}
                  title={row.path}
                >
                  <strong>{folderNameFromPath(row.path)}</strong>
                  <span>{row.path}</span>
                </button>
                <button
                  type="button"
                  className="welcome-recent-remove"
                  title="一覧から削除"
                  onClick={() => setRecents(removeRecentWorkspace(row.path))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
