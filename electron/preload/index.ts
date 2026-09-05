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
      type: 'tool_call'
      id: string
      name: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      id: string
      name: string
      ok: boolean
      summary: string
    }
  | {
      type: 'edit_proposal'
      path: string
      content: string
    }
  | {
      type: 'agent_phase'
      phase: 'plan' | 'explore' | 'edit' | 'verify'
      note?: string
    }
  | {
      type: 'agent_checkpoint'
      step: number
      phase: string
      summary: string
    }
  | {
      type: 'done'
      model: string
      engine?: string
      task_type?: string
      estimated_usd?: number
      usage?: Record<string, { spent: number; limit: number; remaining: number }>
      assistant_message: Record<string, unknown>
      used_tools?: boolean
    }
  | { type: 'error'; code: string; message: string }

export type ChatStreamHandlers = {
  onEvent: (event: ChatStreamEvent) => void
}

const api = {
  setLocale: (locale: 'ja' | 'en'): Promise<boolean> =>
    ipcRenderer.invoke('app:setLocale', locale),
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  readDir: (dirPath: string): Promise<DirEntry[]> =>
    ipcRenderer.invoke('fs:readDir', dirPath),
  searchFiles: (cwd: string, query: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:searchFiles', cwd, query),
  searchCode: (cwd: string, query: string): Promise<string> =>
    ipcRenderer.invoke('fs:searchCode', cwd, query),
  watchWorkspace: (cwd: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:watchWorkspace', cwd),
  unwatchWorkspace: (): Promise<boolean> => ipcRenderer.invoke('fs:unwatchWorkspace'),
  onWorkspaceChanged: (callback: (payload: { path: string }) => void) => {
    const listener = (_event: unknown, payload: { path: string }): void => {
      callback(payload)
    }
    ipcRenderer.on('fs:workspaceChanged', listener)
    return () => {
      ipcRenderer.removeListener('fs:workspaceChanged', listener)
    }
  },
  loadProjectRules: (cwd: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:loadProjectRules', cwd),
  loadExtensions: (cwd: string): Promise<
    Array<{
      id: string
      name: string
      description?: string
      permissions?: Array<
        'terminal.run' | 'terminal.run.dangerous' | 'fs.read' | 'fs.write' | 'network'
      >
      commands: Array<{
        id: string
        title: string
        run: string
        permissions?: Array<
          'terminal.run' | 'terminal.run.dangerous' | 'fs.read' | 'fs.write' | 'network'
        >
      }>
    }>
  > => ipcRenderer.invoke('fs:loadExtensions', cwd),
  startDebug: (params: {
    filePath: string
    cwd: string
    breakpoints: Array<{ path: string; line: number; condition?: string }>
    port?: number
  }): Promise<{ ok: boolean; error?: string; port?: number; display?: string }> =>
    ipcRenderer.invoke('debug:start', params),
  continueDebug: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('debug:continue'),
  stepOverDebug: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('debug:stepOver'),
  stopDebug: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('debug:stop'),
  evaluateDebug: (
    expression: string,
    callFrameId?: string
  ): Promise<{ ok: boolean; value?: string; error?: string }> =>
    ipcRenderer.invoke('debug:evaluate', expression, callFrameId),
  syncLsp: (params: {
    cwd: string
    path: string
    content: string
  }): Promise<boolean> => ipcRenderer.invoke('lsp:sync', params),
  closeLsp: (params: { path: string }): Promise<boolean> =>
    ipcRenderer.invoke('lsp:close', params),
  resetLsp: (): Promise<boolean> => ipcRenderer.invoke('lsp:reset'),
  lspCompletion: (params: {
    path: string
    line: number
    character: number
  }): Promise<
    Array<{
      label: string
      kind?: number
      detail?: string
      insertText?: string
      documentation?: string
    }>
  > => ipcRenderer.invoke('lsp:completion', params),
  lspDefinition: (params: {
    path: string
    line: number
    character: number
  }): Promise<Array<{ path: string; line: number; column: number }>> =>
    ipcRenderer.invoke('lsp:definition', params),
  lspHover: (params: {
    path: string
    line: number
    character: number
  }): Promise<{ contents: string } | null> => ipcRenderer.invoke('lsp:hover', params),
  lspReferences: (params: {
    path: string
    line: number
    character: number
  }): Promise<Array<{ path: string; line: number; column: number }>> =>
    ipcRenderer.invoke('lsp:references', params),
  lspRename: (params: {
    path: string
    line: number
    character: number
    newName: string
  }): Promise<
    Array<{
      path: string
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
  > => ipcRenderer.invoke('lsp:rename', params),
  onLspDiagnostics: (
    callback: (payload: {
      items: Array<{
        path: string
        severity: 'error' | 'warning' | 'info'
        message: string
        line: number
        column: number
        source: string
      }>
    }) => void
  ) => {
    const listener = (
      _event: unknown,
      payload: {
        items: Array<{
          path: string
          severity: 'error' | 'warning' | 'info'
          message: string
          line: number
          column: number
          source: string
        }>
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  },
  searchMarketplace: (
    query: string
  ): Promise<{
    ok: boolean
    items: Array<{
      id: string
      name: string
      description: string
      url: string
      downloads?: number
    }>
    error?: string
  }> => ipcRenderer.invoke('marketplace:search', query),
  prepareBugbot: (
    cwd: string
  ): Promise<{ ok: boolean; prompt?: string; diff?: string; error?: string }> =>
    ipcRenderer.invoke('bugbot:prepare', cwd),
  gitDiff: (
    cwd: string,
    options?: { staged?: boolean }
  ): Promise<{ ok: boolean; stdout?: string; error?: string }> =>
    ipcRenderer.invoke('git:diff', cwd, options),
  searchSymbols: (
    cwd: string,
    query: string
  ): Promise<Array<{ name: string; kind: string; path: string; line: number }>> =>
    ipcRenderer.invoke('fs:searchSymbols', cwd, query),
  ensureIndex: (
    cwd: string
  ): Promise<{ ok: boolean; files?: number; symbols?: number; error?: string }> =>
    ipcRenderer.invoke('fs:ensureIndex', cwd),
  listMcp: (
    cwd: string
  ): Promise<{
    servers: Array<{ id: string; command: string; args?: string[] }>
    tools: Array<{ name: string; description?: string; serverId: string }>
    statuses?: Array<{ serverId: string; ok: boolean; toolCount: number; error?: string }>
    summary?: string
  }> => ipcRenderer.invoke('mcp:list', cwd),
  callMcp: (params: {
    cwd: string
    tool: string
    serverId?: string
    arguments?: Record<string, unknown>
    timeoutMs?: number
  }): Promise<{ ok: boolean; content: string; serverId?: string; error?: string }> =>
    ipcRenderer.invoke('mcp:call', params),
  onDebugEvent: (
    callback: (
      event:
        | { type: 'ready'; port: number }
        | {
            type: 'paused'
            reason: string
            callFrames: Array<{
              functionName: string
              url: string
              lineNumber: number
              columnNumber: number
              callFrameId?: string
            }>
            variables?: Array<{ name: string; value: string; type?: string }>
          }
        | { type: 'resumed' }
        | { type: 'stdout'; text: string }
        | { type: 'stderr'; text: string }
        | { type: 'exited'; code: number | null }
        | { type: 'error'; message: string }
    ) => void
  ) => {
    const listener = (
      _event: unknown,
      payload:
        | { type: 'ready'; port: number }
        | {
            type: 'paused'
            reason: string
            callFrames: Array<{
              functionName: string
              url: string
              lineNumber: number
              columnNumber: number
              callFrameId?: string
            }>
            variables?: Array<{ name: string; value: string; type?: string }>
          }
        | { type: 'resumed' }
        | { type: 'stdout'; text: string }
        | { type: 'stderr'; text: string }
        | { type: 'exited'; code: number | null }
        | { type: 'error'; message: string }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('debug:event', listener)
    return () => {
      ipcRenderer.removeListener('debug:event', listener)
    }
  },
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
  listJobs: (): Promise<
    Array<{
      id: string
      kind: 'agent' | 'bugbot'
      title: string
      status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
      createdAt: number
      finishedAt?: number
      summary?: string
      error?: string
      prompt: string
      cwd: string | null
    }>
  > => ipcRenderer.invoke('jobs:list'),
  enqueueJob: (params: {
    kind?: 'agent' | 'bugbot'
    title: string
    prompt: string
    cwd?: string | null
  }): Promise<{
    id: string
    kind: 'agent' | 'bugbot'
    title: string
    status: string
    createdAt: number
    prompt: string
    cwd: string | null
  }> => ipcRenderer.invoke('jobs:enqueue', params),
  cancelJob: (
    id: string
  ): Promise<{
    id: string
    status: string
  } | null> => ipcRenderer.invoke('jobs:cancel', id),
  onJobRun: (
    callback: (payload: {
      id: string
      kind: 'agent' | 'bugbot'
      title: string
      prompt: string
      cwd: string | null
    }) => void
  ) => {
    const listener = (
      _event: unknown,
      payload: {
        id: string
        kind: 'agent' | 'bugbot'
        title: string
        prompt: string
        cwd: string | null
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('jobs:run', listener)
    return () => {
      ipcRenderer.removeListener('jobs:run', listener)
    }
  },
  getRuntimeInfo: (): {
    appVersion: string
    electron?: string
    chrome?: string
    node?: string
  } => ({
    appVersion: '0.1.0',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }),
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
        | 'run:file'
        | 'run:file-inspect'
        | 'run:npm-start'
        | 'debug:continue'
        | 'debug:stepOver'
        | 'debug:stop'
        | 'view:debug'
        | 'view:extensions'
        | 'edit:inline'
        | 'agent:bugbot'
        | 'agent:background'
        | 'help:welcome'
        | 'help:docs'
        | 'help:shortcuts'
        | 'help:report'
        | 'help:license'
        | 'help:about'
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
        | 'run:file'
        | 'run:file-inspect'
        | 'run:npm-start'
        | 'debug:continue'
        | 'debug:stepOver'
        | 'debug:stop'
        | 'view:debug'
        | 'view:extensions'
        | 'edit:inline'
        | 'agent:bugbot'
        | 'agent:background'
        | 'help:welcome'
        | 'help:docs'
        | 'help:shortcuts'
        | 'help:report'
        | 'help:license'
        | 'help:about'
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
