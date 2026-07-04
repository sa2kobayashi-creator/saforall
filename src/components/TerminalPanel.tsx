import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'

type Props = {
  open: boolean
  height: number
  cwd: string | null
  pendingCommand: string | null
  onCommandSent: () => void
  onClose: () => void
}

export function TerminalPanel({
  open,
  height,
  cwd,
  pendingCommand,
  onCommandSent,
  onClose
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [backend, setBackend] = useState<'node-pty' | 'child_process' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSessionReady(false)
      return
    }
    const host = hostRef.current
    if (!host) return

    let disposed = false
    setSessionReady(false)
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      theme: {
        background: '#0c0c0c',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78'
      },
      convertEol: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(host)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    const offData = window.saforall.onTerminalData((payload) => {
      if (payload.id === sessionIdRef.current) {
        term.write(payload.data)
      }
    })
    const offExit = window.saforall.onTerminalExit((payload) => {
      if (payload.id === sessionIdRef.current) {
        term.writeln(`\r\n[プロセス終了: ${payload.exitCode}]`)
        sessionIdRef.current = null
        setSessionReady(false)
      }
    })

    const start = async () => {
      try {
        const cols = term.cols
        const rows = term.rows
        const session = await window.saforall.createTerminal({
          cwd: cwd ?? undefined,
          cols,
          rows
        })
        if (disposed) {
          await window.saforall.killTerminal(session.id)
          return
        }
        sessionIdRef.current = session.id
        setBackend(session.backend)
        setError(null)
        setSessionReady(true)
        term.focus()
      } catch (err) {
        setError(String(err))
        term.writeln(`ターミナル起動に失敗しました: ${String(err)}`)
      }
    }

    const onDataDisposable = term.onData((data) => {
      const id = sessionIdRef.current
      if (!id) return
      void window.saforall.writeTerminal(id, data)
    })

    void start()

    const onResize = () => {
      try {
        fitAddon.fit()
        const id = sessionIdRef.current
        if (id) {
          void window.saforall.resizeTerminal(id, term.cols, term.rows)
        }
      } catch {
        // ignore fit errors while hidden
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      onDataDisposable.dispose()
      offData()
      offExit()
      const id = sessionIdRef.current
      sessionIdRef.current = null
      setSessionReady(false)
      if (id) void window.saforall.killTerminal(id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [open, cwd])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        const id = sessionIdRef.current
        if (term && id) {
          void window.saforall.resizeTerminal(id, term.cols, term.rows)
        }
      } catch {
        // ignore
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, height])

  useEffect(() => {
    if (!open || !pendingCommand || !sessionReady) return
    const id = sessionIdRef.current
    if (!id) return

    const timer = window.setTimeout(() => {
      void window.saforall.writeTerminal(id, pendingCommand).then(() => {
        onCommandSent()
        termRef.current?.focus()
      })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [open, pendingCommand, sessionReady, onCommandSent])

  if (!open) return null

  return (
    <section className="terminal-panel" style={{ height }} aria-label="ターミナル">
      <div className="terminal-header">
        <div className="terminal-title">
          <strong>ターミナル</strong>
          <span>
            {cwd ? cwd : 'カレントディレクトリ'}
            {backend ? ` · ${backend}` : ''}
          </span>
        </div>
        <div className="terminal-actions">
          <button
            type="button"
            title="再起動"
            onClick={() => {
              const term = termRef.current
              if (!term) return
              const oldId = sessionIdRef.current
              if (oldId) void window.saforall.killTerminal(oldId)
              setSessionReady(false)
              term.reset()
              void window.saforall
                .createTerminal({
                  cwd: cwd ?? undefined,
                  cols: term.cols,
                  rows: term.rows
                })
                .then((session) => {
                  sessionIdRef.current = session.id
                  setBackend(session.backend)
                  setSessionReady(true)
                  term.focus()
                })
                .catch((err) => setError(String(err)))
            }}
          >
            再起動
          </button>
          <button type="button" title="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      {error && <div className="terminal-error">{error}</div>}
      <div className="terminal-host" ref={hostRef} />
    </section>
  )
}
