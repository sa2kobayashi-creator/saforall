import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { StatusBar } from './components/StatusBar'
import { ResizeHandle } from './components/ResizeHandle'
import { isAbsolutePath, joinPath } from './lib/codeBlocks'
import { languageFromPath } from './lib/language'
import type { BackendStatus, OpenFile, WorkspaceRecord } from './types'
import './App.css'

const initialBackend: BackendStatus = {
  connected: false,
  checking: true,
  message: 'バックエンド確認中…',
  baseUrl: ''
}

export default function App() {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState('フォルダを開いて始めましょう')
  const [backend, setBackend] = useState<BackendStatus>(initialBackend)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [chatWidth, setChatWidth] = useState(340)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})

  const activeFile = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [tabs, activePath]
  )
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

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
    setTabs([])
    setActivePath(null)
    setTabWidths({})
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
    if (tabsRef.current.some((tab) => tab.path === filePath)) {
      setActivePath(filePath)
      setStatus(filePath)
      return
    }

    try {
      const content = await window.saforall.readFile(filePath)
      const next: OpenFile = {
        path: filePath,
        content,
        language: languageFromPath(filePath),
        dirty: false
      }
      setTabs((current) =>
        current.some((tab) => tab.path === filePath) ? current : [...current, next]
      )
      setActivePath(filePath)
      setStatus(filePath)
    } catch (error) {
      setStatus(`読み込み失敗: ${String(error)}`)
    }
  }, [])

  const updateContent = useCallback(
    (content: string) => {
      if (!activePath) return
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activePath ? { ...tab, content, dirty: true } : tab
        )
      )
    },
    [activePath]
  )

  const saveFile = useCallback(async () => {
    if (!activeFile) return
    try {
      await window.saforall.writeFile(activeFile.path, activeFile.content)
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activeFile.path ? { ...tab, dirty: false } : tab
        )
      )
      setStatus(`保存しました: ${activeFile.path}`)
    } catch (error) {
      setStatus(`保存失敗: ${String(error)}`)
    }
  }, [activeFile])

  const closeTab = useCallback(
    (path: string) => {
      const target = tabs.find((tab) => tab.path === path)
      if (target?.dirty) {
        const ok = window.confirm(
          `「${path.split(/[/\\]/).pop()}」は未保存です。閉じますか？`
        )
        if (!ok) return
      }

      setTabs((current) => {
        const next = current.filter((tab) => tab.path !== path)
        if (activePath === path) {
          const index = current.findIndex((tab) => tab.path === path)
          const fallback = next[index] ?? next[index - 1] ?? null
          setActivePath(fallback?.path ?? null)
          setStatus(fallback?.path ?? 'タブを閉じました')
        }
        return next
      })
      setTabWidths((current) => {
        const next = { ...current }
        delete next[path]
        return next
      })
    },
    [tabs, activePath]
  )

  const applyCode = useCallback(
    (code: string, pathHint?: string) => {
      let targetPath = activePath

      if (pathHint) {
        if (isAbsolutePath(pathHint)) {
          targetPath = pathHint
        } else if (workspacePath) {
          targetPath = joinPath(workspacePath, pathHint)
        } else {
          setStatus('相対パスを適用するにはワークスペースを開いてください')
          return
        }
      }

      if (!targetPath) {
        setStatus('適用先がありません。ファイルを開くか、コードブロックにパスを付けてください')
        return
      }

      setTabs((current) => {
        const exists = current.some((tab) => tab.path === targetPath)
        if (exists) {
          return current.map((tab) =>
            tab.path === targetPath
              ? { ...tab, content: code, dirty: true }
              : tab
          )
        }

        return [
          ...current,
          {
            path: targetPath,
            content: code,
            language: languageFromPath(targetPath),
            dirty: true
          }
        ]
      })
      setActivePath(targetPath)
      setStatus(`コードを適用しました: ${targetPath}（未保存）`)
    },
    [activePath, workspacePath]
  )

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
          activePath={activePath}
          width={sidebarWidth}
          onOpenWorkspace={openWorkspace}
          onOpenFile={openFileAt}
        />
        <ResizeHandle
          direction="horizontal"
          title="エクスプローラの幅を変更"
          onResize={(delta) => {
            setSidebarWidth((width) => Math.min(480, Math.max(180, width + delta)))
          }}
        />
        <main className="main-pane">
          <EditorPane
            tabs={tabs}
            activePath={activePath}
            tabWidths={tabWidths}
            onSelectTab={(path) => {
              setActivePath(path)
              setStatus(path)
            }}
            onCloseTab={closeTab}
            onResizeTab={(path, width) => {
              setTabWidths((current) => ({ ...current, [path]: width }))
            }}
            onChange={updateContent}
            onSave={saveFile}
          />
        </main>
        {chatOpen && (
          <>
            <ResizeHandle
              direction="horizontal"
              title="チャットの幅を変更"
              onResize={(delta) => {
                // 左境界をドラッグするので、右へ動かすとチャットは狭くなる
                setChatWidth((width) => Math.min(640, Math.max(280, width - delta)))
              }}
            />
            <ChatPanel
              file={activeFile}
              backendConnected={backend.connected}
              workspaceId={workspaceId}
              width={chatWidth}
              onApplyCode={applyCode}
            />
          </>
        )}
      </div>
      <StatusBar
        message={status}
        dirty={activeFile?.dirty ?? false}
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
