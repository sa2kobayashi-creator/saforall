import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityBar, type SidebarView } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { SourceControlPanel } from './components/SourceControlPanel'
import { CloneDialog } from './components/CloneDialog'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { StatusBar } from './components/StatusBar'
import { ResizeHandle } from './components/ResizeHandle'
import {
  BottomPanel,
  type BottomPanelTab
} from './components/BottomPanel'
import type { ProblemItem } from './components/ProblemsPanel'
import { ApplyPathDialog } from './components/ApplyPathDialog'
import { UsagePanel } from './components/UsagePanel'
import {
  defaultFileName,
  formatCommandForTerminal,
  isAbsolutePath,
  isSafeAutoShellCommand,
  isShellLanguage,
  joinPath,
  shouldAppendToFile
} from './lib/codeBlocks'
import { languageFromPath } from './lib/language'
import { prefetchAllModelCatalogs } from './lib/modelCatalogCache'
import type {
  ApplyCodeOptions,
  BackendStatus,
  OpenFile,
  WorkspaceRecord
} from './types'
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
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer')
  const [chatOpen, setChatOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [bottomTab, setBottomTab] = useState<BottomPanelTab>('terminal')
  const [scmSyncCommand, setScmSyncCommand] = useState<'pull' | 'push' | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [scmRefreshKey, setScmRefreshKey] = useState(0)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [applyDialog, setApplyDialog] = useState<{
    code: string
    language?: string
    defaultPath: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState('フォルダを開いて始めましょう')
  const [backend, setBackend] = useState<BackendStatus>(initialBackend)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [chatWidth, setChatWidth] = useState(340)
  const [terminalHeight, setTerminalHeight] = useState(220)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})

  const activeFile = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [tabs, activePath]
  )
  const problems = useMemo((): ProblemItem[] => {
    const items: ProblemItem[] = []
    if (!backend.connected && !backend.checking) {
      items.push({
        id: 'backend-offline',
        severity: 'error',
        source: 'Backend',
        message: backend.message || 'バックエンドに接続できません'
      })
    }
    for (const tab of tabs) {
      if (tab.dirty) {
        items.push({
          id: `dirty:${tab.path}`,
          severity: 'warning',
          source: 'Editor',
          message: '未保存の変更があります',
          path: tab.path
        })
      }
    }
    return items
  }, [backend, tabs])
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

  useEffect(() => {
    if (!backend.connected) return
    let cancelled = false
    ;(async () => {
      await prefetchAllModelCatalogs()
      if (!cancelled) {
        window.dispatchEvent(new CustomEvent('saforall-model-catalog-updated', { detail: {} }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backend.connected])

  const openWorkspaceAt = useCallback(
    async (path: string) => {
      setWorkspacePath(path)
      setWorkspaceId(null)
      setTabs([])
      setActivePath(null)
      setTabWidths({})
      setSidebarView('explorer')
      setScmRefreshKey((key) => key + 1)
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
    },
    [backend.connected]
  )

  const openWorkspace = useCallback(async () => {
    const path = await window.saforall.openDirectory()
    if (!path) return
    await openWorkspaceAt(path)
  }, [openWorkspaceAt])

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

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    setStatus(message)
    window.setTimeout(() => {
      setNotice((current) => (current === message ? null : current))
    }, 4000)
  }, [])

  const runCommand = useCallback(
    (code: string, options?: ApplyCodeOptions) => {
      const command = formatCommandForTerminal(code)
      if (!command.trim()) {
        showNotice(
          options?.auto
            ? 'Agent: 実行できないコマンドのためスキップしました'
            : '実行するコマンドが空です'
        )
        return
      }

      // Agent 自動実行は npm/node など安全なコマンドのみ
      if (options?.auto && !isSafeAutoShellCommand(command)) {
        showNotice(
          `Agent: 安全のため自動実行しませんでした（Ask で手動実行可）: ${command.slice(0, 60)}`
        )
        return
      }

      setTerminalOpen(true)
      setBottomTab('terminal')
      setPendingCommand(command)
      showNotice('ターミナルでコマンドを実行します…')
    },
    [showNotice]
  )

  const writeCodeToFile = useCallback(
    async (targetPath: string, code: string) => {
      let existing = ''
      try {
        existing = await window.saforall.readFile(targetPath)
      } catch {
        existing = ''
      }

      const append = shouldAppendToFile(existing, code)
      const content = append
        ? `${existing.replace(/\s*$/, '')}\n\n${code}\n`
        : code

      await window.saforall.writeFile(targetPath, content)
      const next: OpenFile = {
        path: targetPath,
        content,
        language: languageFromPath(targetPath),
        dirty: false
      }
      setTabs((current) => {
        const exists = current.some((tab) => tab.path === targetPath)
        if (exists) {
          return current.map((tab) => (tab.path === targetPath ? next : tab))
        }
        return [...current, next]
      })
      setActivePath(targetPath)
      showNotice(
        append
          ? `追記して保存しました: ${targetPath}`
          : `ファイルに保存しました: ${targetPath}`
      )
    },
    [showNotice]
  )

  const resolveDefaultRelativePath = useCallback(
    (language?: string) => defaultFileName(language),
    []
  )

  const applyCode = useCallback(
    async (
      code: string,
      pathHint?: string,
      language?: string,
      options?: ApplyCodeOptions
    ) => {
      const auto = options?.auto === true

      if (isShellLanguage(language)) {
        runCommand(code, options)
        return
      }

      if (pathHint) {
        if (!workspacePath && !isAbsolutePath(pathHint)) {
          showNotice('相対パスを適用するには、先にフォルダを開いてください')
          return
        }
        const targetPath = isAbsolutePath(pathHint)
          ? pathHint
          : joinPath(workspacePath!, pathHint)
        try {
          await writeCodeToFile(targetPath, code)
        } catch (error) {
          showNotice(`適用失敗: ${String(error)}`)
        }
        return
      }

      if (activePath) {
        try {
          await writeCodeToFile(activePath, code)
        } catch (error) {
          showNotice(`適用失敗: ${String(error)}`)
        }
        return
      }

      if (!workspacePath) {
        showNotice('先に左の「フォルダを開く」でワークスペースを選んでください')
        return
      }

      const suggested = resolveDefaultRelativePath(language)

      // Agent モードはダイアログを出さず既定パスへ自動保存
      if (auto) {
        try {
          await writeCodeToFile(joinPath(workspacePath, suggested), code)
        } catch (error) {
          showNotice(`自動適用失敗: ${String(error)}`)
        }
        return
      }

      setApplyDialog({
        code,
        language,
        defaultPath: suggested
      })
    },
    [
      activePath,
      workspacePath,
      runCommand,
      writeCodeToFile,
      showNotice,
      resolveDefaultRelativePath
    ]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault()
        setBottomTab('terminal')
        setTerminalOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (typeof window.saforall.onMenuCommand !== 'function') return
    const unsubscribe = window.saforall.onMenuCommand((command) => {
      switch (command) {
        case 'workspace:open':
          void openWorkspace()
          break
        case 'file:save':
          void saveFile()
          break
        case 'view:explorer':
          setSidebarView('explorer')
          break
        case 'view:scm':
          setSidebarView('scm')
          setScmRefreshKey((key) => key + 1)
          break
        case 'view:terminal':
          setBottomTab('terminal')
          setTerminalOpen((open) => !open)
          break
        case 'view:problems':
          setBottomTab('problems')
          setTerminalOpen(true)
          break
        case 'view:chat':
          setChatOpen((open) => !open)
          break
        case 'view:settings':
          setSettingsOpen(true)
          break
        case 'view:usage':
          setUsageOpen(true)
          break
        case 'git:clone':
          setCloneOpen(true)
          break
        case 'git:refresh':
          setSidebarView('scm')
          setScmRefreshKey((key) => key + 1)
          break
        case 'git:pull':
          setSidebarView('scm')
          setScmSyncCommand('pull')
          break
        case 'git:push':
          setSidebarView('scm')
          setScmSyncCommand('push')
          break
      }
    })
    return () => {
      unsubscribe()
    }
  }, [openWorkspace, saveFile])

  return (
    <div className="app-shell">
      <div className="app-body">
        <ActivityBar
          activeView={sidebarView}
          chatOpen={chatOpen}
          settingsOpen={settingsOpen}
          usageOpen={usageOpen}
          terminalOpen={terminalOpen}
          onChangeView={(view) => {
            setSidebarView(view)
            if (view === 'scm') setScmRefreshKey((key) => key + 1)
          }}
          onToggleChat={() => setChatOpen((v) => !v)}
          onOpenWorkspace={openWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenUsage={() => setUsageOpen(true)}
          onToggleTerminal={() => {
            setBottomTab('terminal')
            setTerminalOpen((open) => !open)
          }}
        />
        {sidebarView === 'explorer' ? (
          <Sidebar
            workspacePath={workspacePath}
            activePath={activePath}
            width={sidebarWidth}
            onOpenWorkspace={openWorkspace}
            onOpenFile={openFileAt}
          />
        ) : (
          <SourceControlPanel
            workspacePath={workspacePath}
            width={sidebarWidth}
            refreshKey={scmRefreshKey}
            syncCommand={scmSyncCommand}
            onSyncHandled={() => setScmSyncCommand(null)}
            onOpenWorkspace={openWorkspace}
            onClone={() => setCloneOpen(true)}
            onOpenFile={openFileAt}
            onStatusMessage={(message) => {
              setStatus(message)
              showNotice(message)
            }}
          />
        )}
        <ResizeHandle
          direction="horizontal"
          title="サイドバーの幅を変更"
          onResize={(delta) => {
            setSidebarWidth((width) => Math.min(480, Math.max(180, width + delta)))
          }}
        />
        <main className="main-pane">
          <div className="editor-area">
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
          </div>
          {terminalOpen && (
            <>
              <ResizeHandle
                direction="vertical"
                title="下部パネルの高さを変更"
                onResize={(delta) => {
                  setTerminalHeight((height) =>
                    Math.min(Math.floor(window.innerHeight * 0.7), Math.max(120, height - delta))
                  )
                }}
              />
              <BottomPanel
                open={terminalOpen}
                height={terminalHeight}
                activeTab={bottomTab}
                cwd={workspacePath}
                pendingCommand={pendingCommand}
                problems={problems}
                onChangeTab={setBottomTab}
                onCommandSent={() => setPendingCommand(null)}
                onClose={() => setTerminalOpen(false)}
                onOpenFile={openFileAt}
              />
            </>
          )}
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
              workspacePath={workspacePath}
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
        onOpenUsage={() => {
          setSettingsOpen(false)
          setUsageOpen(true)
        }}
      />
      <UsagePanel
        open={usageOpen}
        backendConnected={backend.connected}
        onClose={() => setUsageOpen(false)}
        onOpenSettings={() => {
          setUsageOpen(false)
          setSettingsOpen(true)
        }}
      />
      <ApplyPathDialog
        open={applyDialog !== null}
        defaultPath={applyDialog?.defaultPath ?? 'index.js'}
        onCancel={() => {
          setApplyDialog(null)
          showNotice('適用をキャンセルしました')
        }}
        onConfirm={(relativePath) => {
          if (!applyDialog || !workspacePath) return
          const targetPath = isAbsolutePath(relativePath)
            ? relativePath
            : joinPath(workspacePath, relativePath)
          const { code } = applyDialog
          setApplyDialog(null)
          void writeCodeToFile(targetPath, code).catch((error) => {
            showNotice(`適用失敗: ${String(error)}`)
          })
        }}
      />
      <CloneDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onCloned={(path) => {
          showNotice(`クローン完了: ${path}`)
          void openWorkspaceAt(path)
        }}
      />
      {notice && <div className="app-notice">{notice}</div>}
    </div>
  )
}
