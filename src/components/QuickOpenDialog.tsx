import { useEffect, useMemo, useState } from 'react'
import './QuickOpenDialog.css'

type Props = {
  open: boolean
  workspacePath: string | null
  onClose: () => void
  onOpenFile: (absolutePath: string) => void
}

export function QuickOpenDialog({ open, workspacePath, onClose, onOpenFile }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHits([])
    setIndex(0)
  }, [open])

  useEffect(() => {
    if (!open || !workspacePath) return
    const q = query.trim()
    if (q.length < 1) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      void window.saforall
        .searchFiles(workspacePath, q)
        .then((rows) => {
          if (!cancelled) {
            setHits(rows)
            setIndex(0)
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, workspacePath])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const absoluteFor = useMemo(() => {
    if (!workspacePath) return (rel: string) => rel
    const sep = workspacePath.includes('\\') ? '\\' : '/'
    const root = workspacePath.replace(/[\\/]+$/, '')
    return (rel: string) => {
      if (/^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/') || rel.startsWith('\\\\')) return rel
      return `${root}${sep}${rel.replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep)}`
    }
  }, [workspacePath])

  if (!open) return null

  return (
    <div className="quick-open-overlay" role="dialog" aria-modal="true" aria-label="ファイルを開く">
      <div className="quick-open-dialog">
        <input
          autoFocus
          value={query}
          placeholder="ファイル名で検索（Ctrl+P）"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((current) => Math.min(hits.length - 1, current + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((current) => Math.max(0, current - 1))
            } else if (event.key === 'Enter' && hits[index]) {
              event.preventDefault()
              onOpenFile(absoluteFor(hits[index]))
              onClose()
            }
          }}
        />
        <div className="quick-open-list">
          {busy && <p className="quick-open-hint">検索中…</p>}
          {!busy && hits.length === 0 && (
            <p className="quick-open-hint">{query.trim() ? '一致なし' : '文字を入力してください'}</p>
          )}
          {hits.map((row, i) => (
            <button
              key={row}
              type="button"
              className={`quick-open-item${i === index ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                onOpenFile(absoluteFor(row))
                onClose()
              }}
            >
              {row}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
