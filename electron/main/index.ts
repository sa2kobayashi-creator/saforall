import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { dirname, join } from 'path'
import { watch, type FSWatcher } from 'fs'
import { mkdir, readFile, writeFile, readdir, stat, unlink, rename, rm } from 'fs/promises'
import { apiRequest, checkHealth, streamChat } from './api'
import {
  cloneRepository,
  commitChanges,
  getGitBlame,
  getGitDiff,
  getGitFileSides,
  getGitStatus,
  initRepository,
  pullRepository,
  pushRepository,
  stageAll,
  stagePaths,
  unstagePaths
} from './git'
import { createPullRequest, getGhAuthStatus, createPullRequestReview, findingsToReviewComments } from './gh'
import { setupApplicationMenu } from './menu'
import {
  createTerminalSession,
  killAllTerminals,
  killTerminal,
  resizeTerminal,
  writeTerminal
} from './terminal'
import { loadProjectRules, searchFilesByName, suggestVerifyCommands, toolSearch, listProjectRuleFiles, readProjectMemory, appendProjectMemory, saveProjectMemory, readProjectRuleFile, replaceInWorkspace } from './workspaceTools'
import { createWorkspaceIgnoreMatcher, resolveIgnoreRoot } from './gitIgnore'
import { loadWorkspaceExtensions, scaffoldExtensionFromMarketplace, setWorkspaceExtensionEnabled } from './extensions'
import {
  listLocalHistory,
  readLocalHistoryContent,
  recordLocalHistory,
  restoreLocalHistory
} from './localHistory'
import { type DebugBreakpoint, type DebugSession } from './debugSession'
import {
  detectBitbucketRemote,
  detectCurrentBranchName,
  buildBitbucketPullRequestCreateUrl,
  probeBitbucketAuth
} from './bitbucket'
import {
  continueUnifiedDebug,
  evaluateUnifiedDebug,
  startUnifiedDebug,
  stepOverUnifiedDebug,
  stopUnifiedDebug
} from './debugRouter'
import {
  ensureWorkspaceIndex,
  invalidateWorkspaceIndex,
  searchIndexedSymbols
} from './workspaceIndex'
import { listWorkspaceMcpTools, mcpManager } from './mcpClient'
import { lspManager, type LspDiagnostic } from './lspClient'
import {
  cancelBackgroundJob,
  completeBackgroundJob,
  configureJobsPersistence,
  enqueueBackgroundJob,
  listBackgroundJobs,
  loadPersistedJobs,
  markBackgroundJobRunning,
  onBackgroundJobChange
} from './backgroundJobs'
import { searchOpenVsx } from './marketplace'
import { readTextFile } from './textEncoding'

let workspaceWatcher: FSWatcher | null = null
let watchDebounce: ReturnType<typeof setTimeout> | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'saforall',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  configureJobsPersistence(join(app.getPath('userData'), 'background-jobs.json'))
  void loadPersistedJobs()
  setupApplicationMenu('ja')
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('app:setLocale', (_event, locale: unknown) => {
  setupApplicationMenu(locale === 'en' ? 'en' : 'ja')
  return true
})

app.on('window-all-closed', () => {
  killAllTerminals()
  void stopUnifiedDebug()
  void lspManager.dispose()
  void mcpManager.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  killAllTerminals()
  void stopUnifiedDebug()
  void lspManager.dispose()
  void mcpManager.disposeAll()
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const decoded = await readTextFile(filePath)
  return decoded.text
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
  await mkdir(dirPath, { recursive: true })
  return true
})

ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
  const info = await stat(targetPath)
  if (info.isDirectory()) {
    await rm(targetPath, { recursive: true, force: true })
  } else {
    await unlink(targetPath)
  }
  return true
})

ipcMain.handle(
  'fs:rename',
  async (_event, params: { from: string; to: string }) => {
    await mkdir(dirname(params.to), { recursive: true })
    await rename(params.from, params.to)
    return true
  }
)

