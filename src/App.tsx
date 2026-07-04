import { useCallback, useEffect, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { StatusBar } from './components/StatusBar'
import type { BackendStatus, OpenFile, WorkspaceRecord } from './types'
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

const initialBackend: BackendStatus = {
  connected: false,
  checking: true,
  message: 'バックエンド確認中…',
  baseUrl: ''
}

export default function App() {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState('フォルダを開いて始めましょう')
  const [backend, setBackend] = useState<BackendStatus>(initialBackend)

  const checkBackend = useCallback(async () => {
    setBackend((current) => ({ ...current, checking: true }))
    try {
      const result = await window.saforall.health()
      setBackend({
        connected: result.connected,
        checking: false,
        message: result.message,
        baseUrl: result.baseUrl
      })
      if (!result.connected) {
        setStatus((current) =>
          current.startsWith('バックエンド') || current === 'フォルダを開いて始めましょう'
            ? `${result.message}（編集は利用できます）`
            : current
        )
      }
    } catch (error) {
      setBackend({
        connected: false,
        checking: false,
        message: String(error),
        baseUrl: ''
      })
    }
  }, [])

  useEffect(() => {
    void checkBackend()
    const timer = window.setInterval(() => {
      void checkBackend()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [checkBackend])

  const openWorkspace = useCallback(async () => {
    const path = await window.saforall.openDirectory()
    if (!path) return
    setWorkspacePath(path)
    setWorkspaceId(null)
    setOpenFile(null)
    setStatus(`ワークスペース: ${path}`)

    if (!backend.connected) return

    const result = await window.saforall.request<{ workspace: WorkspaceRecord }>(
      'POST',
      '/workspaces',
      { path }
    )
    if (result.ok && result.data?.workspace) {
      setWorkspaceId(Number(result.data.workspace.id))
      setStatus(`ワークスペース: ${path}（DB #${result.data.workspace.id}）`)
    }
  }, [backend.connected])

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
          settingsOpen={settingsOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
          onOpenWorkspace={openWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
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
        {chatOpen && (
          <ChatPanel
            file={openFile}
            backendConnected={backend.connected}
            workspaceId={workspaceId}
          />
        )}
      </div>
      <StatusBar
        message={status}
        dirty={openFile?.dirty ?? false}
        backend={backend}
        onRecheckBackend={() => {
          void checkBackend()
        }}
      />
      <SettingsPanel
        open={settingsOpen}
        backendConnected={backend.connected}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
