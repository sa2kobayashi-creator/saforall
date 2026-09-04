import './ProblemsPanel.css'

export type ProblemItem = {
  id: string
  severity: 'error' | 'warning' | 'info'
  source: string
  message: string
  path?: string
  line?: number
  column?: number
}

type Props = {
  problems: ProblemItem[]
  onOpenFile?: (path: string, line?: number) => void
}

export function ProblemsPanel({ problems, onOpenFile }: Props) {
  return (
    <section className="problems-panel" aria-label="Problems">
      {problems.length === 0 ? (
        <div className="problems-empty">問題は検出されていません</div>
      ) : (
        <ul className="problems-list">
          {problems.map((item) => (
            <li key={item.id} className={`problems-item severity-${item.severity}`}>
              <span className="problems-severity">{item.severity}</span>
              <span className="problems-source">{item.source}</span>
              {item.path && onOpenFile ? (
                <button
                  type="button"
                  className="problems-message"
                  onClick={() => onOpenFile(item.path!, item.line)}
                >
                  {item.message}
                  <span className="problems-path">
                    {item.path}
                    {item.line ? `:${item.line}` : ''}
                  </span>
                </button>
              ) : (
                <span className="problems-message">
                  {item.message}
                  {item.path && (
                    <span className="problems-path">
                      {item.path}
                      {item.line ? `:${item.line}` : ''}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