ipcMain.handle(
  'fs:readDir',
  async (_event, dirPath: string, options?: { workspaceRoot?: string }) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const ignoreRoot = await resolveIgnoreRoot(dirPath, options?.workspaceRoot ?? null)
    const matcher = await createWorkspaceIgnoreMatcher(ignoreRoot)
    return entries
      .map((entry) => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory()
      }))
      .filter((entry) => {
        if (entry.name === '.git') return false
        if (entry.name.startsWith('.')) return false
        return !matcher.ignores(entry.path, entry.isDirectory)
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }
)

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  const info = await stat(filePath)
  return {
    isDirectory: info.isDirectory(),
    size: info.size,
    mtimeMs: info.mtimeMs
  }
})

ipcMain.handle('fs:searchFiles', async (_event, cwd: string, query: string) => {
  return searchFilesByName(cwd, query, 50)
})

ipcMain.handle(
  'fs:searchCode',
  async (_event, cwd: string, query: string, anchorPaths?: string[]) => {
    return toolSearch(cwd, query, undefined, anchorPaths)
  }
)

ipcMain.handle(
  'fs:replaceInFiles',
  async (
    _event,
    params: {
      cwd: string
      query: string
      replacement: string
      dryRun?: boolean
      caseSensitive?: boolean
    }
  ) =>
    replaceInWorkspace(params.cwd, params.query, params.replacement, {
      dryRun: params.dryRun,
      caseSensitive: params.caseSensitive
    })
)

ipcMain.handle('fs:searchSymbols', async (_event, cwd: string, query: string) => {
  return searchIndexedSymbols(cwd, query, 40)
})

ipcMain.handle('fs:ensureIndex', async (_event, cwd: string) => {
  try {
    const index = await ensureWorkspaceIndex(cwd)
    return {
      ok: true as const,
      files: index.files.length,
      symbols: index.symbols.length
    }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})

ipcMain.handle('mcp:list', async (_event, cwd: string) => listWorkspaceMcpTools(cwd))

ipcMain.handle(
  'mcp:call',
  async (
    _event,
    params: {
      cwd: string
      tool: string
      serverId?: string
      arguments?: Record<string, unknown>
      timeoutMs?: number
    }
  ) =>
    mcpManager.callTool(params.cwd, {
      tool: params.tool,
      serverId: params.serverId,
      arguments: params.arguments,
      timeoutMs: params.timeoutMs
    })
)

ipcMain.handle('fs:loadProjectRules', async (_event, cwd: string) => {
  return loadProjectRules(cwd)
})

ipcMain.handle('fs:loadExtensions', async (_event, cwd: string) => {
  return loadWorkspaceExtensions(cwd)
})

ipcMain.handle('fs:watchWorkspace', async (event, cwd: string) => {
  if (workspaceWatcher) {
    workspaceWatcher.close()
    workspaceWatcher = null
  }
  try {
    workspaceWatcher = watch(cwd, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      if (watchDebounce) clearTimeout(watchDebounce)
      watchDebounce = setTimeout(() => {
        invalidateWorkspaceIndex(cwd)
        event.sender.send('fs:workspaceChanged', {
          path: join(cwd, filename.toString())
        })
      }, 400)
    })
    return true
  } catch {
    return false
  }
})

ipcMain.handle('fs:unwatchWorkspace', async () => {
  if (workspaceWatcher) {
    workspaceWatcher.close()
    workspaceWatcher = null
  }
  return true
})

ipcMain.handle('api:health', async () => checkHealth())

ipcMain.handle(
  'api:request',
  async (
    _event,
    method: string,
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number }
  ) => apiRequest(method, path, body, options)
)

ipcMain.handle(
  'api:chatStream',
  async (event, requestId: string, body: unknown) => {
    await streamChat(body, (streamEvent) => {
      event.sender.send('api:chatStream:event', { requestId, event: streamEvent })
    })
    return true
  }
)

ipcMain.handle('git:status', async (_event, cwd: string) => getGitStatus(cwd))

ipcMain.handle(
  'git:clone',
  async (
    _event,
    payload: { url: string; parentDir: string; folderName?: string }
  ) => cloneRepository(payload.url, payload.parentDir, payload.folderName)
)

ipcMain.handle('git:init', async (_event, cwd: string) => initRepository(cwd))

ipcMain.handle(
  'git:stage',
  async (_event, payload: { cwd: string; paths: string[] }) =>
    stagePaths(payload.cwd, payload.paths)
)

ipcMain.handle('git:stageAll', async (_event, cwd: string) => stageAll(cwd))

