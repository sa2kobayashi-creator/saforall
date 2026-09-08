import { useMemo } from 'react'
import { groupProblemsByPath, type ProblemLike } from '../lib/problems'
import { useIncrementalList } from '../lib/incrementalList'
import './ProblemsPanel.css'

export type ProblemItem = ProblemLike

type Props = {
  problems: ProblemItem[]
  onOpenFile?: (path: string, line?: number) => void
  onAskAi?: (item: ProblemItem) => void
}

export function ProblemsPanel({ problems, onOpenFile, onAskAi }: Props) {
  const groups = useMemo(() => groupProblemsByPath(problems), [problems])

  return (
    <section className="problems-panel" aria-label="Problems">
      {problems.length === 0 ? (
        <div className="problems-empty">問題は検出されていません</div>
      ) : (
        <div className="problems-groups">
          {groups.map((group) => (
            <ProblemGroup
              key={group.path}
              group={group}
              onOpenFile={onOpenFile}
              onAskAi={onAskAi}
            />
          ))}
        </div>
      )}
    </section>
  )
}

type Group = ReturnType<typeof groupProblemsByPath>[number]

function ProblemGroup({
  group,
  onOpenFile,
  onAskAi
}: {
  group: Group
  onOpenFile?: Props['onOpenFile']
  onAskAi?: Props['onAskAi']
}) {
  const { visible, hidden, showMore } = useIncrementalList(group.items)

  return (
            <div className="problems-group">
              <div className="problems-group-head" title={group.path}>
                <span className="problems-group-path">{group.path}</span>
                <span className="problems-group-count">{group.items.length}</span>
              </div>
              <ul className="problems-list">
                {visible.map((item) => (
                  <li key={item.id} className={`problems-item severity-${item.severity}`}>
                    <span className="problems-severity">{item.severity}</span>
                    <span className="problems-source">{item.source}</span>
                    {item.path && onOpenFile && group.path !== '(workspace)' ? (
                      <button
                        type="button"
                        className="problems-message"
                        onClick={() => onOpenFile(item.path!, item.line)}
                      >
                        {item.message}
                        {item.line ? (
                          <span className="problems-path">:{item.line}</span>
                        ) : null}
                      </button>
                    ) : (
                      <span className="problems-message">
                        {item.message}
                        {item.line ? (
                          <span className="problems-path">:{item.line}</span>
                        ) : null}
                      </span>
                    )}
                    {onAskAi && (
                      <button
                        type="button"
                        className="problems-ask-ai"
                        title="AI に修正を依頼"
                        onClick={() => onAskAi(item)}
                      >
                        AI
                      </button>
                    )}
                  </li>
                ))}
                {hidden > 0 && (
                  <li className="problems-item problems-more">
                    <button type="button" className="problems-message" onClick={showMore}>
                      さらに {hidden} 件を表示
                    </button>
                  </li>
                )}
              </ul>
            </div>
  )
}
