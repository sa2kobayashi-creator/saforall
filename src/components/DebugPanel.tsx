import { useState } from 'react'
import './DebugPanel.css'
import type { DebugCallFrame, DebugVariable, DebugBreakpointMap } from '../lib/debugTypes'

type WatchRow = { expression: string; value?: string }

type Props = {
  running: boolean
  paused: boolean
  port: number | null
  frames: DebugCallFrame[]
  variables: DebugVariable[]
  watches: WatchRow[]
  breakpoints: DebugBreakpointMap
  logs: string[]
  breakpointCount: number
  exceptionBreakMode: 'none' | 'uncaught' | 'all'
  onExceptionBreakModeChange: (mode: 'none' | 'uncaught' | 'all') => void
  onContinue: () => void
  onStepOver: () => void
  onStop: () => void
  onStart: () => void
  onOpenFrame: (frame: DebugCallFrame) => void
  onAddWatch: (expression: string) => void
  onRemoveWatch: (expression: string) => void
  onSetBreakpointCondition: (path: string, line: number, condition: string) => void
}

export function DebugPanel({
  running,
  paused,
  port,
  frames,
  variables,
  watches,
  breakpoints,
  logs,
  breakpointCount,
  exceptionBreakMode,
  onExceptionBreakModeChange,
  onContinue,
  onStepOver,
  onStop,
  onStart,
  onOpenFrame,
  onAddWatch,
  onRemoveWatch,
  onSetBreakpointCondition
}: Props) {
  const [watchInput, setWatchInput] = useState('')

  const bpRows = Object.entries(breakpoints).flatMap(([path, entries]) =>
    entries.map((row) => ({ path, ...row }))
  )

  return (
    <div className="debug-panel" aria-label="デバッガ">
      <div className="debug-toolbar">
        <button type="button" className="primary" onClick={onStart} disabled={running && !paused}>
          {running ? '再起動' : 'デバッグ開始'}
        </button>
        <button type="button" onClick={onContinue} disabled={!paused}>
          Continue
        </button>
        <button type="button" onClick={onStepOver} disabled={!paused}>
          Step Over
        </button>
        <button type="button" onClick={onStop} disabled={!running}>
          Stop
        </button>
        <span className="debug-meta">
          BP {breakpointCount}
          {port ? ` · :${port}` : ''}
          {paused ? ' · PAUSED' : running ? ' · RUNNING' : ' · IDLE'}
        </span>
        <label className="debug-exception">
          例外
          <select
            value={exceptionBreakMode}
            onChange={(event) =>
              onExceptionBreakModeChange(
                event.target.value as 'none' | 'uncaught' | 'all'
              )
            }
            disabled={running}
            title="次のデバッグ開始から適用"
          >
            <option value="none">なし</option>
            <option value="uncaught">未捕捉</option>
            <option value="all">すべて</option>
          </select>
        </label>
      </div>
      <div className="debug-body debug-body-rich">
        <div className="debug-stack">
          <strong>Call Stack</strong>
          {frames.length === 0 ? (
            <p className="debug-empty">停止中のフレームはありません</p>
          ) : (
            <ul>
              {frames.map((frame, index) => (
                <li key={`${frame.url}:${frame.lineNumber}:${index}`}>
                  <button type="button" onClick={() => onOpenFrame(frame)}>
                    <span>{frame.functionName}</span>
                    <em>
                      {frame.url.split(/[/\\]/).pop()}:{frame.lineNumber}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="debug-vars">
          <strong>Variables</strong>
          {variables.length === 0 ? (
            <p className="debug-empty">停止時にローカル変数を表示</p>
          ) : (
            <ul>
              {variables.map((row) => (
                <li key={row.name}>
                  <code>{row.name}</code>
                  <span>{row.value}</span>
                </li>
              ))}
            </ul>
          )}
          <strong className="debug-subhead">Watch</strong>
          <form
            className="debug-watch-form"
            onSubmit={(event) => {
              event.preventDefault()
              const expr = watchInput.trim()
              if (!expr) return
              onAddWatch(expr)
              setWatchInput('')
            }}
          >
            <input
              value={watchInput}
              onChange={(event) => setWatchInput(event.target.value)}
              placeholder="expression"
              disabled={!paused && !running}
            />
            <button type="submit">+</button>
          </form>
          <ul>
            {watches.map((row) => (
              <li key={row.expression}>
                <button type="button" className="ghost" onClick={() => onRemoveWatch(row.expression)}>
                  ×
                </button>
                <code>{row.expression}</code>
                <span>{row.value ?? '—'}</span>
              </li>
            ))}
          </ul>
          <strong className="debug-subhead">Breakpoints</strong>
          {bpRows.length === 0 ? (
            <p className="debug-empty">余白クリックで BP 追加</p>
          ) : (
            <ul className="debug-bp-list">
              {bpRows.map((row) => (
                <li key={`${row.path}:${row.line}`}>
                  <em>
                    {row.path.split(/[/\\]/).pop()}:{row.line}
                  </em>
                  <input
                    defaultValue={row.condition ?? ''}
                    placeholder="condition (e.g. x > 0)"
                    onBlur={(event) =>
                      onSetBreakpointCondition(row.path, row.line, event.target.value)
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="debug-console">
          <strong>Debug Console</strong>
          <pre>{logs.length > 0 ? logs.join('') : 'デバッグ出力がここに表示されます'}</pre>
        </div>
      </div>
      <p className="debug-hint">
        条件 BP は一覧で設定。Watch は停止中に評価されます（js/ts · CDP）。
      </p>
    </div>
  )
}
