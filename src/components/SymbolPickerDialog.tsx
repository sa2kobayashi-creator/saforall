import { useEffect, useMemo, useState } from 'react'
import type { OutlineSymbol } from './OutlinePanel'
import './QuickOpenDialog.css'

export type SymbolPickHit = {
  id: string
  label: string
  detail: string
  path?: string
  line: number
  column?: number
}

type Props = {
  open: boolean
  mode: 'document' | 'workspace'
  workspacePath: string | null
  activePath: string | null
  onClose: () => void
  onPick: (hit: SymbolPickHit) => void
}

function kindLabel(kind: number): string {
  const map: Record<number, string> = {
    5: 'class',
    6: 'method',
    11: 'interface',
    12: 'function',
    13: 'var',
    14: 'const',
    23: 'struct',
    25: 'enum'
  }
  return map[kind] ?? 'sym'
}

export function flattenOutlineSymbols(symbols: OutlineSymbol[], prefix = ''): SymbolPickHit[] {
  const out: SymbolPickHit[] = []
  for (const sym of symbols) {
    const label = prefix ? `${prefix}.${sym.name}` : sym.name
    out.push({
      id: `${label}:${sym.line}:${sym.column}`,
      label,
      detail: `${kindLabel(sym.kind)} · L${sym.line}`,
      line: sym.line,
      column: sym.column
    })
    if (sym.children?.length) {
      out.push(...flattenOutlineSymbols(sym.children, label))
    }
  }
  return out
}

export function SymbolPickerDialog({
  open,
  mode,
  workspacePath,
  activePath,
  onClose,
  onPick
}: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SymbolPickHit[]>([])
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(0)

  const title =
    mode === 'document' ? 'ファイル内シンボル（Ctrl+Shift+O）' : 'ワークスペースシンボル（Ctrl+T）'
  const placeholder =
    mode === 'document' ? 'シンボルを検索…' : 'クラス・関数名で検索…'

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHits([])
    setIndex(0)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const run = async () => {
      setBusy(true)
      try {
        if (mode === 'document') {
          if (!activePath || typeof window.saforall.lspDocumentSymbols !== 'function') {
            if (!cancelled) setHits([])
            return
          }
          const rows = await window.saforall.lspDocumentSymbols({ path: activePath })
          const flat = flattenOutlineSymbols((rows as OutlineSymbol[]) ?? [])
          const q = query.trim().toLowerCase()
          const filtered = q
            ? flat.filter(
                (row) =>
                  row.label.toLowerCase().includes(q) || row.detail.toLowerCase().includes(q)
              )
            : flat
          if (!cancelled) {
            setHits(filtered.slice(0, 80))
            setIndex(0)
          }
          return
        }

        if (!workspacePath || typeof window.saforall.searchSymbols !== 'function') {
          if (!cancelled) setHits([])
          return
        }
        const q = query.trim()
        if (q.length < 1) {
          if (!cancelled) setHits([])
          return
        }
        const rows = await window.saforall.searchSymbols(workspacePath, q)
        if (cancelled) return
        setHits(
          rows.slice(0, 80).map((row, i) => ({
            id: `${row.path}:${row.line}:${row.name}:${i}`,
            label: row.name,
            detail: `${row.kind} · ${row.path}:${row.line}`,
            path: row.path,
            line: row.line
          }))
        )
        setIndex(0)
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    const delay = mode === 'workspace' ? 180 : 40
    const timer = window.setTimeout(() => {
      void run()
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, mode, query, activePath, workspacePath])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const emptyHint = useMemo(() => {
    if (busy) return '検索中…'
    if (mode === 'workspace' && query.trim().length < 1) return '文字を入力してください'
    if (mode === 'document' && !activePath) return 'ファイルを開いてください'
    return hits.length === 0 ? '一致なし' : ''
  }, [busy, mode, query, activePath, hits.length])

  if (!open) return null

  return (
    <div className="quick-open-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="quick-open-dialog">
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
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
              onPick(hits[index])
              onClose()
            }
          }}
        />
        <div className="quick-open-list">
          {emptyHint && <p className="quick-open-hint">{emptyHint}</p>}
          {hits.map((row, i) => (
            <button
              key={row.id}
              type="button"
              className={`quick-open-item${i === index ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                onPick(row)
                onClose()
              }}
            >
              <span className="quick-open-path">{row.label}</span>
              <span className="quick-open-meta">{row.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
