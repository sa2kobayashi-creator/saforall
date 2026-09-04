import './DebugPanel.css'
import type { DebugCallFrame } from '../lib/debugTypes'

type Props = {
  running: boolean
  paused: boolean
  port: number | null
  frames: DebugCallFrame[]
  logs: string[]
  breakpointCount: number
  onContinue: () => void
  onStepOver: () => void
  onStop: () => void
  onStart: () => void
  onOpenFrame: (frame: DebugCallFrame) => void
}

export function DebugPanel({
  running,
  paused,
  port,
  frames,
  logs,
  breakpointCount,
  onContinue,
  onStepOver,
  onStop,
  onStart,
  onOpenFrame
}: Props) {
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
      </div>
      <div className="debug-body">
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
        <div className="debug-console">
          <strong>Debug Console</strong>
          <pre>{logs.length > 0 ? logs.join('') : 'デバッグ出力がここに表示されます'}</pre>
        </div>
      </div>
      <p className="debug-hint">
        エディタ左余白をクリックしてブレークポイントを設定し、Debug 開始（Shift+F5）で停止できます。
      </p>
    </div>
  )
}
