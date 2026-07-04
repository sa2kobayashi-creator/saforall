import type { BackendStatus } from '../types'
import './StatusBar.css'

type Props = {
  message: string
  dirty: boolean
  backend: BackendStatus
  onRecheckBackend: () => void
}

export function StatusBar({ message, dirty, backend, onRecheckBackend }: Props) {
  const backendLabel = backend.checking
    ? '確認中…'
    : backend.connected
      ? 'API 接続済み'
      : 'API 未接続'

  return (
    <footer className={`status-bar ${backend.connected ? 'online' : 'offline'}`}>
      <span className="status-message">{message}</span>
      <div className="status-meta">
        <button
          type="button"
          className={`backend-status ${backend.connected ? 'ok' : 'ng'}`}
          title={`${backend.message}\n${backend.baseUrl}\nクリックで再確認`}
          onClick={onRecheckBackend}
        >
          {backendLabel}
        </button>
        <span>{dirty ? '未保存' : '保存済み'}</span>
      </div>
    </footer>
  )
}
