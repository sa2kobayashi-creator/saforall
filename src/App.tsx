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
import { ApplyDiffDialog, type ApplyDiffProposal } from './components/ApplyDiffDialog'
import { PendingEditsBar } from './components/PendingEditsBar'
import { ComposerPanel } from './components/ComposerPanel'
import { QuickOpenDialog } from './components/QuickOpenDialog'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { buildNpmScriptCommand, buildRunFileCommand } from './lib/runCommands'
import type { DebugBreakpointMap, DebugCallFrame } from './lib/debugTypes'
import { loadWorkspaceKeybindings, matchKeybinding } from './lib/keybindings'
import { loadExtensionGrants, saveExtensionGrants } from './lib/extensionPermissions'
import type { ExtensionPermission, WorkspaceExtension } from './types/extensions'
import { UsagePanel } from './components/UsagePanel'
import { WelcomeScreen } from './components/WelcomeScreen'
import {
  AboutDialog,
  DocumentationDialog,
  KeyboardShortcutsDialog,
  LicenseDialog,
  ReportIssueDialog
} from './components/HelpDialogs'
import {
  defaultFileName,
  formatCommandForTerminal,
  isAbsolutePath,
  isSafeAutoShellCommand,
  isShellLanguage,
  joinPath
} from './lib/codeBlocks'
import { planAppliedContent } from './lib/applyContent'
import { languageFromPath } from './lib/language'
import { prefetchAllModelCatalogs } from './lib/modelCatalogCache'
import {
  chatWidthMax,
  CHAT_WIDTH_MIN,
  loadLayoutPrefs,
  saveLayoutPrefs,
  type UsageLayoutMode
} from './lib/layoutPrefs'
import { pushRecentWorkspace, loadLastWorkspace, saveLastWorkspace } from './lib/recentWorkspaces'
import type {
  ApplyCodeOptions,
  BackendStatus,
  EditorSelection,
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
  const initialLayout = loadLayoutPrefs()
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer')
  const [chatOpen, setChatOpen] = useState(initialLayout.chatOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [usageMode, setUsageMode] = useState<UsageLayoutMode>(initialLayout.usageMode)
  const [preferredUsageMode, setPreferredUsageMode] = useState<'right' | 'overlay'>(
    initialLayout.usageMode === 'overlay' ? 'overlay' : 'right'
  )
  const [terminalOpen, setTerminalOpen] = useState(initialLayout.terminalOpen)
  const [bottomTab, setBottomTab] = useState<BottomPanelTab>('terminal')
  const [scmSyncCommand, setScmSyncCommand] = useState<'pull' | 'push' | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [scmRefreshKey, setScmRefreshKey] = useState(0)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [applyDialog, setApplyDialog] = useState<{
    code: string
    language?: string
    defaultPath: string
    review?: boolean
  } | null>(null)
  const [applyQueue, setApplyQueue] = useState<ApplyDiffProposal[]>([])
  const [composerOpen, setComposerOpen] = useState(true)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null)
  const [monacoProblems, setMonacoProblems] = useState<ProblemItem[]>([])
  const [lspProblems, setLspProblems] = useState<ProblemItem[]>([])
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null)
  const [revealLine, setRevealLine] = useState<number | null>(null)
  const [extensions, setExtensions] = useState<WorkspaceExtension[]>([])
  const [extensionGrants, setExtensionGrants] = useState<
    Record<string, ExtensionPermission[]>
  >({})
  const [breakpoints, setBreakpoints] = useState<DebugBreakpointMap>({})
  const [debugRunning, setDebugRunning] = useState(false)
  const [debugPaused, setDebugPaused] = useState(false)
  const [debugPort, setDebugPort] = useState<number | null>(null)
  const [debugFrames, setDebugFrames] = useState<DebugCallFrame[]>([])
  const [debugVariables, setDebugVariables] = useState<
    Array<{ name: string; value: string; type?: string }>
  >([])
  const [debugWatches, setDebugWatches] = useState<
    Array<{ expression: string; value?: string }>
  >([])
  const debugWatchesRef = useRef(debugWatches)
  debugWatchesRef.current = debugWatches
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [pausedLine, setPausedLine] = useState<{ path: string; line: number } | null>(null)
  const [inlineEditTrigger, setInlineEditTrigger] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState('フォルダを開いて始めましょう')
  const [backend, setBackend] = useState<BackendStatus>(initialBackend)
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.sidebarWidth)
  const [chatWidth, setChatWidth] = useState(initialLayout.chatWidth)
  const [usageWidth, setUsageWidth] = useState(initialLayout.usageWidth)
  const [terminalHeight, setTerminalHeight] = useState(initialLayout.terminalHeight)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})

  const usageOpen = usageMode !== 'hidden'
  const usageDocked = usageMode === 'right'
  const usageOverlay = usageMode === 'overlay'
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
    items.push(...monacoProblems)
    items.push(...lspProblems)
    return items
  }, [backend, tabs, monacoProblems, lspProblems])
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
      pushRecentWorkspace(path)
      setStatus(`ワークスペース: ${path}`)
      if (typeof window.saforall.ensureIndex === 'function') {
        void window.saforall.ensureIndex(path).then((summary) => {
          if (summary.ok) {
            setStatus(
              `ワークスペース: ${path} · index ${summary.files ?? 0} files / ${summary.symbols ?? 0} symbols`
            )
          }
        })
      }

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

  const closeWorkspace = useCallback(() => {
    if (typeof window.saforall.unwatchWorkspace === 'function') {
      void window.saforall.unwatchWorkspace()
    }
    setWorkspacePath(null)
    setWorkspaceId(null)
    setTabs([])
    setActivePath(null)
    setTabWidths({})
    setPendingCommand(null)
    setApplyQueue([])
    setEditorSelection(null)
    saveLastWorkspace(null)
    setStatus('フォルダを開いて始めましょう')
  }, [])

  // Reload 後も最後のフォルダを復元
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const last = loadLastWorkspace()
      if (!last) return
      try {
        const info = await window.saforall.stat(last)
        if (cancelled) return
        if (!info.isDirectory) {
          saveLastWorkspace(null)
          return
        }
        await openWorkspaceAt(last)
      } catch {
        if (!cancelled) saveLastWorkspace(null)
      }
    })()
    return () => {
      cancelled = true
    }
    // 起動時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 起動時にオフライン復元した場合、API 接続後に workspace_id を付ける
  useEffect(() => {
    if (!backend.connected || !workspacePath || workspaceId !== null) return
    let cancelled = false
    ;(async () => {
      const result = await window.saforall.request<{ workspace: WorkspaceRecord }>(
        'POST',
        '/workspaces',
        { path: workspacePath }
      )
      if (cancelled) return
      if (result.ok && result.data?.workspace) {
        setWorkspaceId(Number(result.data.workspace.id))
        setStatus(`ワークスペース: ${workspacePath}（DB #${result.data.workspace.id}）`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backend.connected, workspacePath, workspaceId])

  const toggleUsage = useCallback(() => {
    setUsageMode((current) => {
      if (current === 'hidden') {
        return preferredUsageMode
      }
      return 'hidden'
    })
  }, [preferredUsageMode])

  const setUsageLayout = useCallback((mode: UsageLayoutMode) => {
    setUsageMode(mode)
    if (mode === 'right' || mode === 'overlay') {
      setPreferredUsageMode(mode)
    }
  }, [])

  useEffect(() => {
    saveLayoutPrefs({
      chatOpen,
      chatWidth,
      usageMode,
      usageWidth,
      sidebarWidth,
      terminalOpen,
      terminalHeight
    })
  }, [chatOpen, chatWidth, usageMode, usageWidth, sidebarWidth, terminalOpen, terminalHeight])

  const openWorkspace = useCallback(async () => {
    const path = await window.saforall.openDirectory()
    if (!path) return
    await openWorkspaceAt(path)
  }, [openWorkspaceAt])

  const openFileAt = useCallback(async (filePath: string, line?: number) => {
    if (tabsRef.current.some((tab) => tab.path === filePath)) {
      setActivePath(filePath)
      setStatus(filePath)
      setRevealLine(typeof line === 'number' ? line : null)
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
      setRevealLine(typeof line === 'number' ? line : null)
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

  const applyLspEdits = useCallback(
    async (
      edits: Array<{
        path: string
        startLine: number
        startColumn: number
        endLine: number
        endColumn: number
        newText: string
      }>
    ) => {
      if (edits.length === 0) return
      const { applyTextEdits } = await import('./lib/textEdits')
      const byPath = new Map<string, typeof edits>()
      for (const edit of edits) {
        const list = byPath.get(edit.path) ?? []
        list.push(edit)
        byPath.set(edit.path, list)
      }

      for (const [filePath, pathEdits] of Array.from(byPath.entries())) {
        try {
          const open = tabsRef.current.find((tab) => tab.path === filePath)
          const original = open?.content ?? (await window.saforall.readFile(filePath))
          const next = applyTextEdits(original, pathEdits)
          await window.saforall.writeFile(filePath, next)
          setTabs((current) => {
            const exists = current.some((tab) => tab.path === filePath)
            if (exists) {
              return current.map((tab) =>
                tab.path === filePath ? { ...tab, content: next, dirty: false } : tab
              )
            }
            return [
              ...current,
              {
                path: filePath,
                content: next,
                language: languageFromPath(filePath),
                dirty: false
              }
            ]
          })
        } catch (error) {
          showNotice(`リネーム適用失敗: ${filePath} · ${String(error)}`)
        }
      }
      showNotice(`リネームを ${byPath.size} ファイルに適用しました`)
    },
    [showNotice]
  )

  useEffect(() => {
    if (!workspacePath || typeof window.saforall.watchWorkspace !== 'function') return
    void window.saforall.watchWorkspace(workspacePath)
    const off =
      typeof window.saforall.onWorkspaceChanged === 'function'
        ? window.saforall.onWorkspaceChanged((payload) => {
            const changed = payload.path
            setTabs((current) => {
              const hit = current.find((tab) => tab.path === changed)
              if (!hit || hit.dirty) {
                if (hit?.dirty) {
                  showNotice(`外部で変更あり（未保存のため保持）: ${changed}`)
                }
                return current
              }
              void window.saforall.readFile(changed).then((content) => {
                setTabs((tabs) =>
                  tabs.map((tab) =>
                    tab.path === changed ? { ...tab, content, dirty: false } : tab
                  )
                )
                showNotice(`外部変更を再読込: ${changed}`)
              })
              return current
            })
          })
        : null
    return () => {
      off?.()
      void window.saforall.unwatchWorkspace?.()
    }
  }, [workspacePath, showNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (workspacePath) setQuickOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspacePath])

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

  const persistFileContent = useCallback(
    async (targetPath: string, content: string, noticeText: string) => {
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
      showNotice(noticeText)
    },
    [showNotice]
  )

  const buildProposal = useCallback(
    async (targetPath: string, code: string): Promise<ApplyDiffProposal> => {
      let existing = ''
      try {
        const open = tabs.find((tab) => tab.path === targetPath)
        existing = open?.content ?? (await window.saforall.readFile(targetPath))
      } catch {
        existing = ''
      }
      const plan = planAppliedContent(existing, code)
      return {
        targetPath,
        original: plan.original,
        modified: plan.modified,
        mode: plan.mode,
        language: languageFromPath(targetPath)
      }
    },
    [tabs]
  )

  const enqueueOrShowProposal = useCallback(
    (proposal: ApplyDiffProposal, review: boolean) => {
      if (review) {
        setApplyQueue((current) => [...current, proposal])
        setComposerOpen(true)
        showNotice(`変更候補を追加: ${proposal.targetPath}`)
        return
      }
      setApplyQueue([proposal])
      setReviewIndex(0)
      setComposerOpen(true)
    },
    [showNotice]
  )

  const commitProposal = useCallback(
    async (proposal: ApplyDiffProposal) => {
      const label =
        proposal.mode === 'append'
          ? `追記して保存しました: ${proposal.targetPath}`
          : proposal.mode === 'create'
            ? `ファイルを作成しました: ${proposal.targetPath}`
            : `ファイルに保存しました: ${proposal.targetPath}`
      await persistFileContent(proposal.targetPath, proposal.modified, label)
    },
    [persistFileContent]
  )

  const writeCodeToFile = useCallback(
    async (targetPath: string, code: string) => {
      const proposal = await buildProposal(targetPath, code)
      await commitProposal(proposal)
    },
    [buildProposal, commitProposal]
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
      const review = options?.review === true

      if (isShellLanguage(language)) {
        runCommand(code, options)
        return
      }

      const resolveAndApply = async (targetPath: string) => {
        try {
          if (auto && !review) {
            await writeCodeToFile(targetPath, code)
            return
          }
          const proposal = await buildProposal(targetPath, code)
          enqueueOrShowProposal(proposal, review)
        } catch (error) {
          showNotice(`適用失敗: ${String(error)}`)
        }
      }

      if (pathHint) {
        if (!workspacePath && !isAbsolutePath(pathHint)) {
          showNotice('相対パスを適用するには、先にフォルダを開いてください')
          return
        }
        const targetPath = isAbsolutePath(pathHint)
          ? pathHint
          : joinPath(workspacePath!, pathHint)
        await resolveAndApply(targetPath)
        return
      }

      if (activePath) {
        await resolveAndApply(activePath)
        return
      }

      if (!workspacePath) {
        showNotice('先に左の「フォルダを開く」でワークスペースを選んでください')
        return
      }

      const suggested = resolveDefaultRelativePath(language)

      if (auto && !review) {
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
        defaultPath: suggested,
        review
      })
    },
    [
      activePath,
      workspacePath,
      runCommand,
      writeCodeToFile,
      buildProposal,
      enqueueOrShowProposal,
      showNotice,
      resolveDefaultRelativePath
    ]
  )

  const refreshExtensions = useCallback(async () => {
    if (!workspacePath || typeof window.saforall.loadExtensions !== 'function') {
      setExtensions([])
      return
    }
    try {
      const list = await window.saforall.loadExtensions(workspacePath)
      setExtensions(list)
    } catch {
      setExtensions([])
    }
  }, [workspacePath])

  useEffect(() => {
    void refreshExtensions()
  }, [refreshExtensions])

  useEffect(() => {
    if (!workspacePath) {
      setExtensionGrants({})
      return
    }
    setExtensionGrants(loadExtensionGrants(workspacePath))
  }, [workspacePath])

  const grantExtensionPermissions = useCallback(
    (extensionId: string, permissions: ExtensionPermission[]) => {
      if (!workspacePath) return
      setExtensionGrants((current) => {
        const prev = current[extensionId] ?? []
        const merged = Array.from(new Set([...prev, ...permissions]))
        const next = { ...current, [extensionId]: merged }
        saveExtensionGrants(workspacePath, next)
        return next
      })
    },
    [workspacePath]
  )

  const revokeExtensionPermissions = useCallback(
    (extensionId: string) => {
      if (!workspacePath) return
      setExtensionGrants((current) => {
        const next = { ...current }
        delete next[extensionId]
        saveExtensionGrants(workspacePath, next)
        return next
      })
    },
    [workspacePath]
  )

  const toggleBreakpoint = useCallback((path: string, line: number) => {
    setBreakpoints((current) => {
      const entries = current[path] ?? []
      const exists = entries.some((row) => row.line === line)
      const nextEntries = exists
        ? entries.filter((row) => row.line !== line)
        : [...entries, { line }].sort((a, b) => a.line - b.line)
      if (nextEntries.length === 0) {
        const next = { ...current }
        delete next[path]
        return next
      }
      return { ...current, [path]: nextEntries }
    })
  }, [])

  const setBreakpointCondition = useCallback((path: string, line: number, condition: string) => {
    setBreakpoints((current) => {
      const entries = current[path] ?? []
      const nextEntries = entries.map((row) =>
        row.line === line
          ? { ...row, condition: condition.trim() || undefined }
          : row
      )
      return { ...current, [path]: nextEntries }
    })
  }, [])

  const fileUrlToPath = useCallback((url: string): string | null => {
    if (!url) return null
    try {
      if (url.startsWith('file:')) {
        let path = decodeURIComponent(url.replace(/^file:\/\//i, ''))
        if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
        return path.replace(/\//g, '\\')
      }
    } catch {
      return null
    }
    if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/')) return url
    return null
  }, [])

  const startDebug = useCallback(async () => {
    if (!activePath) {
      showNotice('デバッグするファイルを開いてください')
      return
    }
    if (!workspacePath) {
      showNotice('先にフォルダを開いてください')
      return
    }
    const lower = activePath.toLowerCase()
    if (
      !lower.endsWith('.js') &&
      !lower.endsWith('.mjs') &&
      !lower.endsWith('.cjs') &&
      !lower.endsWith('.ts') &&
      !lower.endsWith('.tsx') &&
      !lower.endsWith('.py')
    ) {
      showNotice('ブレークポイント付きデバッグは js/ts/py のみ対応です')
      return
    }

    const bpList = Object.entries(breakpoints).flatMap(([path, entries]) =>
      entries.map((row) => ({ path, line: row.line, condition: row.condition }))
    )

    setTerminalOpen(true)
    setBottomTab('debug')
    setDebugLogs([])
    setDebugFrames([])
    setDebugVariables([])
    setDebugWatches((current) => current.map((row) => ({ ...row, value: undefined })))
    setDebugPaused(false)
    setPausedLine(null)
    setDebugRunning(true)
    showNotice('デバッグセッションを開始しています…')

    const result = await window.saforall.startDebug({
      filePath: activePath,
      cwd: workspacePath,
      breakpoints: bpList
    })

    if (!result.ok) {
      setDebugRunning(false)
      setDebugPort(null)
      showNotice(`デバッグ開始失敗: ${result.error ?? 'unknown'}`)
      return
    }

    setDebugPort(result.port ?? null)
    setDebugLogs((logs) => [
      ...logs,
      `> ${result.display ?? activePath}\n`,
      `Inspector :${result.port ?? '?'}\n`
    ])
    showNotice('デバッグ実行中（停止したら Continue / Step Over）')
  }, [activePath, breakpoints, showNotice, workspacePath])

  const continueDebug = useCallback(async () => {
    const result = await window.saforall.continueDebug()
    if (!result.ok) showNotice(result.error ?? 'Continue に失敗しました')
  }, [showNotice])

  const stepOverDebug = useCallback(async () => {
    const result = await window.saforall.stepOverDebug()
    if (!result.ok) showNotice(result.error ?? 'Step Over に失敗しました')
  }, [showNotice])

  const stopDebug = useCallback(async () => {
    await window.saforall.stopDebug()
    setDebugRunning(false)
    setDebugPaused(false)
    setDebugPort(null)
    setDebugFrames([])
    setDebugVariables([])
    setPausedLine(null)
  }, [])

  useEffect(() => {
    const unsubscribe = window.saforall.onDebugEvent((event) => {
      if (event.type === 'ready') {
        setDebugPort(event.port)
        setDebugRunning(true)
        return
      }
      if (event.type === 'paused') {
        setDebugPaused(true)
        setDebugFrames(event.callFrames)
        setDebugVariables(event.variables ?? [])
        void (async () => {
          const watches = debugWatchesRef.current
          if (watches.length === 0) return
          const next = []
          for (const watch of watches) {
            try {
              const result = await window.saforall.evaluateDebug(watch.expression)
              next.push({
                expression: watch.expression,
                value: result.ok ? result.value : result.error
              })
            } catch (error) {
              next.push({
                expression: watch.expression,
                value: error instanceof Error ? error.message : String(error)
              })
            }
          }
          setDebugWatches(next)
        })()
        const top = event.callFrames[0]
        if (top) {
          const path = fileUrlToPath(top.url)
          if (path) {
            setPausedLine({ path, line: top.lineNumber })
            void openFileAt(path, top.lineNumber)
          }
        }
        setBottomTab('debug')
        setTerminalOpen(true)
        return
      }
      if (event.type === 'resumed') {
        setDebugPaused(false)
        setPausedLine(null)
        return
      }
      if (event.type === 'stdout' || event.type === 'stderr') {
        setDebugLogs((logs) => [...logs, event.text].slice(-400))
        return
      }
      if (event.type === 'error') {
        setDebugLogs((logs) => [...logs, `[error] ${event.message}\n`].slice(-400))
        showNotice(`デバッグ: ${event.message}`)
        return
      }
      if (event.type === 'exited') {
        setDebugRunning(false)
        setDebugPaused(false)
        setDebugPort(null)
        setPausedLine(null)
        setDebugLogs((logs) => [
          ...logs,
          `\n[exit] code=${event.code ?? 'null'}\n`
        ].slice(-400))
      }
    })
    return unsubscribe
  }, [fileUrlToPath, openFileAt, showNotice])

  const runActiveFile = useCallback(
    (inspect = false) => {
      if (inspect) {
        void startDebug()
        return
      }
      if (!activePath) {
        showNotice('実行するファイルを開いてください')
        return
      }
      const command = buildRunFileCommand(activePath, false)
      if (!command) {
        showNotice('このファイル種別の Run は未対応です（js/ts/py/ps1）')
        return
      }
      runCommand(command)
    },
    [activePath, runCommand, showNotice, startDebug]
  )

  const currentProposal =
    applyQueue.length > 0
      ? applyQueue[Math.min(Math.max(reviewIndex, 0), applyQueue.length - 1)]
      : null

  const acceptCurrentProposal = useCallback(async () => {
    if (applyQueue.length === 0) return
    const idx = Math.min(Math.max(reviewIndex, 0), applyQueue.length - 1)
    const proposal = applyQueue[idx]
    try {
      await commitProposal(proposal)
      setApplyQueue((current) => current.filter((_, i) => i !== idx))
      setReviewIndex(0)
    } catch (error) {
      showNotice(`適用失敗: ${String(error)}`)
    }
  }, [applyQueue, reviewIndex, commitProposal, showNotice])

  const rejectCurrentProposal = useCallback(() => {
    if (applyQueue.length === 0) return
    const idx = Math.min(Math.max(reviewIndex, 0), applyQueue.length - 1)
    setApplyQueue((current) => current.filter((_, i) => i !== idx))
    setReviewIndex(0)
  }, [applyQueue.length, reviewIndex])

  const acceptProposalAt = useCallback(
    async (index: number) => {
      const proposal = applyQueue[index]
      if (!proposal) return
      try {
        await commitProposal(proposal)
        setApplyQueue((current) => current.filter((_, i) => i !== index))
        setReviewIndex(0)
      } catch (error) {
        showNotice(`適用失敗: ${String(error)}`)
      }
    },
    [applyQueue, commitProposal, showNotice]
  )

  const rejectProposalAt = useCallback((index: number) => {
    setApplyQueue((current) => current.filter((_, i) => i !== index))
    setReviewIndex(0)
  }, [])

  const acceptAllProposals = useCallback(async () => {
    const queue = [...applyQueue]
    setApplyQueue([])
    setReviewIndex(0)
    for (const proposal of queue) {
      try {
        await commitProposal(proposal)
      } catch (error) {
        showNotice(`適用失敗: ${String(error)}`)
        return
      }
    }
  }, [applyQueue, commitProposal, showNotice])

  const rejectAllProposals = useCallback(() => {
    setApplyQueue([])
    setReviewIndex(0)
    showNotice('変更候補をすべて却下しました')
  }, [showNotice])

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
    if (typeof window.saforall.onLspDiagnostics !== 'function') return
    const unsubscribe = window.saforall.onLspDiagnostics((payload) => {
      setLspProblems(
        (payload.items ?? []).map((row, index) => ({
          id: `lsp:${row.path}:${row.line}:${row.column}:${index}`,
          severity: row.severity,
          source: row.source || 'LSP',
          message: row.message,
          path: row.path,
          line: row.line,
          column: row.column
        }))
      )
    })
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!workspacePath || !activeFile) return
    if (typeof window.saforall.syncLsp !== 'function') return
    const handle = window.setTimeout(() => {
      void window.saforall.syncLsp({
        cwd: workspacePath,
        path: activeFile.path,
        content: activeFile.content
      })
    }, 700)
    return () => window.clearTimeout(handle)
  }, [workspacePath, activeFile?.path, activeFile?.content])

  useEffect(() => {
    let cancelled = false
    let bindings: Awaited<ReturnType<typeof loadWorkspaceKeybindings>> = []
    void loadWorkspaceKeybindings(workspacePath).then((rows) => {
      if (!cancelled) bindings = rows
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (bindings.length === 0) return
      const hit = matchKeybinding(event, bindings)
      if (!hit) return
      event.preventDefault()
      if (hit.command === 'view:chat') setChatOpen((open) => !open)
      if (hit.command === 'view:debug') {
        setBottomTab('debug')
        setTerminalOpen(true)
      }
      if (hit.command === 'view:terminal') setTerminalOpen((open) => !open)
      if (hit.command === 'view:problems') {
        setBottomTab('problems')
        setTerminalOpen(true)
      }
      if (hit.command === 'edit:inline') setInlineEditTrigger((n) => n + 1)
      if (hit.command === 'run:file-inspect') void startDebug()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [workspacePath, startDebug])

  useEffect(() => {
    if (typeof window.saforall.onMenuCommand !== 'function') return
    const unsubscribe = window.saforall.onMenuCommand((command) => {
      switch (command) {
        case 'workspace:open':
          void openWorkspace()
          break
        case 'workspace:close':
          closeWorkspace()
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
          toggleUsage()
          break
        case 'view:usage-right':
          setUsageLayout('right')
          break
        case 'view:usage-overlay':
          setUsageLayout('overlay')
          break
        case 'view:usage-hidden':
          setUsageLayout('hidden')
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
        case 'run:file':
          runActiveFile(false)
          break
        case 'run:file-inspect':
          runActiveFile(true)
          break
        case 'debug:continue':
          void continueDebug()
          break
        case 'debug:stepOver':
          void stepOverDebug()
          break
        case 'debug:stop':
          void stopDebug()
          break
        case 'view:debug':
          setBottomTab('debug')
          setTerminalOpen(true)
          break
        case 'run:npm-start':
          runCommand(buildNpmScriptCommand('start'))
          break
        case 'view:extensions':
          setSidebarView('extensions')
          void refreshExtensions()
          break
        case 'edit:inline':
          setInlineEditTrigger((n) => n + 1)
          break
        case 'agent:bugbot':
          void (async () => {
            if (!workspacePath) {
              showNotice('先にフォルダを開いてください')
              return
            }
            const prepared = await window.saforall.prepareBugbot(workspacePath)
            if (!prepared.ok || !prepared.prompt) {
              showNotice(prepared.error ?? 'Bugbot を開始できません')
              return
            }
            setChatOpen(true)
            setPendingChatPrompt(prepared.prompt)
            showNotice('Bugbot: 差分レビューをチャットで開始します')
          })()
          break
        case 'agent:background': {
          const prompt = window.prompt('Background Agent に依頼する内容')
          if (!prompt?.trim()) break
          setChatOpen(true)
          setPendingChatPrompt(
            `【Background Agent】以下を Agent モードで実行してください。\n\n${prompt.trim()}`
          )
          showNotice('Background Agent をチャットで開始します')
          break
        }
        case 'help:welcome':
          closeWorkspace()
          break
        case 'help:docs':
          setDocsOpen(true)
          break
        case 'help:shortcuts':
          setShortcutsOpen(true)
          break
        case 'help:report':
          setReportOpen(true)
          break
        case 'help:license':
          setLicenseOpen(true)
          break
        case 'help:about':
          setAboutOpen(true)
          break
      }
    })
    return () => {
      unsubscribe()
    }
  }, [
    closeWorkspace,
    continueDebug,
    openWorkspace,
    refreshExtensions,
    runActiveFile,
    runCommand,
    saveFile,
    setUsageLayout,
    showNotice,
    startDebug,
    stepOverDebug,
    stopDebug,
    toggleUsage,
    workspacePath
  ])

  return (
    <div className="app-shell">
      {!workspacePath ? (
        <div className="app-body welcome-body">
          <WelcomeScreen
            backendConnected={backend.connected}
            backendMessage={backend.message}
            onOpenFolder={() => void openWorkspace()}
            onOpenRecent={(path) => void openWorkspaceAt(path)}
            onClone={() => setCloneOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
      ) : (
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
              if (view === 'extensions') void refreshExtensions()
            }}
            onToggleChat={() => setChatOpen((v) => !v)}
            onOpenWorkspace={openWorkspace}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenUsage={toggleUsage}
            onToggleTerminal={() => {
              setBottomTab('terminal')
              setTerminalOpen((open) => !open)
            }}
            onRunFile={() => runActiveFile(false)}
          />
          {sidebarView === 'explorer' ? (
            <Sidebar
              workspacePath={workspacePath}
              activePath={activePath}
              width={sidebarWidth}
              onOpenWorkspace={openWorkspace}
              onOpenFile={openFileAt}
            />
          ) : sidebarView === 'scm' ? (
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
          ) : (
            <div style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              <ExtensionsPanel
                extensions={extensions}
                activeFilePath={activePath}
                workspacePath={workspacePath}
                grants={extensionGrants}
                onGrant={grantExtensionPermissions}
                onRevoke={revokeExtensionPermissions}
                onRefresh={() => void refreshExtensions()}
                onRun={(command) => runCommand(command)}
              />
            </div>
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
              <PendingEditsBar
                count={applyQueue.length}
                currentPath={currentProposal?.targetPath ?? null}
                onReview={() => {
                  setComposerOpen(true)
                  showNotice(
                    applyQueue.length > 0
                      ? 'Composer または差分ダイアログで確認できます'
                      : '変更候補はありません'
                  )
                }}
                onAcceptAll={() => {
                  void acceptAllProposals()
                }}
                onRejectAll={rejectAllProposals}
              />
              <div className="editor-composer-row">
                <EditorPane
                  tabs={tabs}
                  activePath={activePath}
                  tabWidths={tabWidths}
                  onSelectTab={(path) => {
                    setActivePath(path)
                    setStatus(path)
                    setRevealLine(null)
                  }}
                  onCloseTab={closeTab}
                  onResizeTab={(path, width) => {
                    setTabWidths((current) => ({ ...current, [path]: width }))
                  }}
                  onChange={updateContent}
                  onSave={saveFile}
                  onSelectionChange={setEditorSelection}
                  onDiagnostics={setMonacoProblems}
                  onOpenDefinition={(path, line) => {
                    void openFileAt(path, line)
                  }}
                  onApplyLspEdits={(edits) => applyLspEdits(edits)}
                  revealLine={revealLine}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={toggleBreakpoint}
                  pausedLine={pausedLine}
                  inlineEditTrigger={inlineEditTrigger}
                />
                {composerOpen && (
                  <ComposerPanel
                    proposals={applyQueue}
                    activeIndex={Math.min(reviewIndex, Math.max(0, applyQueue.length - 1))}
                    dirtyPaths={tabs.filter((tab) => tab.dirty).map((tab) => tab.path)}
                    onSelect={(index) => setReviewIndex(index)}
                    onAcceptOne={(index) => {
                      void acceptProposalAt(index)
                    }}
                    onRejectOne={rejectProposalAt}
                    onAcceptAll={() => {
                      void acceptAllProposals()
                    }}
                    onRejectAll={rejectAllProposals}
                    onClose={() => setComposerOpen(false)}
                  />
                )}
              </div>
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
                  debug={{
                    running: debugRunning,
                    paused: debugPaused,
                    port: debugPort,
                    frames: debugFrames,
                    variables: debugVariables,
                    watches: debugWatches,
                    breakpoints,
                    logs: debugLogs,
                    breakpointCount: Object.values(breakpoints).reduce(
                      (sum, entries) => sum + entries.length,
                      0
                    ),
                    onContinue: () => {
                      void continueDebug()
                    },
                    onStepOver: () => {
                      void stepOverDebug()
                    },
                    onStop: () => {
                      void stopDebug()
                    },
                    onStart: () => {
                      void startDebug()
                    },
                    onOpenFrame: (frame) => {
                      const path = fileUrlToPath(frame.url)
                      if (path) void openFileAt(path, frame.lineNumber)
                    },
                    onAddWatch: (expression) => {
                      setDebugWatches((current) =>
                        current.some((row) => row.expression === expression)
                          ? current
                          : [...current, { expression }]
                      )
                    },
                    onRemoveWatch: (expression) => {
                      setDebugWatches((current) =>
                        current.filter((row) => row.expression !== expression)
                      )
                    },
                    onSetBreakpointCondition: setBreakpointCondition
                  }}
                  onChangeTab={setBottomTab}
                  onCommandSent={() => setPendingCommand(null)}
                  onClose={() => setTerminalOpen(false)}
                  onOpenFile={openFileAt}
                />
              </>
            )}
          </main>
          {chatOpen ? (
            <>
              <ResizeHandle
                direction="horizontal"
                title="チャットの幅を変更（左へ＝チャット拡大／右へ＝エディタ拡大）"
                onResize={(delta) => {
                  const reservedLeft =
                    48 + sidebarWidth + 4 + (usageMode === 'right' ? usageWidth + 4 : 0)
                  const max = chatWidthMax(reservedLeft)
                  setChatWidth((width) =>
                    Math.min(max, Math.max(CHAT_WIDTH_MIN, width - delta))
                  )
                }}
              />
              <ChatPanel
                file={activeFile}
                openFiles={tabs}
                selection={editorSelection}
                problems={problems}
                backendConnected={backend.connected}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                width={chatWidth}
                pendingPrompt={pendingChatPrompt}
                onPendingPromptConsumed={() => setPendingChatPrompt(null)}
                onApplyCode={applyCode}
              />
            </>
          ) : (
            <button
              type="button"
              className="chat-collapsed-rail"
              title="AI チャットを表示"
              onClick={() => setChatOpen(true)}
            >
              AI
            </button>
          )}
          {usageDocked && (
            <>
              <ResizeHandle
                direction="horizontal"
                title="使用量パネルの幅を変更"
                onResize={(delta) => {
                  setUsageWidth((width) => Math.min(520, Math.max(240, width - delta)))
                }}
              />
              <UsagePanel
                open
                variant="dock"
                width={usageWidth}
                backendConnected={backend.connected}
                onClose={() => setUsageLayout('hidden')}
                onOpenSettings={() => {
                  setUsageLayout('hidden')
                  setSettingsOpen(true)
                }}
              />
            </>
          )}
        </div>
      )}
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
          setUsageLayout(preferredUsageMode)
        }}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <DocumentationDialog open={docsOpen} onClose={() => setDocsOpen(false)} />
      <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
      <LicenseDialog open={licenseOpen} onClose={() => setLicenseOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {usageOverlay && (
        <UsagePanel
          open
          variant="overlay"
          backendConnected={backend.connected}
          onClose={() => setUsageLayout('hidden')}
          onOpenSettings={() => {
            setUsageLayout('hidden')
            setSettingsOpen(true)
          }}
        />
      )}
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
          const { code, review } = applyDialog
          setApplyDialog(null)
          void (async () => {
            try {
              const proposal = await buildProposal(targetPath, code)
              enqueueOrShowProposal(proposal, review === true)
            } catch (error) {
              showNotice(`適用失敗: ${String(error)}`)
            }
          })()
        }}
      />
      <ApplyDiffDialog
        open={currentProposal !== null}
        proposal={currentProposal}
        queueCount={applyQueue.length}
        queueIndex={Math.min(reviewIndex, Math.max(0, applyQueue.length - 1))}
        acceptLabel={applyQueue.length > 1 ? 'この変更を適用' : '適用する'}
        onAccept={() => {
          void acceptCurrentProposal()
        }}
        onReject={rejectCurrentProposal}
        onAcceptAll={applyQueue.length > 1 ? () => void acceptAllProposals() : undefined}
        onRejectAll={applyQueue.length > 1 ? rejectAllProposals : undefined}
      />
      <QuickOpenDialog
        open={quickOpen}
        workspacePath={workspacePath}
        onClose={() => setQuickOpen(false)}
        onOpenFile={(path) => {
          void openFileAt(path)
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
