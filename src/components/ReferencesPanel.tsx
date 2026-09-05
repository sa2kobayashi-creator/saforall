import './ReferencesPanel.css'

export type ReferenceHit = {
  path: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

type Props = {
  hits: ReferenceHit[]
  symbolLabel?: string | null
  loading?: boolean
  onOpen: (path: string, line: number) => void
}

export function ReferencesPanel({ hits, symbolLabel, loading, onOpen }: Props) {
  return (
    <div className="references-panel" aria-label="参照一覧">
      <div className="references-head">
        <strong>References</strong>
        {symbolLabel ? <span className="references-symbol">{symbolLabel}</span> : null}
        <span className="references-count">
          {loading ? '検索中…' : `${hits.length} 件`}
        </span>
      </div>
      {loading ? (
        <p className="references-empty">LSP で参照を検索しています…</p>
      ) : hits.length === 0 ? (
        <p className="references-empty">
          エディタでシンボル上にカーソルを置き、Shift+F12 で参照を表示します
        </p>
      ) : (
        <ul className="references-list">
          {hits.map((hit, index) => (
            <li key={`${hit.path}:${hit.line}:${hit.column}:${index}`}>
              <button type="button" onClick={() => onOpen(hit.path, hit.line)}>
                <span className="references-file">
                  {hit.path.split(/[/\\]/).pop()}
                </span>
                <em>
                  :{hit.line}
                  {hit.column > 1 ? `:${hit.column}` : ''}
                </em>
                <code title={hit.path}>{hit.path}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
