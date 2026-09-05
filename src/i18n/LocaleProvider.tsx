import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  LOCALE_LABELS,
  LOCALES,
  parseLocale,
  translate,
  type Locale,
  type MessageKey
} from './messages'

const STORAGE_KEY = 'saforall.locale'

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  locales: typeof LOCALES
  localeLabels: typeof LOCALE_LABELS
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLocale(): Locale {
  try {
    return parseLocale(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'ja'
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())

  const applyLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    document.documentElement.lang = next === 'en' ? 'en' : 'ja'
    if (typeof window.saforall?.setLocale === 'function') {
      void window.saforall.setLocale(next)
    }
    if (typeof window.saforall?.request === 'function') {
      void window.saforall
        .request('PUT', '/settings', { settings: { 'app.locale': next } })
        .catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'ja'
    if (typeof window.saforall?.setLocale === 'function') {
      void window.saforall.setLocale(locale)
    }
  }, [locale])

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  )

  const value = useMemo(
    () => ({
      locale,
      setLocale: applyLocale,
      t,
      locales: LOCALES,
      localeLabels: LOCALE_LABELS
    }),
    [locale, applyLocale, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within LocaleProvider')
  }
  return ctx
}
