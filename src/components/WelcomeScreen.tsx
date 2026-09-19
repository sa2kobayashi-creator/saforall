import { useEffect, useState } from 'react'
import {
  folderNameFromPath,
  loadRecentWorkspaces,
  removeRecentWorkspace,
  type RecentWorkspace
} from '../lib/recentWorkspaces'
import { formatXamppHealthUrl } from '../lib/backendGuide'
import { useI18n } from '../i18n'
import type { ModelApiStatus } from '../lib/modelApiStatus'
import './WelcomeScreen.css'

type Props = {
  backendConnected: boolean
  backendMessage: string
  backendBaseUrl?: string
  backendMode?: 'php' | 'local'
  modelApiStatus?: ModelApiStatus
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
  backendMode,
  modelApiStatus = 'checking',
  onOpenFolder,
  onOpenRecent,
  onClone,
  onOpenSettings,
  onRecheckBackend
}: Props) {
  const { t } = useI18n()
  const [recents, setRecents] = useState<RecentWorkspace[]>(() => loadRecentWorkspaces())
  const [localLlmReady, setLocalLlmReady] = useState(false)

  useEffect(() => {
    setRecents(loadRecentWorkspaces())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof window.saforall.hasLocalLlm !== 'function') return
      try {
        const ok = await window.saforall.hasLocalLlm()
        if (!cancelled) setLocalLlmReady(ok)
      } catch {
        if (!cancelled) setLocalLlmReady(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backendConnected, backendMode])

  const isLocal = backendMode === 'local' || (backendConnected && backendBaseUrl.startsWith('local://'))
  const statusClass =
    modelApiStatus === 'offline' ? 'ng' : modelApiStatus === 'online' ? 'ok' : 'ok'
  const statusLabel =
    modelApiStatus === 'checking'
      ? t('status.checking')
      : modelApiStatus === 'online'
        ? t('status.modelApiOnline')
        : t('status.modelApiOffline')

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
        <p className={`welcome-backend ${statusClass}`}>{statusLabel}</p>

        {isLocal && (
          <div className="welcome-local" role="status">
            <strong>キーを保存すれば Model API に接続します</strong>
            <ol>
              <li>
                <button type="button" className="welcome-inline-link" onClick={onOpenFolder}>
                  フォルダを開く
                </button>
              </li>
              <li>
                {localLlmReady ? (
                  <>API キーは保存済みです。チャットを使えます。</>
                ) : (
                  <>
                    <button type="button" className="welcome-inline-link" onClick={onOpenSettings}>
                      設定
                    </button>
                    で OpenAI / Claude / Gemini などの API キーを保存
                  </>
                )}
              </li>
              <li>会話履歴はアプリ内に保存されます（XAMPP 不要）</li>
            </ol>
            <div className="welcome-xampp-actions">
              <button type="button" className="welcome-secondary" onClick={onOpenSettings}>
                {localLlmReady ? '設定を確認' : 'API キーを設定'}
              </button>
              {onRecheckBackend && (
                <button type="button" className="welcome-secondary" onClick={onRecheckBackend}>
                  再確認
                </button>
              )}
            </div>
          </div>
        )}

        {!backendConnected && !isLocal && (
          <div className="welcome-xampp" role="status">
            <strong>バックエンド起動手順（XAMPP・任意）</strong>
            {backendMessage ? <p>{backendMessage}</p> : null}
            <ol>
              <li>XAMPP Control Panel を開く</li>
              <li>
                <strong>Apache</strong> と <strong>MySQL</strong> を Start
              </li>
              <li>
                ブラウザで確認:{' '}
                <code>{formatXamppHealthUrl(backendBaseUrl)}</code>
              </li>
              <li>この画面の「再確認」でステータスを更新</li>
            </ol>
            <p className="welcome-xampp-note">
              配布版では XAMPP は不要です。設定の API キーから Model API へ直接接続します。
              未署名インストーラでは SmartScreen が出ることがあります（詳細情報→実行）。
              Tab 補完（入力中の提案）と Ctrl+K も、キー保存後にローカルで利用できます。
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
