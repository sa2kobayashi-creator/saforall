import Editor from '@monaco-editor/react'
import type { OpenFile } from '../types'
import './EditorPane.css'

type Props = {
  file: OpenFile | null
  onChange: (content: string) => void
  onSave: () => void
}

export function EditorPane({ file, onChange, onSave }: Props) {
  if (!file) {
    return (
      <div className="editor-empty">
        <h1>saforall</h1>
        <p>AI コードエディタの土台です。左からフォルダとファイルを開いてください。</p>
        <p className="hint">保存: Ctrl / Cmd + S（フォーカス時）</p>
      </div>
    )
  }

  const fileName = file.path.split(/[/\\]/).pop()

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
        <div className={`editor-tab ${file.dirty ? 'dirty' : ''}`}>
          {fileName}
          {file.dirty ? ' •' : ''}
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
