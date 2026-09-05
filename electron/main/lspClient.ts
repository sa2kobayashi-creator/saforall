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

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  insertText?: string
  documentation?: string
}

export type LspLocation = {
  path: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export type LspHover = {
  contents: string
}

export type LspInlayHint = {
  label: string
  line: number
  column: number
  kind?: 'type' | 'parameter' | 'other'
  paddingLeft?: boolean
  paddingRight?: boolean
}

export type LspTextEdit = {
  path: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

export type LspDocumentSymbol = {
  name: string
  kind: number
  detail?: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  children?: LspDocumentSymbol[]
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

function formatHoverContents(contents: unknown): string {
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents
      .map((row) => formatHoverContents(row))
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof contents === 'object') {
    const row = contents as { kind?: string; value?: string; language?: string }
    if (typeof row.value === 'string') {
      if (row.language) return '```' + row.language + '\n' + row.value + '\n```'
      return row.value
    }
  }
  return String(contents)
}

function formatInlayLabel(label: unknown): string {
  if (typeof label === 'string') return label
  if (Array.isArray(label)) {
    return label
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as { value?: string }).value === 'string') {
          return (part as { value: string }).value
        }
        return ''
      })
      .join('')
  }
  return ''
}

function parseWorkspaceEdits(result: unknown): LspTextEdit[] {
  if (!result || typeof result !== 'object') return []
  const edits: LspTextEdit[] = []
  const changes = (result as { changes?: Record<string, unknown[]> }).changes
  if (changes && typeof changes === 'object') {
    for (const [uri, rows] of Object.entries(changes)) {
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        const edit = row as {
          newText?: string
          range?: {
            start?: { line?: number; character?: number }
            end?: { line?: number; character?: number }
          }
        }
        edits.push({
          path: fromUri(uri),
          startLine: Number(edit.range?.start?.line ?? 0) + 1,
          startColumn: Number(edit.range?.start?.character ?? 0) + 1,
          endLine: Number(edit.range?.end?.line ?? 0) + 1,
          endColumn: Number(edit.range?.end?.character ?? 0) + 1,
          newText: String(edit.newText ?? '')
        })
      }
    }
  }
  const documentChanges = (result as { documentChanges?: unknown[] }).documentChanges
  if (Array.isArray(documentChanges)) {
    for (const change of documentChanges) {
      if (!change || typeof change !== 'object') continue
      const uri = String((change as { textDocument?: { uri?: string } }).textDocument?.uri ?? '')
      const rows = (change as { edits?: unknown[] }).edits
      if (!uri || !Array.isArray(rows)) continue
      for (const row of rows) {
        const edit = row as {
          newText?: string
          range?: {
            start?: { line?: number; character?: number }
            end?: { line?: number; character?: number }
          }
        }
        edits.push({
          path: fromUri(uri),
          startLine: Number(edit.range?.start?.line ?? 0) + 1,
          startColumn: Number(edit.range?.start?.character ?? 0) + 1,
          endLine: Number(edit.range?.end?.line ?? 0) + 1,
          endColumn: Number(edit.range?.end?.character ?? 0) + 1,
          newText: String(edit.newText ?? '')
        })
      }
    }
  }
  return edits
}

function parseDocumentSymbols(result: unknown, filePath: string): LspDocumentSymbol[] {
  if (!Array.isArray(result)) return []
  const mapOne = (row: unknown): LspDocumentSymbol | null => {
    if (!row || typeof row !== 'object') return null
    const rec = row as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name : ''
    if (!name) return null
    const range =
      (rec.selectionRange as { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } | undefined) ||
      (rec.range as { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } | undefined) ||
      (rec.location as { range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } } | undefined)
        ?.range
    const childrenRaw = Array.isArray(rec.children) ? rec.children : []
    const children = childrenRaw
      .map(mapOne)
      .filter((item): item is LspDocumentSymbol => Boolean(item))
    return {
      name,
      kind: typeof rec.kind === 'number' ? rec.kind : 0,
      detail: typeof rec.detail === 'string' ? rec.detail : undefined,
      line: Number(range?.start?.line ?? 0) + 1,
      column: Number(range?.start?.character ?? 0) + 1,
      endLine: range?.end?.line != null ? Number(range.end.line) + 1 : undefined,
      endColumn: range?.end?.character != null ? Number(range.end.character) + 1 : undefined,
      children: children.length > 0 ? children : undefined
    }
  }
  const out: LspDocumentSymbol[] = []
  for (const row of result) {
    const mapped = mapOne(row)
    if (mapped) out.push(mapped)
  }
  // DocumentSymbol vs SymbolInformation — keep path unused but stable API
  void filePath
  return out.slice(0, 400)
}

