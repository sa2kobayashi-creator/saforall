import type { BackendStatus } from '../types'
import type { ModelApiStatus } from '../lib/modelApiStatus'
import { parseLocale, useI18n } from '../i18n'
import './StatusBar.css'

type Props = {
  message: string
  dirty: boolean
  backend: BackendStatus
  modelApiStatus: ModelApiStatus
  onRecheckBackend: () => void
}

export function StatusBar({ message, dirty, backend, modelApiStatus, onRecheckBackend }: Props) {
  const { t, locale, setLocale, locales, localeLabels } = useI18n()
  const backendLabel =
    modelApiStatus === 'checking'
      ? t('status.checking')
      : modelApiStatus === 'online'
        ? t('status.modelApiOnline')
        : t('status.modelApiOffline')
  const barTone = modelApiStatus === 'checking' ? 'online' : modelApiStatus
  const chipTone = modelApiStatus === 'online' ? 'ok' : modelApiStatus === 'checking' ? 'ok' : 'ng'

  return (
    <footer className={`status-bar ${barTone}`}>
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
          className={`backend-status ${chipTone}`}
          title={`${backendLabel}\n${backend.message}\n${backend.baseUrl}\n${t('status.recheck')}`}
          onClick={onRecheckBackend}
        >
          {backendLabel}
        </button>
        <span>{dirty ? t('status.dirty') : t('status.clean')}</span>
      </div>
    </footer>
  )
}
