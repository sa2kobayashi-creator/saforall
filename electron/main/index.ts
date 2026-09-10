import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { dirname, join, basename, extname } from 'path'
import { watch, type FSWatcher } from 'fs'
import { mkdir, readFile, writeFile, readdir, stat, unlink, rename, rm } from 'fs/promises'
import { apiRequest, checkHealth, streamChat, syncSettingsFromServer } from './api'
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
import { loadProjectRules, searchFilesByName, suggestVerifyCommands, toolSearch, listProjectRuleFiles, readProjectMemory, appendProjectMemory, saveProjectMemory, readProjectRuleFile, replaceInWorkspace, listProjectSkills, readProjectSkill, formatSkillsCatalog } from './workspaceTools'
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
  patchWorkspaceIndex,
  configureIndexCache,
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
  const userData = app.getPath('userData')
  configureJobsPersistence(join(userData, 'background-jobs.json'))
  configureIndexCache(join(userData, 'workspace-index-cache.json'))
  void import('./localDb').then(({ configureLocalDb, ensureLocalDbReady }) => {
    configureLocalDb(join(userData, 'local-db'))
    void ensureLocalDbReady()
  })
  void import('./settingsStore').then(({ configureSettingsStore, ensureSettingsLoaded }) => {
    configureSettingsStore(join(userData, 'settings-cache.json'))
    void ensureSettingsLoaded()
  })
  void import('./ai/credentialVault').then(async ({ configureCredentialVault, warmByokCache }) => {
    const { safeStorage } = await import('electron')
    configureCredentialVault({
      filePath: join(userData, 'credentials-vault.json'),
      wrap: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        wrap: (plain) => safeStorage.encryptString(plain).toString('base64'),
        unwrap: (wrapped) => safeStorage.decryptString(Buffer.from(wrapped, 'base64'))
      }
    })
    void warmByokCache()
  })
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

ipcMain.handle('fs:readFileBase64', async (_event, filePath: string) => {
  const buf = await readFile(filePath)
  const ext = extname(filePath).toLowerCase()
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'application/octet-stream'
  if (!mime.startsWith('image/')) {
    throw new Error('画像ファイルのみ読み込めます')
  }
  if (buf.byteLength > 8 * 1024 * 1024) {
    throw new Error('画像が大きすぎます（8MB 以下）')
  }
  return {
    path: filePath,
    name: basename(filePath),
    mime,
    data_base64: buf.toString('base64'),
    bytes: buf.byteLength
  }
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
  async (
    _event,
    cwd: string,
    query: string,
    anchorPaths?: string[],
    source?: string
  ) => {
    return toolSearch(
      cwd,
      query,
      undefined,
      anchorPaths,
      typeof source === 'string' && source.trim() ? source.trim() : 'search_panel'
    )
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
        const changed = join(cwd, filename.toString())
        void patchWorkspaceIndex(cwd, changed).catch(() => {
          invalidateWorkspaceIndex(cwd)
        })
        event.sender.send('fs:workspaceChanged', {
          path: changed
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

ipcMain.handle('settings:getLocal', async () => {
  const { getLocalSettingsMasked } = await import('./settingsStore')
  return getLocalSettingsMasked()
})

ipcMain.handle('settings:putLocal', async (_event, settings: Record<string, string>) => {
  const { mergeLocalSettings, maskSettingsForRenderer } = await import('./settingsStore')
  const merged = await mergeLocalSettings(settings, { markDirty: true })
  return { ok: true as const, settings: maskSettingsForRenderer(merged) }
})

ipcMain.handle('settings:hasLocalLlm', async () => {
  const { ensureSettingsLoaded, hasUsableLocalLlm } = await import('./settingsStore')
  await ensureSettingsLoaded()
  const { hasUsableByokLlm } = await import('./ai/credentials')
  return hasUsableLocalLlm() || hasUsableByokLlm()
})

ipcMain.handle('settings:syncFromServer', async () => syncSettingsFromServer())

ipcMain.handle('settings:exportFile', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showSaveDialog(win ?? undefined, {
    title: '設定をエクスポート',
    defaultPath: 'saforall-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePath) {
    return { ok: false as const, message: 'キャンセルしました' }
  }
  const { getLocalSettingsRaw } = await import('./settingsStore')
  const settings = await getLocalSettingsRaw()
  const payload = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    warning: 'API キー等の秘密情報が含まれます。共有しないでください。',
    settings
  }
  await writeFile(picked.filePath, JSON.stringify(payload, null, 2), 'utf8')
  return { ok: true as const, path: picked.filePath }
})

ipcMain.handle('credentials:listByok', async () => {
  const { handleListByok } = await import('./ai/byokIpc')
  return handleListByok()
})

ipcMain.handle('credentials:saveByok', async (_event, input: unknown) => {
  const { handleSaveByok } = await import('./ai/byokIpc')
  const body = input && typeof input === 'object' ? (input as { providerId?: unknown; secret?: unknown }) : {}
  return handleSaveByok(body)
})

ipcMain.handle('credentials:deleteByok', async (_event, providerId: unknown) => {
  const { handleDeleteByok } = await import('./ai/byokIpc')
  return handleDeleteByok(providerId)
})

ipcMain.handle('credentials:testByok', async (_event, providerId: unknown) => {
  const { handleTestByok } = await import('./ai/byokIpc')
  return handleTestByok(providerId)
})

ipcMain.handle('settings:importFile', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog(win ?? undefined, {
    title: '設定をインポート',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false as const, message: 'キャンセルしました' }
  }
  const raw = await readFile(picked.filePaths[0], 'utf8')
  let parsed: { settings?: Record<string, string> }
  try {
    parsed = JSON.parse(raw) as { settings?: Record<string, string> }
  } catch {
    return { ok: false as const, message: 'JSON の解析に失敗しました' }
  }
  const settings = parsed.settings
  if (!settings || typeof settings !== 'object') {
    return { ok: false as const, message: 'settings オブジェクトがありません' }
  }
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string') flat[key] = value
  }
  const { mergeLocalSettings, maskSettingsForRenderer } = await import('./settingsStore')
  const merged = await mergeLocalSettings(flat, { markDirty: true })
  return {
    ok: true as const,
    path: picked.filePaths[0],
    settings: maskSettingsForRenderer(merged)
  }
})

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
    const { beginChatAbort, endChatAbort } = await import('./chatAbort')
    const signal = beginChatAbort(requestId)
    try {
      await streamChat(
        body,
        (streamEvent) => {
          event.sender.send('api:chatStream:event', { requestId, event: streamEvent })
        },
        signal
      )
      return true
    } finally {
      endChatAbort(requestId)
    }
  }
)

ipcMain.handle('api:chatStream:begin', async (_event, requestId: string) => {
  const { beginChatAbort } = await import('./chatAbort')
  beginChatAbort(String(requestId || ''))
  return true
})

ipcMain.handle('api:chatStream:cancel', async (_event, requestId: string) => {
  const { cancelChatAbort } = await import('./chatAbort')
  return cancelChatAbort(String(requestId || ''))
})

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
  'lsp:signatureHelp',
  async (
    _event,
    params: { path: string; line: number; character: number }
  ) => lspManager.signatureHelp(params.path, params.line, params.character)
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
ipcMain.handle('skills:list', async (_event, cwd: string) => listProjectSkills(cwd))
ipcMain.handle('skills:read', async (_event, cwd: string, idOrPath: string) =>
  readProjectSkill(cwd, idOrPath)
)
ipcMain.handle('skills:catalog', async (_event, cwd: string) => formatSkillsCatalog(cwd))

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
