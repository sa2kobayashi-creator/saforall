import Editor from '@monaco-editor/react'
import { useRef } from 'react'
import type { OpenFile } from '../types'
import './EditorPane.css'

type Props = {
  tabs: OpenFile[]
  activePath: string | null
  tabWidths: Record<string, number>
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onResizeTab: (path: string, width: number) => void
  onChange: (content: string) => void
  onSave: () => void
}

const DEFAULT_TAB_WIDTH = 160
const MIN_TAB_WIDTH = 88
const MAX_TAB_WIDTH = 480

export function EditorPane({
  tabs,
  activePath,
  tabWidths,
  onSelectTab,
  onCloseTab,
  onResizeTab,
  onChange,
  onSave
}: Props) {
  const file = tabs.find((tab) => tab.path === activePath) ?? null
  const dragRef = useRef<{ path: string; startX: number; startWidth: number } | null>(
    null
  )

  if (tabs.length === 0 || !file) {
    return (
      <div className="editor-empty">
        <h1>saforall</h1>
        <p>左のツリーからファイルを開くと、タブで複数編集できます。</p>
        <p className="hint">保存: Ctrl / Cmd + S（フォーカス時）</p>
        <p className="hint">タブ右端をドラッグすると幅を変更できます</p>
      </div>
    )
  }

  return (
    <div
      className="editor-pane"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSave()
        }
      }}
    >
      <div className="editor-tabs">
        <div className="editor-tab-list">
          {tabs.map((tab) => {
            const name = tab.path.split(/[/\\]/).pop()
            const active = tab.path === activePath
            const width = tabWidths[tab.path] ?? DEFAULT_TAB_WIDTH
            return (
              <div
                key={tab.path}
                className={`editor-tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}`}
                style={{ width }}
              >
                <button
                  type="button"
                  className="editor-tab-label"
                  onClick={() => onSelectTab(tab.path)}
                  title={tab.path}
                >
                  {name}
                  {tab.dirty ? ' •' : ''}
                </button>
                <button
                  type="button"
                  className="editor-tab-close"
                  title="閉じる"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.path)
                  }}
                >
                  ×
                </button>
                <div
                  className="editor-tab-resize"
                  title="幅を変更"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    dragRef.current = {
                      path: tab.path,
                      startX: event.clientX,
                      startWidth: width
                    }

                    const onMove = (moveEvent: MouseEvent) => {
                      const drag = dragRef.current
                      if (!drag) return
                      const next = Math.min(
                        MAX_TAB_WIDTH,
                        Math.max(
                          MIN_TAB_WIDTH,
                          drag.startWidth + (moveEvent.clientX - drag.startX)
                        )
                      )
                      onResizeTab(drag.path, next)
                    }

                    const onUp = () => {
                      dragRef.current = null
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                      document.body.style.cursor = ''
                      document.body.style.userSelect = ''
                    }

                    document.body.style.cursor = 'col-resize'
                    document.body.style.userSelect = 'none'
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                />
              </div>
            )
          })}
        </div>
        <button type="button" className="save-btn" onClick={onSave}>
          保存
        </button>
      </div>
      <div className="editor-host">
        <Editor
          path={file.path}
          language={file.language}
          value={file.content}
          theme="vs-dark"
          onChange={(value) => onChange(value ?? '')}
          options={{
            fontSize: 14,
            fontFamily: 'Cascadia Code, Consolas, monospace',
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2
          }}
        />
      </div>
    </div>
  )
}
