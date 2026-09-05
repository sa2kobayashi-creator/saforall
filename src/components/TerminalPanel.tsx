import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'

type Props = {
  /** セッションを維持するか（閉じても true のままにして履歴を残す） */
  open: boolean
  /** 画面上に表示するか（false でも PTY/xterm は破棄しない） */
  visible?: boolean
  height?: number
  cwd: string | null
  pendingCommand: string | null
  onCommandSent: () => void
  onClose?: () => void
  /** BottomPanel 内ではヘッダーを出さず親の高さを使う */
  embedded?: boolean
  /** タブ切替などで再フィットさせるトリガー */
  fitTrigger?: string | number
  /** 増えるたびに新しいターミナルタブを開く */
  newTerminalTrigger?: number
}

type TermTab = {
  localId: string
  title: string
}

function nextLocalId(): string {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

type SessionProps = {
  active: boolean
  visible: boolean
  cwd: string | null
  height?: number
  fitTrigger?: string | number
  pendingCommand: string | null
  onCommandSent: () => void
  onBackend: (backend: 'node-pty' | 'child_process' | null) => void
  onError: (message: string | null) => void
}

function TerminalSession({
  active,
  visible,
  cwd,
  height,
  fitTrigger,
  pendingCommand,
  onCommandSent,
  onBackend,
  onError
}: SessionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const show = visible && active

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    setSessionReady(false)
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      scrollback: 10000,
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
        const session = await window.saforall.createTerminal({
          cwd: cwd ?? undefined,
          cols: term.cols,
          rows: term.rows
        })
        if (disposed) {
          await window.saforall.killTerminal(session.id)
          return
        }
        sessionIdRef.current = session.id
        onBackend(session.backend)
        onError(null)
        setSessionReady(true)
        if (show) term.focus()
      } catch (err) {
        onError(String(err))
        term.writeln(`ターミナル起動に失敗しました: ${String(err)}`)
      }
    }

    const onDataDisposable = term.onData((data) => {
      const id = sessionIdRef.current
      if (!id) return
      void window.saforall.writeTerminal(id, data)
    })

    void start()

    const applyFit = () => {
      try {
        if (!host.isConnected || host.clientHeight < 8) return
        fitAddon.fit()
        const id = sessionIdRef.current
        if (id) {
          void window.saforall.resizeTerminal(id, term.cols, term.rows)
        }
      } catch {
        // ignore fit errors while hidden
      }
    }

    const onWindowResize = () => applyFit()
    window.addEventListener('resize', onWindowResize)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            applyFit()
          })
        : null
    resizeObserver?.observe(host)

    return () => {
      disposed = true
      window.removeEventListener('resize', onWindowResize)
      resizeObserver?.disconnect()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  useEffect(() => {
    if (!show) return
    const frame = window.requestAnimationFrame(() => {
      try {
        const host = hostRef.current
        if (!host || host.clientHeight < 8) return
        fitRef.current?.fit()
        const term = termRef.current
        const id = sessionIdRef.current
        if (term && id) {
          void window.saforall.resizeTerminal(id, term.cols, term.rows)
        }
        term?.focus()
      } catch {
        // ignore
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [show, height, fitTrigger])

  useEffect(() => {
    if (!show || !pendingCommand || !sessionReady) return
    const id = sessionIdRef.current
    if (!id) return

    const timer = window.setTimeout(() => {
      void window.saforall.writeTerminal(id, pendingCommand).then(() => {
        onCommandSent()
        termRef.current?.focus()
        termRef.current?.scrollToBottom()
      })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [show, pendingCommand, sessionReady, onCommandSent])

  const restart = () => {
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
        onBackend(session.backend)
        setSessionReady(true)
        term.focus()
      })
      .catch((err) => onError(String(err)))
  }

  return (
    <div
      className={`terminal-session${show ? '' : ' is-hidden'}`}
      hidden={!show}
      aria-hidden={!show}
    >
      <div className="terminal-session-actions">
        <button type="button" title="先頭へスクロール" onClick={() => termRef.current?.scrollToTop()}>
          ↑履歴
        </button>
        <button type="button" title="末尾へスクロール" onClick={() => termRef.current?.scrollToBottom()}>
          ↓最新
        </button>
        <button type="button" title="再起動（履歴はクリアされます）" onClick={restart}>
          再起動
        </button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  )
}

export function TerminalPanel({
  open,
  visible = true,
  height,
  cwd,
  pendingCommand,
  onCommandSent,
  onClose,
  embedded = false,
  fitTrigger,
  newTerminalTrigger = 0
}: Props) {
  const [tabs, setTabs] = useState<TermTab[]>(() => {
    const localId = nextLocalId()
    return [{ localId, title: 'ターミナル 1' }]
  })
  const [activeId, setActiveId] = useState(() => tabs[0]?.localId ?? '')
  const [backend, setBackend] = useState<'node-pty' | 'child_process' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastTriggerRef = useRef(newTerminalTrigger)
  const show = open && visible

  useEffect(() => {
    if (!activeId && tabs[0]) setActiveId(tabs[0].localId)
  }, [activeId, tabs])

  useEffect(() => {
    if (newTerminalTrigger <= 0) return
    if (newTerminalTrigger === lastTriggerRef.current) return
    lastTriggerRef.current = newTerminalTrigger
    const localId = nextLocalId()
    const title = `ターミナル ${tabs.length + 1}`
    setTabs((current) => [...current, { localId, title }])
    setActiveId(localId)
  }, [newTerminalTrigger, tabs.length])

  if (!open) return null

  const addTab = () => {
    const localId = nextLocalId()
    setTabs((current) => [...current, { localId, title: `ターミナル ${current.length + 1}` }])
    setActiveId(localId)
  }

  const closeTab = (localId: string) => {
    setTabs((current) => {
      if (current.length <= 1) return current
      const next = current.filter((tab) => tab.localId !== localId)
      if (activeId === localId) {
        setActiveId(next[next.length - 1]?.localId ?? '')
      }
      return next
    })
  }

  return (
    <section
      className={`terminal-panel${embedded ? ' terminal-panel--embedded' : ''}${show ? '' : ' is-hidden'}`}
      style={embedded ? undefined : { height }}
      aria-label="ターミナル"
      aria-hidden={!show}
      hidden={!show}
    >
      {!embedded && (
        <div className="terminal-header">
          <div className="terminal-title">
            <strong>ターミナル</strong>
            <span>
              {cwd ? cwd : 'カレントディレクトリ'}
              {backend ? ` · ${backend}` : ''}
              {' · scrollback 10k'}
            </span>
          </div>
          <div className="terminal-actions">
            {onClose && (
              <button type="button" title="閉じる" onClick={onClose}>
                ×
              </button>
            )}
          </div>
        </div>
      )}
      <div className="terminal-tabs" role="tablist" aria-label="ターミナルタブ">
        {tabs.map((tab) => (
          <div
            key={tab.localId}
            className={`terminal-tab${tab.localId === activeId ? ' active' : ''}`}
            role="tab"
            aria-selected={tab.localId === activeId}
          >
            <button type="button" className="terminal-tab-label" onClick={() => setActiveId(tab.localId)}>
              {tab.title}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                className="terminal-tab-close"
                title="タブを閉じる"
                onClick={() => closeTab(tab.localId)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" className="terminal-tab-add" title="新しいターミナル" onClick={addTab}>
          ＋
        </button>
        {embedded && (
          <span className="terminal-tab-meta">
            {backend ? backend : ''}
          </span>
        )}
      </div>
      {error && <div className="terminal-error">{error}</div>}
      <div className="terminal-sessions">
        {tabs.map((tab) => (
          <TerminalSession
            key={tab.localId}
            active={tab.localId === activeId}
            visible={show}
            cwd={cwd}
            height={height}
            fitTrigger={fitTrigger}
            pendingCommand={tab.localId === activeId ? pendingCommand : null}
            onCommandSent={onCommandSent}
            onBackend={(value) => {
              if (tab.localId === activeId) setBackend(value)
            }}
            onError={(message) => {
              if (tab.localId === activeId) setError(message)
            }}
          />
        ))}
      </div>
    </section>
  )
}
