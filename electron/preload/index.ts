import { contextBridge, ipcRenderer } from 'electron'

export type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
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
    ipcRenderer.invoke('fs:stat', filePath)
}

contextBridge.exposeInMainWorld('saforall', api)

export type SaforallApi = typeof api