ipcMain.handle(
  'git:unstage',
  async (_event, payload: { cwd: string; paths: string[] }) =>
    unstagePaths(payload.cwd, payload.paths)
)

ipcMain.handle(
  'git:commit',
  async (_event, payload: { cwd: string; message: string }) =>
    commitChanges(payload.cwd, payload.message)
)

ipcMain.handle('git:push', async (_event, cwd: string) => pushRepository(cwd))

ipcMain.handle('git:pull', async (_event, cwd: string) => pullRepository(cwd))

ipcMain.handle(
  'git:diff',
  async (_event, cwd: string, options?: { staged?: boolean }) => getGitDiff(cwd, options)
)

ipcMain.handle(
  'git:fileDiff',
  async (
    _event,
    params: { cwd: string; path: string; staged?: boolean }
  ) => getGitFileSides(params.cwd, params.path, { staged: params.staged })
)

ipcMain.handle(
  'git:blame',
  async (_event, params: { cwd: string; path: string }) =>
    getGitBlame(params.cwd, params.path)
)

ipcMain.handle(
  'gh:prCreate',
  async (
    _event,
    payload: { cwd: string; title: string; body?: string; base?: string; draft?: boolean }
  ) =>
    createPullRequest(payload.cwd, {
      title: payload.title,
      body: payload.body,
      base: payload.base,
      draft: payload.draft
    })
)

ipcMain.handle('gh:authStatus', async (_event, cwd?: string) => getGhAuthStatus(cwd))

