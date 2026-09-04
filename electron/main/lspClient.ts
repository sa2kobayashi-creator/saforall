import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'

export type LspDiagnostic = {
  path: string
  severity: 'error' | 'warning' | 'info'
  message: string
  line: number
  column: number
  source: string
}

type LspMessage = {
  jsonrpc?: string
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string }
}

type Waiter = {
  resolve: (value: LspMessage) => void
  reject: (error: Error) => void
}

function toUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`
  return normalized.startsWith('file:') ? normalized : `file://${normalized}`
}

function fromUri(uri: string): string {
  try {
    let path = decodeURIComponent(uri.replace(/^file:\/\//i, ''))
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
    return path.replace(/\//g, '\\')
  } catch {
    return uri
  }
}

function severityFromLsp(value: unknown): LspDiagnostic['severity'] {
  const n = Number(value ?? 1)
  if (n === 1) return 'error'
  if (n === 2) return 'warning'
  return 'info'
}

/** Minimal stdio LSP client (diagnostics-focused). */
export class LspClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private waiters = new Map<number, Waiter>()
  private buffer = ''
  private languageId: string
  private sourceLabel: string

  constructor(languageId: string, sourceLabel: string) {
    super()
    this.languageId = languageId
    this.sourceLabel = sourceLabel
  }

  async start(command: string, args: string[], cwd: string): Promise<void> {
    await this.stop()
    this.child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(command)
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf-8')))
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.emit('log', chunk.toString('utf-8'))
    })
    this.child.on('exit', () => {
      this.child = null
      this.emit('exit')
    })

    await this.request('initialize', {
      processId: process.pid,
      rootUri: toUri(cwd),
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: false }
        }
      },
      clientInfo: { name: 'saforall', version: '0.1.0' }
    })
    this.notify('initialized', {})
  }

  async openDocument(filePath: string, text: string): Promise<void> {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: toUri(filePath),
        languageId: this.languageId,
        version: 1,
        text
      }
    })
  }

  async changeDocument(filePath: string, text: string, version: number): Promise<void> {
    this.notify('textDocument/didChange', {
      textDocument: { uri: toUri(filePath), version },
      contentChanges: [{ text }]
    })
  }

  async closeDocument(filePath: string): Promise<void> {
    this.notify('textDocument/didClose', {
      textDocument: { uri: toUri(filePath) }
    })
  }

  async stop(): Promise<void> {
    if (!this.child) return
    try {
      await this.request('shutdown', null)
      this.notify('exit', undefined)
    } catch {
      // ignore
    }
    try {
      this.child.kill()
    } catch {
      // ignore
    }
    this.child = null
    for (const waiter of Array.from(this.waiters.values())) {
      waiter.reject(new Error('lsp closed'))
    }
    this.waiters.clear()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const len = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.slice(bodyStart, bodyStart + len)
      this.buffer = this.buffer.slice(bodyStart + len)
      try {
        this.handleMessage(JSON.parse(body) as LspMessage)
      } catch {
        // ignore
      }
    }
  }

  private handleMessage(msg: LspMessage): void {
    if (typeof msg.id === 'number' && this.waiters.has(msg.id)) {
      const waiter = this.waiters.get(msg.id)!
      this.waiters.delete(msg.id)
      if (msg.error) waiter.reject(new Error(msg.error.message ?? 'LSP error'))
      else waiter.resolve(msg)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics' && msg.params) {
      const uri = String(msg.params.uri ?? '')
      const path = fromUri(uri)
      const diags = Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : []
      const mapped: LspDiagnostic[] = diags.slice(0, 100).map((row: Record<string, unknown>) => {
        const range = (row.range ?? {}) as { start?: { line?: number; character?: number } }
        return {
          path,
          severity: severityFromLsp(row.severity),
          message: String(row.message ?? ''),
          line: Number(range.start?.line ?? 0) + 1,
          column: Number(range.start?.character ?? 0) + 1,
          source: this.sourceLabel
        }
      })
      this.emit('diagnostics', { path, diagnostics: mapped })
    }
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private request(method: string, params: unknown): Promise<LspMessage> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id)
          reject(new Error(`LSP timeout: ${method}`))
        }
      }, 15000)
    })
  }

  private write(payload: Record<string, unknown>): void {
    if (!this.child) return
    const body = JSON.stringify(payload)
    const message = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`
    this.child.stdin.write(message)
  }
}

export type LspServerConfig = {
  languageId: string
  extensions: string[]
  command: string
  args?: string[]
  source?: string
}

const DEFAULT_SERVERS: LspServerConfig[] = [
  {
    languageId: 'typescript',
    extensions: ['.ts', '.tsx'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    source: 'tsserver'
  },
  {
    languageId: 'python',
    extensions: ['.py'],
    command: process.platform === 'win32' ? 'pylsp.exe' : 'pylsp',
    args: [],
    source: 'pylsp'
  }
]

export class LspManager {
  private clients = new Map<string, LspClient>()
  private versions = new Map<string, number>()
  private onDiagnostics: ((items: LspDiagnostic[]) => void) | null = null
  private byPath = new Map<string, LspDiagnostic[]>()

  setDiagnosticsHandler(handler: (items: LspDiagnostic[]) => void): void {
    this.onDiagnostics = handler
  }

  private emitAll(): void {
    const all: LspDiagnostic[] = []
    for (const rows of Array.from(this.byPath.values())) all.push(...rows)
    this.onDiagnostics?.(all.slice(0, 300))
  }

  async ensureForFile(workspaceRoot: string, filePath: string, text: string): Promise<void> {
    const lower = filePath.toLowerCase()
    const config = DEFAULT_SERVERS.find((row) =>
      row.extensions.some((ext) => lower.endsWith(ext))
    )
    if (!config) return

    let client = this.clients.get(config.languageId)
    if (!client) {
      client = new LspClient(config.languageId, config.source ?? config.languageId)
      client.on('diagnostics', (payload: { path: string; diagnostics: LspDiagnostic[] }) => {
        this.byPath.set(payload.path.toLowerCase(), payload.diagnostics)
        this.emitAll()
      })
      try {
        await client.start(config.command, config.args ?? [], workspaceRoot)
        this.clients.set(config.languageId, client)
      } catch {
        // server binary missing — silently skip
        return
      }
    }

    const key = filePath.toLowerCase()
    const version = (this.versions.get(key) ?? 0) + 1
    this.versions.set(key, version)
    if (version === 1) await client.openDocument(filePath, text)
    else await client.changeDocument(filePath, text, version)
  }

  async dispose(): Promise<void> {
    for (const client of Array.from(this.clients.values())) {
      await client.stop()
    }
    this.clients.clear()
    this.byPath.clear()
    this.versions.clear()
  }
}

export const lspManager = new LspManager()