function languageIdForPath(filePath: string, fallback: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return 'typescriptreact'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx')) return 'javascriptreact'
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')) {
    return 'javascript'
  }
  if (lower.endsWith('.py')) return 'python'
  return fallback
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
    this.child.on('error', (error) => {
      for (const waiter of Array.from(this.waiters.values())) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
      this.waiters.clear()
      this.child = null
      this.emit('exit')
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
          publishDiagnostics: { relatedInformation: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['plaintext', 'markdown']
            }
          },
          definition: { linkSupport: false },
          hover: {
            contentFormat: ['markdown', 'plaintext']
          },
          references: {},
          rename: { prepareSupport: false },
          formatting: { dynamicRegistration: false },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true
          },
          inlayHint: {
            resolveSupport: { properties: [] }
          }
        }
      },
      clientInfo: { name: 'saforall', version: '0.1.0' }
    })
    this.notify('initialized', {})
  }

  async openDocument(filePath: string, text: string, languageId?: string): Promise<void> {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: toUri(filePath),
        languageId: languageId || this.languageId,
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

  async completion(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspCompletionItem[]> {
    const response = await this.request('textDocument/completion', {
      textDocument: { uri: toUri(filePath) },
      position: { line, character }
    })
    const result = response.result
    const items = Array.isArray(result)
      ? result
      : result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)
        ? ((result as { items: unknown[] }).items)
        : []
    return items.slice(0, 80).map((row) => {
      const item = (row ?? {}) as Record<string, unknown>
      const label =
        typeof item.label === 'string'
          ? item.label
          : String((item.label as { label?: string } | undefined)?.label ?? '')
      const documentation =
        typeof item.documentation === 'string'
          ? item.documentation
          : item.documentation && typeof item.documentation === 'object'
            ? String((item.documentation as { value?: string }).value ?? '')
            : undefined
      return {
        label,
        kind: typeof item.kind === 'number' ? item.kind : undefined,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        insertText:
          typeof item.insertText === 'string'
            ? item.insertText
            : typeof item.textEdit === 'object' && item.textEdit
              ? String((item.textEdit as { newText?: string }).newText ?? label)
              : label,
        documentation
      }
    }).filter((row) => row.label)
  }

  async definition(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspLocation[]> {
    const response = await this.request('textDocument/definition', {
      textDocument: { uri: toUri(filePath) },
      position: { line, character }
    })
    const result = response.result
    const rows = Array.isArray(result) ? result : result ? [result] : []
    const locations: LspLocation[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const loc = row as {
        uri?: string
        targetUri?: string
        range?: { start?: { line?: number; character?: number } }
        targetRange?: { start?: { line?: number; character?: number } }
        targetSelectionRange?: { start?: { line?: number; character?: number } }
      }
      const uri = loc.uri ?? loc.targetUri
      if (!uri) continue
      const start =
        loc.range?.start ??
        loc.targetSelectionRange?.start ??
        loc.targetRange?.start ??
        {}
      locations.push({
        path: fromUri(uri),
        line: Number(start.line ?? 0) + 1,
        column: Number(start.character ?? 0) + 1
      })
    }
    return locations.slice(0, 20)
  }

  async hover(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspHover | null> {
    const response = await this.request('textDocument/hover', {
      textDocument: { uri: toUri(filePath) },
      position: { line, character }
    })
    const result = response.result
    if (!result || typeof result !== 'object') return null
    const contents = (result as { contents?: unknown }).contents
    const text = formatHoverContents(contents)
    if (!text.trim()) return null
    return { contents: text.slice(0, 8000) }
  }

  async references(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspLocation[]> {
    const response = await this.request('textDocument/references', {
      textDocument: { uri: toUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: true }
    })
    const result = response.result
    const rows = Array.isArray(result) ? result : []
    const locations: LspLocation[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const loc = row as {
        uri?: string
        range?: {
          start?: { line?: number; character?: number }
          end?: { line?: number; character?: number }
        }
      }
      if (!loc.uri) continue
      locations.push({
        path: fromUri(loc.uri),
        line: Number(loc.range?.start?.line ?? 0) + 1,
        column: Number(loc.range?.start?.character ?? 0) + 1,
        endLine: Number(loc.range?.end?.line ?? loc.range?.start?.line ?? 0) + 1,
        endColumn: Number(loc.range?.end?.character ?? loc.range?.start?.character ?? 0) + 1
      })
    }
    return locations.slice(0, 100)
  }

  async inlayHints(
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ): Promise<LspInlayHint[]> {
    const response = await this.request('textDocument/inlayHint', {
      textDocument: { uri: toUri(filePath) },
      range: {
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter }
      }
    })
    const result = response.result
    const rows = Array.isArray(result) ? result : []
    const hints: LspInlayHint[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const item = row as {
        label?: unknown
        position?: { line?: number; character?: number }
        kind?: number
        paddingLeft?: boolean
        paddingRight?: boolean
      }
      const label = formatInlayLabel(item.label)
      if (!label) continue
      const kindNum = Number(item.kind ?? 0)
      hints.push({
        label: label.slice(0, 80),
        line: Number(item.position?.line ?? 0) + 1,
        column: Number(item.position?.character ?? 0) + 1,
        kind: kindNum === 1 ? 'type' : kindNum === 2 ? 'parameter' : 'other',
        paddingLeft: item.paddingLeft,
        paddingRight: item.paddingRight
      })
    }
    return hints.slice(0, 200)
  }

  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string
  ): Promise<LspTextEdit[]> {
    const response = await this.request('textDocument/rename', {
      textDocument: { uri: toUri(filePath) },
      position: { line, character },
      newName
    })
    return parseWorkspaceEdits(response.result)
  }

  async formatDocument(filePath: string): Promise<LspTextEdit[]> {
    const response = await this.request('textDocument/formatting', {
      textDocument: { uri: toUri(filePath) },
      options: { tabSize: 2, insertSpaces: true }
    })
    const result = response.result
    if (!Array.isArray(result)) return []
    const edits: LspTextEdit[] = []
    for (const row of result) {
      if (!row || typeof row !== 'object') continue
      const edit = row as {
        newText?: string
        range?: {
          start?: { line?: number; character?: number }
          end?: { line?: number; character?: number }
        }
      }
      edits.push({
        path: filePath,
        startLine: Number(edit.range?.start?.line ?? 0) + 1,
        startColumn: Number(edit.range?.start?.character ?? 0) + 1,
        endLine: Number(edit.range?.end?.line ?? 0) + 1,
        endColumn: Number(edit.range?.end?.character ?? 0) + 1,
        newText: String(edit.newText ?? '')
      })
    }
    return edits
  }

  async documentSymbols(filePath: string): Promise<LspDocumentSymbol[]> {
    const response = await this.request('textDocument/documentSymbol', {
      textDocument: { uri: toUri(filePath) }
    })
    return parseDocumentSymbols(response.result, filePath)
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
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
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

function resolveLspCommand(command: string): string {
  if (process.platform !== 'win32') return command
  if (/\.(cmd|exe|bat)$/i.test(command)) return command
  return `${command}.cmd`
}

function normalizeDiagPath(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLowerCase()
}

export class LspManager {
  private clients = new Map<string, LspClient>()
  private versions = new Map<string, number>()
  private onDiagnostics: ((items: LspDiagnostic[]) => void) | null = null
  private byPath = new Map<string, LspDiagnostic[]>()
  private failedAt = new Map<string, number>()
  private readonly failCooldownMs = 8_000
  private syncQueue = new Map<string, { cwd: string; content: string; seq: number }>()
  private syncSeq = 0

  setDiagnosticsHandler(handler: (items: LspDiagnostic[]) => void): void {
    this.onDiagnostics = handler
  }

  private emitAll(): void {
    const all: LspDiagnostic[] = []
    for (const rows of Array.from(this.byPath.values())) all.push(...rows)
    this.onDiagnostics?.(all.slice(0, 300))
  }

  private clearDiagnosticsForLanguage(source: string): void {
    let changed = false
    for (const [path, rows] of Array.from(this.byPath.entries())) {
      const next = rows.filter((row) => row.source !== source)
      if (next.length !== rows.length) {
        changed = true
        if (next.length === 0) this.byPath.delete(path)
        else this.byPath.set(path, next)
      }
    }
    if (changed) this.emitAll()
  }

  private bindClient(config: LspServerConfig, client: LspClient): void {
    client.on('diagnostics', (payload: { path: string; diagnostics: LspDiagnostic[] }) => {
      this.byPath.set(normalizeDiagPath(payload.path), payload.diagnostics)
      this.emitAll()
    })
    client.on('exit', () => {
      this.clients.delete(config.languageId)
      this.clearDiagnosticsForLanguage(config.source ?? config.languageId)
      this.failedAt.set(config.languageId, Date.now())
      // Drop open versions so next sync re-opens documents
      for (const key of Array.from(this.versions.keys())) {
        const match = DEFAULT_SERVERS.find((row) =>
          row.extensions.some((ext) => key.endsWith(ext))
        )
        if (match?.languageId === config.languageId) this.versions.delete(key)
      }
    })
  }

  async ensureForFile(workspaceRoot: string, filePath: string, text: string): Promise<void> {
    const lower = filePath.toLowerCase()
    const config = DEFAULT_SERVERS.find((row) =>
      row.extensions.some((ext) => lower.endsWith(ext))
    )
    if (!config) return

    const pathKey = normalizeDiagPath(filePath)
    const seq = ++this.syncSeq
    this.syncQueue.set(pathKey, { cwd: workspaceRoot, content: text, seq })

    const failed = this.failedAt.get(config.languageId)
    if (failed && Date.now() - failed < this.failCooldownMs) return

    let client = this.clients.get(config.languageId)
    if (!client) {
      client = new LspClient(config.languageId, config.source ?? config.languageId)
      this.bindClient(config, client)
      try {
        await client.start(resolveLspCommand(config.command), config.args ?? [], workspaceRoot)
        this.clients.set(config.languageId, client)
        this.failedAt.delete(config.languageId)
      } catch {
        this.failedAt.set(config.languageId, Date.now())
        return
      }
    }

    // Only apply the latest queued content for this path
    const queued = this.syncQueue.get(pathKey)
    if (!queued || queued.seq !== seq) return

    const version = (this.versions.get(pathKey) ?? 0) + 1
    this.versions.set(pathKey, version)
    const languageId = languageIdForPath(filePath, config.languageId)
    try {
      if (version === 1) await client.openDocument(filePath, queued.content, languageId)
      else await client.changeDocument(filePath, queued.content, version)
    } catch {
      // Restart tsserver/pylsp on transport errors (common for JS/TS churn)
      await client.stop().catch(() => undefined)
      this.clients.delete(config.languageId)
      this.versions.delete(pathKey)
      this.failedAt.set(config.languageId, Date.now())
    }
  }

  async closeDocument(filePath: string): Promise<void> {
    const pathKey = normalizeDiagPath(filePath)
    const client = this.clientForPath(filePath)
    if (client) {
      try {
        await client.closeDocument(filePath)
      } catch {
        // ignore
      }
    }
    this.byPath.delete(pathKey)
    this.versions.delete(pathKey)
    this.syncQueue.delete(pathKey)
    this.emitAll()
  }

  private clientForPath(filePath: string): LspClient | null {
    const lower = filePath.toLowerCase()
    const config = DEFAULT_SERVERS.find((row) =>
      row.extensions.some((ext) => lower.endsWith(ext))
    )
    if (!config) return null
    return this.clients.get(config.languageId) ?? null
  }

  async completion(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspCompletionItem[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.completion(filePath, line, character)
    } catch {
      return []
    }
  }

  async definition(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspLocation[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.definition(filePath, line, character)
    } catch {
      return []
    }
  }

  async hover(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspHover | null> {
    const client = this.clientForPath(filePath)
    if (!client) return null
    try {
      return await client.hover(filePath, line, character)
    } catch {
      return null
    }
  }

  async references(
    filePath: string,
    line: number,
    character: number
  ): Promise<LspLocation[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.references(filePath, line, character)
    } catch {
      return []
    }
  }

  async inlayHints(
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ): Promise<LspInlayHint[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.inlayHints(
        filePath,
        startLine,
        startCharacter,
        endLine,
        endCharacter
      )
    } catch {
      return []
    }
  }

  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string
  ): Promise<LspTextEdit[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.rename(filePath, line, character, newName)
    } catch {
      return []
    }
  }

  async formatDocument(filePath: string): Promise<LspTextEdit[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.formatDocument(filePath)
    } catch {
      return []
    }
  }

  async documentSymbols(filePath: string): Promise<LspDocumentSymbol[]> {
    const client = this.clientForPath(filePath)
    if (!client) return []
    try {
      return await client.documentSymbols(filePath)
    } catch {
      return []
    }
  }

  async dispose(): Promise<void> {
    for (const client of Array.from(this.clients.values())) {
      await client.stop()
    }
    this.clients.clear()
    this.byPath.clear()
    this.versions.clear()
    this.syncQueue.clear()
    this.failedAt.clear()
    this.emitAll()
  }
}

export const lspManager = new LspManager()
