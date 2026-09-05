import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import './SearchPanel.css'

type Props = {
  workspacePath: string | null
  width: number
  onOpenWorkspace: () => void
  onOpenFile: (path: string, line?: number) => void
}

type Mode = 'content' | 'files'

type ContentHit = {
  path: string
  line: number
  preview: string
  raw: string
}

function parseContentHits(raw: string): ContentHit[] {
  const text = raw.trim()
  if (!text || text === '一致なし' || text.includes('文字以上')) return []
  const rows: ContentHit[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(.+?):(\d+):\s?(.*)$/)
    if (!match) continue
    rows.push({
      path: match[1],
      line: Number(match[2]),
      preview: match[3] ?? '',
      raw: line
    })
  }
  return rows
}

export function SearchPanel({ workspacePath, width, onOpenWorkspace, onOpenFile }: Props) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('content')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileHits, setFileHits] = useState<string[]>([])
  const [contentHits, setContentHits] = useState<ContentHit[]>([])
  const [error, setError] = useState<string | null>(null)

  const absoluteFor = useMemo(() => {
    if (!workspacePath) return (rel: string) => rel
    const sep = workspacePath.includes('\\') ? '\\' : '/'
    const root = workspacePath.replace(/[\\/]+$/, '')
    return (rel: string) => {
      if (/^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/') || rel.startsWith('\\\\')) return rel
      return `${root}${sep}${rel.replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep)}`
    }
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) {
      setFileHits([])
      setContentHits([])
      return
    }
    const q = query.trim()
    if (mode === 'content' && q.length < 2) {
      setContentHits([])
      setError(null)
      return
    }
    if (mode === 'files' && q.length < 1) {
      setFileHits([])
      setError(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      const run =
        mode === 'files'
          ? window.saforall.searchFiles(workspacePath, q).then((rows) => {
              if (!cancelled) setFileHits(rows)
            })
          : window.saforall.searchCode(workspacePath, q).then((raw) => {
              if (!cancelled) setContentHits(parseContentHits(raw))
            })
      void run
        .catch((err) => {
          if (!cancelled) setError(String(err))
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [workspacePath, query, mode])

  return (
    <aside className="search-panel" style={{ width }} aria-label={t('search.aria')}>
      <div className="search-header">
        <strong>{t('search.title')}</strong>
      </div>

      {!workspacePath ? (
        <div className="search-empty">
          <p>{t('search.needWorkspace')}</p>
          <button type="button" className="primary" onClick={onOpenWorkspace}>
            {t('activity.openFolder')}
          </button>
        </div>
      ) : (
        <>
          <div className="search-modes" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'content'}
              className={mode === 'content' ? 'active' : ''}
              onClick={() => setMode('content')}
            >
              {t('search.content')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'files'}
              className={mode === 'files' ? 'active' : ''}
              onClick={() => setMode('files')}
            >
              {t('search.files')}
            </button>
          </div>
          <div className="search-input-wrap">
            <input
              autoFocus
              value={query}
              placeholder={
                mode === 'content' ? t('search.placeholderContent') : t('search.placeholderFiles')
              }
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {error && <div className="search-error">{error}</div>}
          <div className="search-results">
            {busy && <p className="search-hint">{t('search.searching')}</p>}
            {!busy && mode === 'content' && query.trim().length < 2 && (
              <p className="search-hint">{t('search.minChars')}</p>
            )}
            {!busy &&
              mode === 'content' &&
              query.trim().length >= 2 &&
              contentHits.length === 0 && <p className="search-hint">{t('search.none')}</p>}
            {!busy && mode === 'files' && query.trim().length < 1 && (
              <p className="search-hint">{t('search.typeFiles')}</p>
            )}
            {!busy && mode === 'files' && query.trim().length >= 1 && fileHits.length === 0 && (
              <p className="search-hint">{t('search.none')}</p>
            )}

            {mode === 'content' &&
              contentHits.map((hit) => (
                <button
                  key={hit.raw}
                  type="button"
                  className="search-hit"
                  title={hit.raw}
                  onClick={() => onOpenFile(absoluteFor(hit.path), hit.line)}
                >
                  <span className="search-hit-path">
                    {hit.path}
                    <em>:{hit.line}</em>
                  </span>
                  <span className="search-hit-preview">{hit.preview}</span>
                </button>
              ))}

            {mode === 'files' &&
              fileHits.map((rel) => (
                <button
                  key={rel}
                  type="button"
                  className="search-hit search-hit--file"
                  title={rel}
                  onClick={() => onOpenFile(absoluteFor(rel))}
                >
                  <span className="search-hit-path">{rel}</span>
                </button>
              ))}
          </div>
        </>
      )}
    </aside>
  )
}
