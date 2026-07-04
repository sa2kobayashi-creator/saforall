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
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; assistant_message: Record<string, unknown> }
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
  }
}

contextBridge.exposeInMainWorld('saforall', api)

export type SaforallApi = typeof api