ipcMain.handle(
  'shell:openExternal',
  async (_event, url: string) => {
    const { shell } = await import('electron')
    if (!/^https?:\/\//i.test(url)) return { ok: false as const, error: 'URL が不正です' }
    await shell.openExternal(url)
    return { ok: true as const }
  }
)

ipcMain.handle(
  'terminal:create',
  async (
    _event,
    options?: {
      cwd?: string
      cols?: number
      rows?: number
    }
  ) => createTerminalSession(options?.cwd, options?.cols, options?.rows)
)

ipcMain.handle('terminal:write', async (_event, id: string, data: string) =>
  writeTerminal(id, data)
)

ipcMain.handle(
  'terminal:resize',
  async (_event, id: string, cols: number, rows: number) =>
    resizeTerminal(id, cols, rows)
)

ipcMain.handle('terminal:kill', async (_event, id: string) => killTerminal(id))

function broadcastDebug(
  channel: string,
  payload: unknown
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function attachDebugSessionListeners(session: DebugSession): void {
  session.on('ready', (payload) => broadcastDebug('debug:event', { type: 'ready', ...payload }))
  session.on('paused', (payload) => broadcastDebug('debug:event', { type: 'paused', ...payload }))
  session.on('resumed', () => broadcastDebug('debug:event', { type: 'resumed' }))
  session.on('stdout', (payload) => broadcastDebug('debug:event', { type: 'stdout', ...payload }))
  session.on('stderr', (payload) => broadcastDebug('debug:event', { type: 'stderr', ...payload }))
  session.on('exited', (payload) => broadcastDebug('debug:event', { type: 'exited', ...payload }))
  session.on('error', (payload) => broadcastDebug('debug:event', { type: 'error', ...payload }))
}

ipcMain.handle(
  'debug:start',
  async (
    _event,
    params: {
      filePath: string
      cwd: string
      breakpoints: DebugBreakpoint[]
      port?: number
      exceptionBreakMode?: 'none' | 'uncaught' | 'all'
    }
  ) => {
    return startUnifiedDebug({
      ...params,
      onEvent: (payload) => broadcastDebug('debug:event', payload),
      onCdpCreated: attachDebugSessionListeners
    })
  }
)

ipcMain.handle('debug:continue', async () => continueUnifiedDebug())

ipcMain.handle('debug:stepOver', async () => stepOverUnifiedDebug())

ipcMain.handle('debug:stop', async () => {
  await stopUnifiedDebug()
  broadcastDebug('debug:event', { type: 'exited', code: null })
  return { ok: true as const }
})

ipcMain.handle(
  'debug:evaluate',
  async (_event, expression: string, callFrameId?: string) =>
    evaluateUnifiedDebug(expression, callFrameId)
)

ipcMain.handle(
  'lsp:sync',
  async (_event, params: { cwd: string; path: string; content: string }) => {
    await lspManager.ensureForFile(params.cwd, params.path, params.content)
    return true
  }
)

ipcMain.handle('lsp:close', async (_event, params: { path: string }) => {
  await lspManager.closeDocument(params.path)
  return true
})

ipcMain.handle('lsp:reset', async () => {
  await lspManager.dispose()
  return true
})

ipcMain.handle(
  'lsp:completion',
  async (
    _event,
    params: { path: string; line: number; character: number }
  ): Promise<Array<{ label: string; kind?: number; detail?: string; insertText?: string; documentation?: string }>> =>
    lspManager.completion(params.path, params.line, params.character)
)

ipcMain.handle(
  'lsp:definition',
  async (
    _event,
    params: { path: string; line: number; character: number }
  ): Promise<Array<{ path: string; line: number; column: number }>> =>
    lspManager.definition(params.path, params.line, params.character)
)

ipcMain.handle(
  'lsp:hover',
  async (
    _event,
    params: { path: string; line: number; character: number }
  ): Promise<{ contents: string } | null> =>
    lspManager.hover(params.path, params.line, params.character)
)

ipcMain.handle(
  'lsp:references',
  async (
    _event,
    params: { path: string; line: number; character: number }
  ): Promise<
    Array<{ path: string; line: number; column: number; endLine?: number; endColumn?: number }>
  > => lspManager.references(params.path, params.line, params.character)
)

ipcMain.handle(
  'lsp:inlayHints',
  async (
    _event,
    params: {
      path: string
      startLine: number
      startCharacter: number
      endLine: number
      endCharacter: number
    }
  ) =>
    lspManager.inlayHints(
      params.path,
      params.startLine,
      params.startCharacter,
      params.endLine,
      params.endCharacter
    )
)

ipcMain.handle(
  'lsp:rename',
  async (
    _event,
    params: { path: string; line: number; character: number; newName: string }
  ): Promise<
    Array<{
      path: string
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
  > => lspManager.rename(params.path, params.line, params.character, params.newName)
)

ipcMain.handle(
  'lsp:format',
  async (_event, params: { path: string }) => lspManager.formatDocument(params.path)
)

ipcMain.handle(
  'lsp:codeActions',
  async (
    _event,
    params: {
      path: string
      line: number
      character: number
      endLine?: number
      endCharacter?: number
    }
  ) =>
    lspManager.codeActions(
      params.path,
      params.line,
      params.character,
      params.endLine,
      params.endCharacter
    )
)

ipcMain.handle(
  'lsp:documentSymbols',
  async (_event, params: { path: string }) => lspManager.documentSymbols(params.path)
)

lspManager.setDiagnosticsHandler((items: LspDiagnostic[]) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('lsp:diagnostics', { items })
  }
})

ipcMain.handle('marketplace:search', async (_event, query: string) => searchOpenVsx(query))

ipcMain.handle(
  'extensions:scaffold',
  async (
    _event,
    payload: {
      cwd: string
      item: {
        id: string
        name: string
        description?: string
        namespace?: string
        packageName?: string
        url?: string
      }
    }
  ) => scaffoldExtensionFromMarketplace(payload.cwd, payload.item)
)

ipcMain.handle(
  'gh:prReview',
  async (
    _event,
    payload: {
      cwd: string
      prNumber?: number
      body?: string
      findings: Array<{
        path: string
        line?: number
        title: string
        detail: string
        severity?: string
      }>
    }
  ) => {
    const comments = findingsToReviewComments(payload.findings)
    return createPullRequestReview(payload.cwd, {
      prNumber: payload.prNumber,
      comments,
      body: payload.body ?? 'Bugbot findings from saforall'
    })
  }
)

ipcMain.handle('rules:list', async (_event, cwd: string) => listProjectRuleFiles(cwd))
ipcMain.handle('rules:readFile', async (_event, cwd: string, relativePath: string) =>
  readProjectRuleFile(cwd, relativePath)
)
ipcMain.handle('rules:readMemory', async (_event, cwd: string) => readProjectMemory(cwd))
ipcMain.handle('rules:appendMemory', async (_event, cwd: string, note: string) =>
  appendProjectMemory(cwd, note)
)
ipcMain.handle('rules:saveMemory', async (_event, cwd: string, content: string) =>
  saveProjectMemory(cwd, content)
)

ipcMain.handle('bitbucket:remote', async (_event, cwd: string) => {
  const info = await detectBitbucketRemote(cwd)
  if (!info) return { ok: false as const, error: 'Bitbucket remote ではありません' }
  const branch = await detectCurrentBranchName(cwd)
  const createUrl = buildBitbucketPullRequestCreateUrl(info, {
    source: branch ?? undefined
  })
  return { ok: true as const, info, branch, createUrl }
})

ipcMain.handle('bitbucket:probeAuth', async (_event, cwd: string) => probeBitbucketAuth(cwd))

ipcMain.handle(
  'history:list',
  async (_event, cwd: string, path?: string) => listLocalHistory(cwd, path)
)

ipcMain.handle(
  'history:read',
  async (_event, params: { cwd: string; id: string; path: string }) =>
    readLocalHistoryContent(params.cwd, params.id, params.path)
)

ipcMain.handle(
  'history:record',
  async (
    _event,
    params: { cwd: string; path: string; content: string; label?: string }
  ) => recordLocalHistory(params.cwd, params.path, params.content, params.label)
)

ipcMain.handle(
  'history:restore',
  async (_event, params: { cwd: string; id: string; path: string }) =>
    restoreLocalHistory(params.cwd, params.id, params.path)
)

ipcMain.handle(
  'extensions:setEnabled',
  async (_event, params: { cwd: string; id: string; enabled: boolean }) =>
    setWorkspaceExtensionEnabled(params.cwd, params.id, params.enabled)
)

ipcMain.handle('jobs:list', async () => listBackgroundJobs())

ipcMain.handle(
  'jobs:enqueue',
  async (
    _event,
    params: { kind?: 'agent' | 'bugbot'; title: string; prompt: string; cwd?: string | null }
  ) => {
    let contextNote = ''
    const cwd = params.cwd ?? null
    if (cwd) {
      try {
        const verify = await suggestVerifyCommands(cwd)
        const rules = await loadProjectRules(cwd)
        contextNote = [
          verify ? `推奨検証: ${verify.primary}` : null,
          rules ? 'プロジェクト Rules/Memories を読み込み済み' : null
        ]
          .filter(Boolean)
          .join(' · ')
      } catch {
        contextNote = ''
      }
    }

    const enrichedPrompt = [
      params.prompt.trim(),
      contextNote ? `\n\n（Background 準備: ${contextNote}）` : ''
    ].join('')

    const job = enqueueBackgroundJob({
      kind: params.kind === 'bugbot' ? 'bugbot' : 'agent',
      title: params.title,
      prompt: enrichedPrompt,
      cwd,
      contextNote: contextNote || undefined
    })
    markBackgroundJobRunning(job.id)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('jobs:run', {
        id: job.id,
        kind: job.kind,
        title: job.title,
        prompt: job.prompt,
        cwd: job.cwd,
        contextNote: job.contextNote
      })
    }
    // Do NOT complete here — renderer reports finish via jobs:complete after Agent run.
    return job
  }
)

ipcMain.handle(
  'jobs:complete',
  async (
    _event,
    payload: { id: string; ok: boolean; summary?: string; error?: string }
  ) => completeBackgroundJob(payload.id, payload)
)

ipcMain.handle('jobs:cancel', async (_event, id: string) => cancelBackgroundJob(id))

onBackgroundJobChange((job) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('jobs:updated', job)
  }
})

ipcMain.handle(
  'bugbot:prepare',
  async (_event, cwd: string) => {
    const diff = await getGitDiff(cwd)
    if (!diff.ok || !diff.stdout?.trim()) {
      return { ok: false as const, error: diff.error || 'レビュー対象の差分がありません' }
    }
    const { buildBugbotPrompt, heuristicBugbotFindings } = await import('./bugbotReview')
    const findings = heuristicBugbotFindings(diff.stdout)
    return {
      ok: true as const,
      diff: diff.stdout,
      findings,
      prompt: buildBugbotPrompt(diff.stdout, findings)
    }
  }
)
