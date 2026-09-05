import type { BackendStatus } from '../types'
import { parseLocale, useI18n } from '../i18n'
import './StatusBar.css'

type Props = {
  message: string
  dirty: boolean
  backend: BackendStatus
  onRecheckBackend: () => void
}

export function StatusBar({ message, dirty, backend, onRecheckBackend }: Props) {
  const { t, locale, setLocale, locales, localeLabels } = useI18n()
  const backendLabel = backend.checking
    ? t('status.checking')
    : backend.connected
      ? t('status.connected')
      : t('status.disconnectedHint')

  return (
    <footer className={`status-bar ${backend.connected ? 'online' : 'offline'}`}>
      <span className="status-message">{message}</span>
      <div className="status-meta">
        <label className="status-locale" title={t('status.locale')}>
          <span className="status-locale-label">{t('status.locale')}</span>
          <select
            value={locale}
            aria-label={t('status.locale')}
            onChange={(event) => setLocale(parseLocale(event.target.value))}
          >
            {locales.map((code) => (
              <option key={code} value={code}>
                {localeLabels[code]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`backend-status ${backend.connected ? 'ok' : 'ng'}`}
          title={`${backend.message}\n${backend.baseUrl}\n${t('status.recheck')}`}
          onClick={onRecheckBackend}
        >
          {backendLabel}
        </button>
        <span>{dirty ? t('status.dirty') : t('status.clean')}</span>
      </div>
    </footer>
  )
}
