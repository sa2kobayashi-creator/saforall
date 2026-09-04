import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { dirname, join } from 'path'
import { watch, type FSWatcher } from 'fs'
import { mkdir, readFile, writeFile, readdir, stat } from 'fs/promises'
import { apiRequest, checkHealth, streamChat } from './api'
import {
  cloneRepository,
  commitChanges,
  getGitStatus,
  initRepository,
  pullRepository,
  pushRepository,
  stageAll,
  stagePaths,
  unstagePaths
} from './git'
import { setupApplicationMenu } from './menu'
import {
  createTerminalSession,
  killAllTerminals,
  killTerminal,
  resizeTerminal,
  writeTerminal
} from './terminal'
import { loadProjectRules, searchFilesByName } from './workspaceTools'
import { loadWorkspaceExtensions } from './extensions'
import {
  getActiveDebugSession,
  startDebugSession,
  stopDebugSession,
  type DebugBreakpoint,
  type DebugSession
} from './debugSession'
import { buildDebugLaunch, DEBUG_INSPECT_PORT } from './lib/runCommands'

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
  setupApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  void stopDebugSession()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  killAllTerminals()
  void stopDebugSession()
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  return readFile(filePath, 'utf-8')
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries
    .map((entry) => ({
      name: entry.name,
      path: join(dirPath, entry.name),
      isDirectory: entry.isDirectory()
    }))
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})

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
    }
  ) => {
    const launch = buildDebugLaunch(params.filePath, params.port ?? DEBUG_INSPECT_PORT)
    if (!launch) {
      return {
        ok: false as const,
        error: 'デバッグ対応は .js / .ts / .mjs / .cjs / .tsx のみです'
      }
    }
    try {
      await startDebugSession({
        command: launch.command,
        args: launch.args,
        cwd: params.cwd,
        breakpoints: params.breakpoints,
        port: launch.port,
        onCreated: attachDebugSessionListeners
      })
      return { ok: true as const, port: launch.port, display: launch.display }
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
)

ipcMain.handle('debug:continue', async () => {
  const session = getActiveDebugSession()
  if (!session) return { ok: false as const, error: 'no debug session' }
  await session.continue()
  return { ok: true as const }
})

ipcMain.handle('debug:stepOver', async () => {
  const session = getActiveDebugSession()
  if (!session) return { ok: false as const, error: 'no debug session' }
  await session.stepOver()
  return { ok: true as const }
})

ipcMain.handle('debug:stop', async () => {
  await stopDebugSession()
  broadcastDebug('debug:event', { type: 'exited', code: null })
  return { ok: true as const }
})
