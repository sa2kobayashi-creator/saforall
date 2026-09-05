import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityBar, type SidebarView } from './components/ActivityBar'
import { RulesPanel } from './components/RulesPanel'
import { Sidebar } from './components/Sidebar'
import { SearchPanel } from './components/SearchPanel'
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
import { ScmDiffDialog, type ScmDiffView } from './components/ScmDiffDialog'
import { PendingEditsBar } from './components/PendingEditsBar'
import { ComposerPanel } from './components/ComposerPanel'
import { QuickOpenDialog } from './components/QuickOpenDialog'
import { CommandPalette, BUILTIN_PALETTE_COMMANDS } from './components/CommandPalette'
import { SymbolPickerDialog } from './components/SymbolPickerDialog'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { resolveProblemOpenPath } from './lib/problemPaths'
import { buildBackendOfflineMessage } from './lib/backendGuide'
import { buildNpmScriptCommand, buildRunFileCommand } from './lib/runCommands'
import type { DebugBreakpointMap, DebugCallFrame } from './lib/debugTypes'
import { loadWorkspaceKeybindings, matchKeybinding } from './lib/keybindings'
import { loadAutoSaveDelayMs, loadAutoSaveEnabled } from './lib/autoSave'
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
import {
  acceptAllProposalsCollected,
  suggestPostApplyVerifyFromScripts,
  validateProposal
} from './lib/applyProposals'
import { languageFromPath } from './lib/language'
import { prefetchAllModelCatalogs } from './lib/modelCatalogCache'
import { parseLocale, useI18n } from './i18n'
import { mergeProblems } from './lib/problems'
import {
  chatWidthMax,
  CHAT_WIDTH_MIN,
  loadLayoutPrefs,
  saveLayoutPrefs,
  terminalHeightMax,
  TERMINAL_HEIGHT_MIN,
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
  const { setLocale } = useI18n()
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
  const [terminalMounted, setTerminalMounted] = useState(initialLayout.terminalOpen)
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
  const [scmDiff, setScmDiff] = useState<ScmDiffView | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => loadAutoSaveEnabled())
  const [autoSaveDelayMs, setAutoSaveDelayMs] = useState(() => loadAutoSaveDelayMs())
  const [composerOpen, setComposerOpen] = useState(true)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [newTerminalTrigger, setNewTerminalTrigger] = useState(0)
  const runAppCommandRef = useRef<(command: string) => void>(() => undefined)
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null)
  const [monacoProblems, setMonacoProblems] = useState<ProblemItem[]>([])
  const [lspProblems, setLspProblems] = useState<ProblemItem[]>([])
  const [bugbotProblems, setBugbotProblems] = useState<ProblemItem[]>([])
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null)
  const [revealLine, setRevealLine] = useState<number | null>(null)
  const [extensions, setExtensions] = useState<WorkspaceExtension[]>([])
  const [extensionGrants, setExtensionGrants] = useState<
    Record<string, ExtensionPermission[]>
  >({})
  const [breakpoints, setBreakpoints] = useState<DebugBreakpointMap>({})
  const [exceptionBreakMode, setExceptionBreakMode] = useState<
    'none' | 'uncaught' | 'all'
  >('uncaught')
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
  const [referenceHits, setReferenceHits] = useState<
    Array<{ path: string; line: number; column: number; endLine?: number; endColumn?: number }>
  >([])
  const [referenceSymbol, setReferenceSymbol] = useState<string | null>(null)
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [inlineEditTrigger, setInlineEditTrigger] = useState(0)
  const [peekDefinitionTrigger, setPeekDefinitionTrigger] = useState(0)
  const [peekReferencesTrigger, setPeekReferencesTrigger] = useState(0)
  const [symbolPicker, setSymbolPicker] = useState<'document' | 'workspace' | null>(null)
  const [splitPath, setSplitPath] = useState<string | null>(null)
  const [editorFocusGroup, setEditorFocusGroup] = useState<'primary' | 'secondary'>('primary')
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
        message:
          backend.message ||
          buildBackendOfflineMessage(backend.baseUrl)
      })
    }
    items.push(...monacoProblems)
    items.push(...lspProblems)
    items.push(...bugbotProblems)
    return mergeProblems(items)
  }, [backend, monacoProblems, lspProblems, bugbotProblems])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath

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
      try {
        const result = await window.saforall.request<{
          settings: Record<string, string | boolean>
        }>('GET', '/settings')
        if (cancelled || !result.ok || !result.data?.settings) return
        const value = result.data.settings['app.locale']
        if (typeof value === 'string') setLocale(parseLocale(value))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backend.connected, setLocale])

  const openWorkspaceAt = useCallback(
    async (path: string) => {
      if (typeof window.saforall.resetLsp === 'function') {
        void window.saforall.resetLsp()
      }
      setLspProblems([])
      setMonacoProblems([])
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
    if (typeof window.saforall.resetLsp === 'function') {
      void window.saforall.resetLsp()
    }
    setLspProblems([])
    setMonacoProblems([])
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
    if (terminalOpen) setTerminalMounted(true)
  }, [terminalOpen])

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
    const absolute = resolveProblemOpenPath(workspacePath, filePath)
    if (tabsRef.current.some((tab) => tab.path === absolute)) {
      setActivePath(absolute)
      setStatus(absolute)
      setRevealLine(typeof line === 'number' ? line : null)
      return
    }

    try {
      const content = await window.saforall.readFile(absolute)
      const next: OpenFile = {
        path: absolute,
        content,
        language: languageFromPath(absolute),
        dirty: false
      }
      setTabs((current) =>
        current.some((tab) => tab.path === absolute) ? current : [...current, next]
      )
      setActivePath(absolute)
      setStatus(absolute)
      setRevealLine(typeof line === 'number' ? line : null)
    } catch (error) {
      setStatus(`読み込み失敗: ${String(error)}`)
    }
  }, [workspacePath])

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

  const updateContentAt = useCallback((path: string | null, content: string) => {
    if (!path) return
    setTabs((current) =>
      current.map((tab) => (tab.path === path ? { ...tab, content, dirty: true } : tab))
    )
  }, [])

  const saveFile = useCallback(async () => {
    if (!activeFile) return
    try {
      await window.saforall.writeFile(activeFile.path, activeFile.content)
      if (workspacePath && typeof window.saforall.recordLocalHistory === 'function') {
        try {
          await window.saforall.recordLocalHistory({
            cwd: workspacePath,
            path: activeFile.path,
            content: activeFile.content,
            label: 'save'
          })
          setHistoryRefreshKey((n) => n + 1)
        } catch {
          // history is best-effort
        }
      }
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activeFile.path ? { ...tab, dirty: false } : tab
        )
      )
      setStatus(`保存しました: ${activeFile.path}`)
    } catch (error) {
      setStatus(`保存失敗: ${String(error)}`)
    }
  }, [activeFile, workspacePath])

  useEffect(() => {
    if (!autoSaveEnabled || !activeFile?.dirty) return
    const timer = window.setTimeout(() => {
      void saveFile()
    }, autoSaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, autoSaveDelayMs, activeFile?.path, activeFile?.content, activeFile?.dirty, saveFile])

  useEffect(() => {
    const onStorage = () => {
      setAutoSaveEnabled(loadAutoSaveEnabled())
      setAutoSaveDelayMs(loadAutoSaveDelayMs())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

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
      setSplitPath((current) => (current === path ? null : current))
      if (typeof window.saforall.closeLsp === 'function') {
        void window.saforall.closeLsp({ path })
      }
      setLspProblems((current) => current.filter((row) => row.path !== path))
      setMonacoProblems((current) => current.filter((row) => row.path !== path))
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
        if (event.shiftKey) {
          setCommandPaletteOpen(true)
          return
        }
        if (workspacePath) setQuickOpen(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setSymbolPicker('document')
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        if (workspacePath) setSymbolPicker('workspace')
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
        event.preventDefault()
        setSplitPath((current) => {
          if (current) return null
          const active = activePathRef.current
          const other = tabsRef.current.find((tab) => tab.path !== active)?.path
          return other ?? active
        })
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
    async (
      targetPath: string,
      code: string,
      options?: { forceReplace?: boolean; source?: ApplyDiffProposal['source'] }
    ): Promise<ApplyDiffProposal> => {
      let existing = ''
      try {
        const open = tabs.find((tab) => tab.path === targetPath)
        existing = open?.content ?? (await window.saforall.readFile(targetPath))
      } catch {
        existing = ''
      }
      const plan = planAppliedContent(existing, code, {
        preferReplace: options?.forceReplace === true
      })
      return {
        targetPath,
        original: plan.original,
        modified: plan.modified,
        mode: plan.mode,
        language: languageFromPath(targetPath),
        source: options?.source
      }
    },
    [tabs]
  )

  const enqueueOrShowProposal = useCallback(
    (proposal: ApplyDiffProposal, review: boolean) => {
      if (review) {
        setApplyQueue((current) => {
          const without = current.filter((row) => row.targetPath !== proposal.targetPath)
          return [...without, proposal]
        })
        setComposerOpen(true)
        showNotice(`変更候補を更新: ${proposal.targetPath}`)
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
      const check = validateProposal(proposal, { workspacePath })
      if (!check.ok) {
        throw new Error(check.message)
      }
      const label =
        proposal.mode === 'append'
          ? `追記して保存しました: ${proposal.targetPath}`
          : proposal.mode === 'create'
            ? `ファイルを作成しました: ${proposal.targetPath}`
            : `ファイルに保存しました: ${proposal.targetPath}`
      await persistFileContent(proposal.targetPath, proposal.modified, label)
    },
    [persistFileContent, workspacePath]
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
          const proposal = await buildProposal(targetPath, code, {
            forceReplace: options?.forceReplace === true,
            source: options?.forceReplace ? 'agent' : 'chat'
          })
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
      breakpoints: bpList,
      exceptionBreakMode
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
  }, [activePath, breakpoints, exceptionBreakMode, showNotice, workspacePath])

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
    if (queue.length === 0) return
    setApplyQueue([])
    setReviewIndex(0)
    const result = await acceptAllProposalsCollected(
      queue,
      async (proposal) => {
        await commitProposal(proposal as ApplyDiffProposal)
      },
      { workspacePath }
    )
    if (result.remaining.length > 0) {
      setApplyQueue(result.remaining as ApplyDiffProposal[])
    }
    let notice = result.summary
    if (result.ok && workspacePath) {
      try {
        const pkgPath = joinPath(workspacePath, 'package.json')
        const raw = await window.saforall.readFile(pkgPath)
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
        const verify = suggestPostApplyVerifyFromScripts(pkg.scripts)
        if (verify) {
          notice += ` · 検証実行: ${verify.primary}`
          runCommand(verify.primary, { auto: true })
        }
      } catch {
        // ignore missing package.json / parse errors
      }
    }
    showNotice(notice)
  }, [applyQueue, commitProposal, showNotice, workspacePath, runCommand])

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
        (payload.items ?? []).map((row) => ({
          id: `lsp:${row.path}:${row.line}:${row.column}:${row.message}`,
          severity: row.severity,
          source: row.source || 'tsserver',
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
    const run = (command: string) => {
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
        case 'view:search':
          setSidebarView('search')
          break
        case 'view:scm':
          setSidebarView('scm')
          setScmRefreshKey((key) => key + 1)
          break
        case 'view:terminal':
          setBottomTab('terminal')
          setTerminalOpen((open) => !open)
          break
        case 'terminal:new':
          setBottomTab('terminal')
          setTerminalOpen(true)
          setNewTerminalTrigger((n) => n + 1)
          break
        case 'view:commands':
          setCommandPaletteOpen(true)
          break
        case 'go:symbolInFile':
          setSymbolPicker('document')
          break
        case 'go:workspaceSymbol':
          if (workspacePath) setSymbolPicker('workspace')
          else showNotice('先にフォルダを開いてください')
          break
        case 'go:peekDefinition':
          setPeekDefinitionTrigger((n) => n + 1)
          break
        case 'go:peekReferences':
          setPeekReferencesTrigger((n) => n + 1)
          break
        case 'view:splitEditor':
          setSplitPath((current) => {
            if (current) return null
            const active = activePathRef.current
            const other = tabsRef.current.find((tab) => tab.path !== active)?.path
            return other ?? active
          })
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
            const findings = prepared.findings ?? []
            setBugbotProblems(
              findings.map((row, index) => ({
                id: `bugbot-${index}-${row.path}-${row.line ?? 0}`,
                severity: row.severity,
                source: 'Bugbot',
                message: `${row.title}: ${row.detail}`,
                path: row.path,
                line: row.line
              }))
            )
            if (typeof window.saforall.enqueueJob === 'function') {
              try {
                await window.saforall.enqueueJob({
                  kind: 'bugbot',
                  title: `Bugbot · ${findings.length} findings`,
                  prompt: prepared.prompt,
                  cwd: workspacePath
                })
              } catch {
                // chat path still works without job tracking
              }
            }
            setChatOpen(true)
            setPendingChatPrompt(prepared.prompt)
            setTerminalOpen(true)
            setBottomTab('problems')
            showNotice(
              findings.length > 0
                ? `Bugbot: ヒューリスティック ${findings.length} 件 + チャットレビュー`
                : 'Bugbot: 差分レビューをチャットで開始します'
            )
            if (
              findings.length > 0 &&
              typeof window.saforall.postPrReview === 'function' &&
              window.confirm('GitHub の現在 PR に Bugbot findings をコメントしますか？')
            ) {
              const posted = await window.saforall.postPrReview({
                cwd: workspacePath,
                findings,
                body: 'Bugbot findings from saforall'
              })
              showNotice(
                posted.ok
                  ? `PR #${posted.prNumber ?? '?'} に findings を投稿しました`
                  : `PR 投稿スキップ/失敗: ${posted.error ?? 'unknown'}`
              )
            }
          })()
          break
        case 'agent:background': {
          void (async () => {
            const prompt = window.prompt('Background Agent に依頼する内容')
            if (!prompt?.trim()) return
            if (!workspacePath) {
              showNotice('先にフォルダを開いてください')
              return
            }
            if (typeof window.saforall.enqueueJob === 'function') {
              try {
                const job = await window.saforall.enqueueJob({
                  kind: 'agent',
                  title: prompt.trim().slice(0, 60),
                  prompt: prompt.trim(),
                  cwd: workspacePath
                })
                setChatOpen(true)
                setPendingChatPrompt(
                  `【Background Agent · ${job.id}】Agent モードで実行してください。\n\n${prompt.trim()}`
                )
                showNotice(`Background Job を開始: ${job.id}`)
                return
              } catch (error) {
                showNotice(`Job 開始失敗: ${String(error)}`)
              }
            }
            setChatOpen(true)
            setPendingChatPrompt(
              `【Background Agent】以下を Agent モードで実行してください。\n\n${prompt.trim()}`
            )
            showNotice('Background Agent をチャットで開始します')
          })()
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
    }
    runAppCommandRef.current = run
    const unsubscribe = window.saforall.onMenuCommand((command) => {
      run(command)
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
            backendBaseUrl={backend.baseUrl}
            onOpenFolder={() => void openWorkspace()}
            onOpenRecent={(path) => void openWorkspaceAt(path)}
            onClone={() => setCloneOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onRecheckBackend={() => void checkBackend()}
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
              onStatusMessage={(message) => {
                setStatus(message)
                showNotice(message)
              }}
            />
          ) : sidebarView === 'search' ? (
            <SearchPanel
              workspacePath={workspacePath}
              width={sidebarWidth}
              onOpenWorkspace={openWorkspace}
              onOpenFile={openFileAt}
              onStatusMessage={(message) => {
                setStatus(message)
                showNotice(message)
              }}
              onFilesReplaced={() => {
                void (async () => {
                  for (const tab of tabsRef.current) {
                    try {
                      const content = await window.saforall.readFile(tab.path)
                      setTabs((current) =>
                        current.map((row) =>
                          row.path === tab.path
                            ? { ...row, content, dirty: false }
                            : row
                        )
                      )
                    } catch {
                      // ignore
                    }
                  }
                })()
              }}
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
              onOpenDiff={(relative, staged) => {
                if (!workspacePath) return
                void window.saforall
                  .gitFileDiff({ cwd: workspacePath, path: relative, staged })
                  .then((result) => {
                    if (!result.ok) {
                      setStatus(result.error ?? 'Diff を取得できません')
                      showNotice(result.error ?? 'Diff を取得できません')
                      return
                    }
                    setScmDiff({
                      path: relative,
                      original: result.original,
                      modified: result.modified,
                      staged,
                      language: languageFromPath(relative)
                    })
                  })
                  .catch((error) => {
                    setStatus(String(error))
                    showNotice(String(error))
                  })
              }}
              onStatusMessage={(message) => {
                setStatus(message)
                showNotice(message)
              }}
            />
          ) : sidebarView === 'rules' ? (
            <RulesPanel
              workspacePath={workspacePath}
              width={sidebarWidth}
              onOpenWorkspace={openWorkspace}
              onOpenFile={openFileAt}
              onStatusMessage={(message) => {
                setStatus(message)
                showNotice(message)
              }}
            />
          ) : (
            <div
              style={{
                width: sidebarWidth,
                minWidth: sidebarWidth,
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <ExtensionsPanel
                extensions={extensions}
                activeFilePath={activePath}
                workspacePath={workspacePath}
                grants={extensionGrants}
                onGrant={grantExtensionPermissions}
                onRevoke={revokeExtensionPermissions}
                onRefresh={() => void refreshExtensions()}
                onRun={(command) => runCommand(command)}
                onStatusMessage={(message) => {
                  setStatus(message)
                  showNotice(message)
                }}
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
                <div className="editor-split-row">
                  <EditorPane
                    tabs={tabs}
                    activePath={activePath}
                    tabWidths={tabWidths}
                    backendConnected={backend.connected}
                    workspacePath={workspacePath}
                    registerProviders
                    showOutline={!splitPath}
                    onEditorFocus={() => setEditorFocusGroup('primary')}
                    onSelectTab={(path) => {
                      setActivePath(path)
                      setStatus(path)
                      setRevealLine(null)
                      setEditorFocusGroup('primary')
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
                    onFindReferences={(hits, symbolLabel) => {
                      setReferenceHits(hits)
                      setReferenceSymbol(symbolLabel ?? null)
                      setReferencesLoading(false)
                      setTerminalOpen(true)
                      setBottomTab('references')
                      showNotice(
                        hits.length > 0
                          ? `参照 ${hits.length} 件${symbolLabel ? ` · ${symbolLabel}` : ''}`
                          : '参照が見つかりませんでした'
                      )
                    }}
                    onApplyLspEdits={(edits) => applyLspEdits(edits)}
                    revealLine={editorFocusGroup === 'primary' ? revealLine : null}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                    pausedLine={pausedLine}
                    inlineEditTrigger={
                      editorFocusGroup === 'primary' ? inlineEditTrigger : 0
                    }
                    peekDefinitionTrigger={
                      editorFocusGroup === 'primary' ? peekDefinitionTrigger : 0
                    }
                    peekReferencesTrigger={
                      editorFocusGroup === 'primary' ? peekReferencesTrigger : 0
                    }
                    onStatusMessage={(message) => {
                      setStatus(message)
                      showNotice(message)
                    }}
                  />
                  {splitPath && (
                    <>
                      <div className="editor-split-divider" aria-hidden />
                      <EditorPane
                        tabs={tabs}
                        activePath={splitPath}
                        tabWidths={tabWidths}
                        backendConnected={backend.connected}
                        workspacePath={workspacePath}
                        registerProviders={false}
                        showOutline
                        onEditorFocus={() => setEditorFocusGroup('secondary')}
                        onSelectTab={(path) => {
                          setSplitPath(path)
                          setStatus(path)
                          setEditorFocusGroup('secondary')
                        }}
                        onCloseTab={(path) => {
                          if (path === splitPath) setSplitPath(null)
                          else closeTab(path)
                        }}
                        onResizeTab={(path, width) => {
                          setTabWidths((current) => ({ ...current, [path]: width }))
                        }}
                        onChange={(content) => updateContentAt(splitPath, content)}
                        onSave={saveFile}
                        onSelectionChange={setEditorSelection}
                        onOpenDefinition={(path, line) => {
                          void openFileAt(path, line)
                        }}
                        onFindReferences={(hits, symbolLabel) => {
                          setReferenceHits(hits)
                          setReferenceSymbol(symbolLabel ?? null)
                          setReferencesLoading(false)
                          setTerminalOpen(true)
                          setBottomTab('references')
                          showNotice(
                            hits.length > 0
                              ? `参照 ${hits.length} 件${symbolLabel ? ` · ${symbolLabel}` : ''}`
                              : '参照が見つかりませんでした'
                          )
                        }}
                        revealLine={editorFocusGroup === 'secondary' ? revealLine : null}
                        breakpoints={breakpoints}
                        onToggleBreakpoint={toggleBreakpoint}
                        pausedLine={pausedLine}
                        inlineEditTrigger={
                          editorFocusGroup === 'secondary' ? inlineEditTrigger : 0
                        }
                        peekDefinitionTrigger={
                          editorFocusGroup === 'secondary' ? peekDefinitionTrigger : 0
                        }
                        peekReferencesTrigger={
                          editorFocusGroup === 'secondary' ? peekReferencesTrigger : 0
                        }
                        onStatusMessage={(message) => {
                          setStatus(message)
                          showNotice(message)
                        }}
                      />
                    </>
                  )}
                </div>
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
            {terminalMounted && (
              <>
                {terminalOpen && (
                  <ResizeHandle
                    direction="vertical"
                    title="下部パネルの高さを変更（上にドラッグで拡大）"
                    onResize={(delta) => {
                      setTerminalHeight((height) =>
                        Math.min(
                          terminalHeightMax(),
                          Math.max(TERMINAL_HEIGHT_MIN, height - delta)
                        )
                      )
                    }}
                  />
                )}
                <BottomPanel
                  open={terminalOpen}
                  height={terminalHeight}
                  activeTab={bottomTab}
                  cwd={workspacePath}
                  activePath={activePath}
                  historyRefreshKey={historyRefreshKey}
                  pendingCommand={pendingCommand}
                  newTerminalTrigger={newTerminalTrigger}
                  problems={problems}
                  references={{
                    hits: referenceHits,
                    symbolLabel: referenceSymbol,
                    loading: referencesLoading,
                    onOpen: (path, line) => {
                      void openFileAt(path, line)
                    }
                  }}
                  onJobDetail={(job) => {
                    showNotice(
                      `${job.kind} · ${job.status} · ${job.title}` +
                        (job.summary ? ` — ${job.summary}` : '') +
                        (job.error ? ` / ${job.error}` : '')
                    )
                    if (job.prompt) {
                      setChatOpen(true)
                      setPendingChatPrompt(job.prompt)
                    }
                  }}
                  onHistoryRestore={(relative, content) => {
                    if (!workspacePath) return
                    const abs = resolveProblemOpenPath(workspacePath, relative)
                    setTabs((current) => {
                      const hit = current.find((tab) => tab.path === abs)
                      if (hit) {
                        return current.map((tab) =>
                          tab.path === abs ? { ...tab, content, dirty: true } : tab
                        )
                      }
                      return [
                        ...current,
                        {
                          path: abs,
                          content,
                          language: languageFromPath(abs),
                          dirty: true
                        }
                      ]
                    })
                    setActivePath(abs)
                    setHistoryRefreshKey((n) => n + 1)
                  }}
                  onStatusMessage={(message) => {
                    setStatus(message)
                    showNotice(message)
                  }}
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
                    exceptionBreakMode,
                    onExceptionBreakModeChange: setExceptionBreakMode,
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
                onAgentNeedsReview={({ editCount, engine }) => {
                  if (editCount > 0) {
                    setComposerOpen(true)
                    showNotice(
                      `Agent の変更候補が ${editCount} 件あります。Composer で確認して適用してください。`
                    )
                    return
                  }
                  if (engine === 'cursor') {
                    showNotice(
                      'Cursor Agent はディスクへ直接書き込みます。必要なら Git / 差分で確認してください。'
                    )
                  }
                }}
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
        workspacePath={workspacePath}
        onClose={() => {
          setSettingsOpen(false)
          setAutoSaveEnabled(loadAutoSaveEnabled())
          setAutoSaveDelayMs(loadAutoSaveDelayMs())
        }}
        onOpenUsage={() => {
          setSettingsOpen(false)
          setUsageLayout(preferredUsageMode)
        }}
        onStatusMessage={(message) => {
          setStatus(message)
          showNotice(message)
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
      <ScmDiffDialog
        open={scmDiff !== null}
        view={scmDiff}
        onClose={() => setScmDiff(null)}
        onOpenFile={(relative) => {
          if (!workspacePath) return
          const sep = workspacePath.includes('\\') ? '\\' : '/'
          setScmDiff(null)
          void openFileAt(`${workspacePath}${sep}${relative}`)
        }}
      />
      <QuickOpenDialog
        open={quickOpen}
        workspacePath={workspacePath}
        onClose={() => setQuickOpen(false)}
        onOpenFile={(path) => {
          void openFileAt(path)
        }}
      />
      <SymbolPickerDialog
        open={symbolPicker !== null}
        mode={symbolPicker ?? 'document'}
        workspacePath={workspacePath}
        activePath={activePath}
        onClose={() => setSymbolPicker(null)}
        onPick={(hit) => {
          if (symbolPicker === 'document') {
            setRevealLine(null)
            window.setTimeout(() => setRevealLine(hit.line), 0)
            return
          }
          if (!hit.path || !workspacePath) return
          const abs = resolveProblemOpenPath(workspacePath, hit.path)
          void openFileAt(abs, hit.line)
        }}
      />
      <CommandPalette
        open={commandPaletteOpen}
        commands={BUILTIN_PALETTE_COMMANDS}
        onClose={() => setCommandPaletteOpen(false)}
        onRun={(commandId) => {
          if (commandId === 'view:commands') return
          runAppCommandRef.current(commandId)
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
