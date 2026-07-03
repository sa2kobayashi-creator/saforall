import { useCallback, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { StatusBar } from './components/StatusBar'
import type { OpenFile } from './types'
import './App.css'

function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    yml: 'yaml',
    yaml: 'yaml'
  }
  return map[ext ?? ''] ?? 'plaintext'
}

export default function App() {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [status, setStatus] = useState('フォルダを開いて始めましょう')

  const openWorkspace = useCallback(async () => {
    const path = await window.saforall.openDirectory()
    if (!path) return
    setWorkspacePath(path)
    setOpenFile(null)
    setStatus(`ワークスペース: ${path}`)
  }, [])

  const openFileAt = useCallback(async (filePath: string) => {
    try {
      const content = await window.saforall.readFile(filePath)
      setOpenFile({
        path: filePath,
        content,
        language: languageFromPath(filePath),
        dirty: false
      })
      setStatus(filePath)
    } catch (error) {
      setStatus(`読み込み失敗: ${String(error)}`)
    }
  }, [])

  const updateContent = useCallback((content: string) => {
    setOpenFile((current) =>
      current ? { ...current, content, dirty: true } : current
    )
  }, [])

  const saveFile = useCallback(async () => {
    if (!openFile) return
    try {
      await window.saforall.writeFile(openFile.path, openFile.content)
      setOpenFile((current) => (current ? { ...current, dirty: false } : current))
      setStatus(`保存しました: ${openFile.path}`)
    } catch (error) {
      setStatus(`保存失敗: ${String(error)}`)
    }
  }, [openFile])

  return (
    <div className="app-shell">
      <div className="app-body">
        <ActivityBar
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
          onOpenWorkspace={openWorkspace}
        />
        <Sidebar
          workspacePath={workspacePath}
          activePath={openFile?.path ?? null}
          onOpenWorkspace={openWorkspace}
          onOpenFile={openFileAt}
        />
        <main className="main-pane">
          <EditorPane
            file={openFile}
            onChange={updateContent}
            onSave={saveFile}
          />
        </main>
        {chatOpen && <ChatPanel file={openFile} />}
      </div>
      <StatusBar message={status} dirty={openFile?.dirty ?? false} />
    </div>
  )
}
