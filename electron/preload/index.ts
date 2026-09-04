import { contextBridge, ipcRenderer } from 'electron'

export type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type HealthResult = {
  connected: boolean
  baseUrl: string
  message: string
  data?: {
    service: string
    status: string
    database: string
    time: string
  }
}

export type ApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export type ApiRequestOptions = {
  timeoutMs?: number
}

export type ChatStreamEvent =
  | { type: 'user_message'; message: Record<string, unknown> }
  | {
      type: 'route'
      engine: string
      task_type: string
      model: string
      fallback_reason?: string | null
      mode?: string
      policy_profile?: string
      usage?: Record<string, { spent: number; limit: number; remaining: number }>
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      model: string
      engine?: string
      task_type?: string
      estimated_usd?: number
      usage?: Record<string, { spent: number; limit: number; remaining: number }>
      assistant_message: Record<string, unknown>
    }
  | { type: 'error'; code: string; message: string }

export type ChatStreamHandlers = {
  onEvent: (event: ChatStreamEvent) => void
}

const api = {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  readDir: (dirPath: string): Promise<DirEntry[]> =>
    ipcRenderer.invoke('fs:readDir', dirPath),
  stat: (filePath: string): Promise<{ isDirectory: boolean; size: number; mtimeMs: number }> =>
    ipcRenderer.invoke('fs:stat', filePath),
  health: (): Promise<HealthResult> => ipcRenderer.invoke('api:health'),
  request: <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<T>> =>
    ipcRenderer.invoke('api:request', method, path, body, options),
  chatStream: async (
    body: unknown,
    handlers: ChatStreamHandlers
  ): Promise<void> => {
    const requestId = crypto.randomUUID()

    await new Promise<void>((resolve) => {
      const listener = (
        _event: unknown,
        payload: { requestId: string; event: ChatStreamEvent }
      ): void => {
        if (payload.requestId !== requestId) return
        handlers.onEvent(payload.event)
        if (payload.event.type === 'done' || payload.event.type === 'error') {
          ipcRenderer.removeListener('api:chatStream:event', listener)
          resolve()
        }
      }

      ipcRenderer.on('api:chatStream:event', listener)
      void ipcRenderer.invoke('api:chatStream', requestId, body).catch((error: unknown) => {
        ipcRenderer.removeListener('api:chatStream:event', listener)
        handlers.onEvent({
          type: 'error',
          code: 'NETWORK_ERROR',
          message: String(error)
        })
        resolve()
      })
    })
  },
  createTerminal: (options?: {
    cwd?: string
    cols?: number
    rows?: number
  }): Promise<{ id: string; backend: 'node-pty' | 'child_process' }> =>
    ipcRenderer.invoke('terminal:create', options),
  writeTerminal: (id: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id: string, cols: number, rows: number): Promise<boolean> =>
    ipcRenderer.invoke('terminal:resize', id, cols, rows),
  killTerminal: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (
      _event: unknown,
      payload: { id: string; data: string }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (
    callback: (payload: { id: string; exitCode: number }) => void
  ) => {
    const listener = (
      _event: unknown,
      payload: { id: string; exitCode: number }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  gitStatus: (cwd: string): Promise<{
    ok: boolean
    isRepo: boolean
    branch: string | null
    upstream: string | null
    ahead: number
    behind: number
    files: Array<{
      path: string
      index: string
      worktree: string
      status: string
      staged: boolean
      unstaged: boolean
    }>
    error?: string
  }> => ipcRenderer.invoke('git:status', cwd),
  gitClone: (payload: {
    url: string
    parentDir: string
    folderName?: string
  }): Promise<{ ok: boolean; targetPath?: string; error?: string }> =>
    ipcRenderer.invoke('git:clone', payload),
  gitInit: (cwd: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:init', cwd),
  gitStage: (payload: {
    cwd: string
    paths: string[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:stage', payload),
  gitStageAll: (cwd: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:stageAll', cwd),
  gitUnstage: (payload: {
    cwd: string
    paths: string[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:unstage', payload),
  gitCommit: (payload: {
    cwd: string
    message: string
  }): Promise<{ ok: boolean; stdout?: string; error?: string }> =>
    ipcRenderer.invoke('git:commit', payload),
  gitPush: (cwd: string): Promise<{ ok: boolean; stdout?: string; error?: string }> =>
    ipcRenderer.invoke('git:push', cwd),
  gitPull: (cwd: string): Promise<{ ok: boolean; stdout?: string; error?: string }> =>
    ipcRenderer.invoke('git:pull', cwd),
  onMenuCommand: (
    callback: (
      command:
        | 'workspace:open'
        | 'workspace:close'
        | 'file:save'
        | 'view:explorer'
        | 'view:scm'
        | 'view:terminal'
        | 'view:problems'
        | 'view:chat'
        | 'view:settings'
        | 'view:usage'
        | 'view:usage-right'
        | 'view:usage-overlay'
        | 'view:usage-hidden'
        | 'git:clone'
        | 'git:refresh'
        | 'git:pull'
        | 'git:push'
    ) => void
  ) => {
    const listener = (
      _event: unknown,
      command:
        | 'workspace:open'
        | 'workspace:close'
        | 'file:save'
        | 'view:explorer'
        | 'view:scm'
        | 'view:terminal'
        | 'view:problems'
        | 'view:chat'
        | 'view:settings'
        | 'view:usage'
        | 'view:usage-right'
        | 'view:usage-overlay'
        | 'view:usage-hidden'
        | 'git:clone'
        | 'git:refresh'
        | 'git:pull'
        | 'git:push'
    ): void => {
      callback(command)
    }
    ipcRenderer.on('menu:command', listener)
    return () => {
      ipcRenderer.removeListener('menu:command', listener)
    }
  }
}

contextBridge.exposeInMainWorld('saforall', api)

export type SaforallApi = typeof api
