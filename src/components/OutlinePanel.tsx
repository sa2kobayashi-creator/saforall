import { useEffect, useMemo, useState } from 'react'
import './OutlinePanel.css'

export type OutlineSymbol = {
  name: string
  kind: number
  detail?: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  children?: OutlineSymbol[]
}

type Props = {
  symbols: OutlineSymbol[]
  activePath: string | null
  onJump: (line: number, column?: number) => void
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

function SymbolTree({
  symbols,
  depth,
  onJump
}: {
  symbols: OutlineSymbol[]
  depth: number
  onJump: (line: number, column?: number) => void
}) {
  return (
    <ul className="outline-list" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {symbols.map((sym) => (
        <li key={`${sym.name}:${sym.line}:${sym.column}:${depth}`}>
          <button
            type="button"
            className="outline-item"
            onClick={() => onJump(sym.line, sym.column)}
            title={`${sym.name} · L${sym.line}`}
          >
            <span className="outline-kind">{kindLabel(sym.kind)}</span>
            <span className="outline-name">{sym.name}</span>
          </button>
          {sym.children && sym.children.length > 0 && (
            <SymbolTree symbols={sym.children} depth={depth + 1} onJump={onJump} />
          )}
        </li>
      ))}
    </ul>
  )
}

export function OutlinePanel({ symbols, activePath, onJump }: Props) {
  if (!activePath) {
    return <div className="outline-empty">ファイルを開くと Outline を表示します</div>
  }
  if (symbols.length === 0) {
    return <div className="outline-empty">シンボルがありません（LSP）</div>
  }
  return (
    <div className="outline-panel" aria-label="Outline">
      <div className="outline-title">Outline</div>
      <SymbolTree symbols={symbols} depth={0} onJump={onJump} />
    </div>
  )
}

export function EditorBreadcrumbs({
  path,
  symbols,
  cursorLine,
  onJump
}: {
  path: string | null
  symbols: OutlineSymbol[]
  cursorLine: number
  onJump: (line: number, column?: number) => void
}) {
  const crumbs = useMemo(() => {
    if (!path) return [] as Array<{ label: string; line?: number; column?: number }>
    const parts = path.replace(/\\/g, '/').split('/')
    const file = parts[parts.length - 1] || path
    const trail: Array<{ label: string; line?: number; column?: number }> = [
      { label: file }
    ]
    const flat: OutlineSymbol[] = []
    const walk = (rows: OutlineSymbol[]) => {
      for (const row of rows) {
        flat.push(row)
        if (row.children) walk(row.children)
      }
    }
    walk(symbols)
    const enclosing = flat
      .filter((row) => {
        const end = row.endLine ?? row.line
        return row.line <= cursorLine && cursorLine <= end
      })
      .sort((a, b) => b.line - a.line)
      .slice(0, 3)
      .reverse()
    for (const row of enclosing) {
      trail.push({ label: row.name, line: row.line, column: row.column })
    }
    return trail
  }, [path, symbols, cursorLine])

  if (!path || crumbs.length === 0) return null
  return (
    <nav className="editor-breadcrumbs" aria-label="Breadcrumbs">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="editor-breadcrumb">
          {index > 0 && <span className="editor-breadcrumb-sep">›</span>}
          {crumb.line ? (
            <button type="button" onClick={() => onJump(crumb.line!, crumb.column)}>
              {crumb.label}
            </button>
          ) : (
            <span>{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function useDocumentSymbols(activePath: string | null): OutlineSymbol[] {
  const [symbols, setSymbols] = useState<OutlineSymbol[]>([])
  useEffect(() => {
    if (!activePath || typeof window.saforall.lspDocumentSymbols !== 'function') {
      setSymbols([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.saforall
        .lspDocumentSymbols({ path: activePath })
        .then((rows) => {
          if (!cancelled) setSymbols((rows as OutlineSymbol[]) ?? [])
        })
        .catch(() => {
          if (!cancelled) setSymbols([])
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activePath])
  return symbols
}
