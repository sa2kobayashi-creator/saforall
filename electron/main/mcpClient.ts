import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { delimiter, join } from 'path'

export type McpServerConfig = {
  id: string
  /** stdio transport */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** HTTP / streamable HTTP transport */
  url?: string
  headers?: Record<string, string>
  transport?: 'stdio' | 'http' | 'sse'
}

export type McpToolInfo = {
  name: string
  description?: string
  serverId: string
  inputSchema?: Record<string, unknown>
}

type McpJson = {
  servers?: Array<{
    id?: string
    name?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    transport?: string
  }>
  mcpServers?: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      transport?: string
    }
  >
}

/** Normalize one config row (stdio or HTTP). Exported for tests. */
export function normalizeMcpServerRow(
  id: string,
  row: {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    transport?: string
  }
): McpServerConfig | null {
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const command = typeof row.command === 'string' ? row.command.trim() : ''
  if (url) {
    if (!/^https?:\/\//i.test(url)) return null
    const transport =
      row.transport === 'sse' || row.transport === 'http' || row.transport === 'stdio'
        ? row.transport
        : 'http'
    return {
      id,
      url,
      headers: row.headers,
      transport: transport === 'stdio' ? 'http' : transport
    }
  }
  if (!command) return null
  return {
    id,
    command,
    args: row.args,
    env: row.env,
    transport: 'stdio'
  }
}

export function isHttpMcpServer(server: McpServerConfig): boolean {
  return Boolean(server.url?.trim())
}

type Waiter = {
  resolve: (msg: Record<string, unknown>) => void
  reject: (error: Error) => void
}

export async function loadMcpConfig(workspaceRoot: string): Promise<McpServerConfig[]> {
  const path = join(workspaceRoot, '.saforall', 'mcp.json')
  try {
    const raw = await readFile(path, 'utf-8')
    const json = JSON.parse(raw) as McpJson
    const out: McpServerConfig[] = []
    if (Array.isArray(json.servers)) {
      for (const row of json.servers) {
        const id = row.id || row.name || row.command || row.url || 'server'
        const normalized = normalizeMcpServerRow(id, row)
        if (normalized) out.push(normalized)
      }
    }
    if (json.mcpServers && typeof json.mcpServers === 'object') {
      for (const [id, row] of Object.entries(json.mcpServers)) {
        const normalized = normalizeMcpServerRow(id, row)
        if (normalized) out.push(normalized)
      }
    }
    return out
  } catch {
    return []
  }
}

function writeMessage(
  child: ChildProcessWithoutNullStreams,
  payload: Record<string, unknown>
): void {
  // Modern MCP stdio transport is newline-delimited JSON (not LSP Content-Length).
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

function windowsNodeDirs(): string[] {
  const dirs = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)']!, 'nodejs') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : ''
  ]
  return dirs.filter((dir) => dir && existsSync(dir))
}

function enrichPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extras = windowsNodeDirs()
  if (extras.length === 0) return env
  const current = env.PATH || env.Path || ''
  const merged = [...extras, ...current.split(delimiter).filter(Boolean)]
  const unique = Array.from(new Set(merged))
  return { ...env, PATH: unique.join(delimiter), Path: unique.join(delimiter) }
}

/** Resolve bare commands like `npx` for Electron on Windows (PATH often incomplete). */
export function resolveMcpCommand(command: string): { command: string; shell: boolean } {
  const trimmed = command.trim()
  if (!trimmed) return { command: trimmed, shell: false }

  // Absolute / relative path already provided
  if (/[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(trimmed)
    return { command: trimmed, shell }
  }

  if (process.platform !== 'win32') {
    return { command: trimmed, shell: false }
  }

  const candidates: string[] = []
  for (const dir of windowsNodeDirs()) {
    candidates.push(join(dir, `${trimmed}.cmd`), join(dir, `${trimmed}.exe`), join(dir, trimmed))
  }
  candidates.push(
    join('C:\\Program Files\\nodejs', `${trimmed}.cmd`),
    join('C:\\Program Files\\nodejs', `${trimmed}.exe`),
    join('C:\\Program Files\\nodejs', trimmed)
  )

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: candidate, shell: /\.(cmd|bat)$/i.test(candidate) }
    }
  }

  return { command: trimmed, shell: true }
}

type SpawnSpec = { command: string; args: string[]; shell: boolean }

/**
 * Build a spawn-safe command. Avoid `shell:true` with paths that contain spaces
 * (breaks on Windows: C:\\Program Files\\...). Prefer node + npx-cli.js for npx.
 * If @modelcontextprotocol/server-filesystem is available locally, run it directly.
 */
export function resolveMcpSpawn(
  command: string,
  args: string[] = [],
  cwd = process.cwd()
): SpawnSpec {
  const trimmed = command.trim()
  const lower = trimmed.toLowerCase()

  const fsPkgIdx = args.findIndex((arg) =>
    /@modelcontextprotocol\/server-filesystem/.test(arg)
  )
  if (fsPkgIdx >= 0) {
    const allowedDirs = args.slice(fsPkgIdx + 1)
    const entryCandidates = [
      join(cwd, 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js'),
      join(
        process.cwd(),
        'node_modules',
        '@modelcontextprotocol',
        'server-filesystem',
        'dist',
        'index.js'
      )
    ]
    for (const entry of entryCandidates) {
      if (!existsSync(entry)) continue
      for (const dir of [...windowsNodeDirs(), 'C:\\Program Files\\nodejs']) {
        const nodeExe = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
        if (existsSync(nodeExe)) {
          return {
            command: nodeExe,
            args: [entry, ...(allowedDirs.length > 0 ? allowedDirs : [cwd])],
            shell: false
          }
        }
      }
      return {
        command: process.platform === 'win32' ? 'node.exe' : 'node',
        args: [entry, ...(allowedDirs.length > 0 ? allowedDirs : [cwd])],
        shell: false
      }
    }
  }

  if (lower === 'npx' || lower.endsWith('\\npx') || lower.endsWith('\\npx.cmd') || lower === 'npx.cmd') {
    const nodeDirs = [
      ...windowsNodeDirs(),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs'
    ]
    for (const dir of nodeDirs) {
      const nodeExe = join(dir, 'node.exe')
      const npxCli = join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      if (existsSync(nodeExe) && existsSync(npxCli)) {
        return { command: nodeExe, args: [npxCli, ...args], shell: false }
      }
    }
  }

  if (lower === 'npm' || lower.endsWith('\\npm') || lower.endsWith('\\npm.cmd') || lower === 'npm.cmd') {
    const nodeDirs = [
      ...windowsNodeDirs(),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs'
    ]
    for (const dir of nodeDirs) {
      const nodeExe = join(dir, 'node.exe')
      const npmCli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      if (existsSync(nodeExe) && existsSync(npmCli)) {
        return { command: nodeExe, args: [npmCli, ...args], shell: false }
      }
    }
  }

  if (lower === 'node' || lower === 'node.exe') {
    for (const dir of [...windowsNodeDirs(), 'C:\\Program Files\\nodejs']) {
      const nodeExe = join(dir, 'node.exe')
      if (existsSync(nodeExe)) return { command: nodeExe, args, shell: false }
    }
  }

  const resolved = resolveMcpCommand(trimmed)
  if (resolved.shell && /\s/.test(resolved.command)) {
    const comspec = process.env.ComSpec || 'cmd.exe'
    const quotedCmd = `"${resolved.command}"`
    const quotedArgs = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(' ')
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `${quotedCmd} ${quotedArgs}`.trim()],
      shell: false
    }
  }

  return { command: resolved.command, args, shell: resolved.shell }
}

/** Persistent stdio MCP session (initialize → tools/list → tools/call). */
export class McpSession {
  readonly server: McpServerConfig
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private waiters = new Map<number, Waiter>()
  private tools: McpToolInfo[] = []
  private ready = false
  private stderrTail = ''

  constructor(server: McpServerConfig) {
    if (!server.command?.trim()) {
      throw new Error('stdio MCP server requires command')
    }
    this.server = server
  }

  get listedTools(): McpToolInfo[] {
    return this.tools
  }

  get isAlive(): boolean {
    return this.ready && this.child != null
  }

  async start(cwd: string, timeoutMs = 45_000): Promise<void> {
    await this.dispose()
    this.stderrTail = ''
    const spec = resolveMcpSpawn(this.server.command!, this.server.args ?? [], cwd)
    const env = enrichPath({ ...process.env, ...(this.server.env ?? {}) })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      this.child = spawn(spec.command, spec.args, {
        cwd,
        env,
        windowsHide: true,
        shell: spec.shell
      }) as ChildProcessWithoutNullStreams

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }

      this.child.once('spawn', () => {
        if (settled) return
        settled = true
        resolve()
      })
      this.child.once('error', (error) => {
        const message =
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? `コマンドが見つかりません: ${spec.command}（Node.js / npx の PATH を確認してください）`
            : error.message
        fail(new Error(message))
      })
      setTimeout(() => {
        if (!settled && this.child && !this.child.killed) {
          settled = true
          resolve()
        }
      }, 50)
    })

    if (!this.child) throw new Error('MCP spawn failed')

    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf-8')))
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf-8')).slice(-4000)
    })
    this.child.on('exit', (code) => {
      this.ready = false
      this.child = null
      const detail = this.stderrTail.trim()
      const message = detail
        ? `MCP server exited (${code ?? '?'}): ${detail.slice(0, 500)}`
        : `MCP server exited (${code ?? '?'})`
      for (const waiter of Array.from(this.waiters.values())) {
        waiter.reject(new Error(message))
      }
      this.waiters.clear()
    })
    this.child.on('error', (error) => {
      this.ready = false
      for (const waiter of Array.from(this.waiters.values())) {
        waiter.reject(error)
      }
      this.waiters.clear()
    })

    // npx may print "running on stdio" only after download; wait briefly before handshake
    await this.waitUntilServerBanner(12_000)

    const init = await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'saforall', version: '0.1.0' }
      },
      timeoutMs
    )
    if (init.error) {
      throw new Error(String((init.error as { message?: string }).message ?? 'initialize failed'))
    }
    this.notify('notifications/initialized', {})
    const listed = await this.request('tools/list', {}, timeoutMs)
    const tools = (listed.result as { tools?: Array<Record<string, unknown>> } | undefined)?.tools
    this.tools = []
    if (Array.isArray(tools)) {
      for (const row of tools) {
        const name = typeof row.name === 'string' ? row.name : ''
        if (!name) continue
        this.tools.push({
          name,
          description: typeof row.description === 'string' ? row.description : undefined,
          serverId: this.server.id,
          inputSchema:
            row.inputSchema && typeof row.inputSchema === 'object'
              ? (row.inputSchema as Record<string, unknown>)
              : undefined
        })
      }
    }
    this.ready = true
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000
  ): Promise<{ ok: boolean; content: string; isError?: boolean }> {
    if (!this.ready || !this.child) {
      throw new Error('MCP session not ready')
    }
    const response = await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs
    )
    if (response.error) {
      return {
        ok: false,
        content: String((response.error as { message?: string }).message ?? 'MCP tool error'),
        isError: true
      }
    }
    const result = (response.result ?? {}) as {
      content?: unknown
      isError?: boolean
    }
    const text = formatMcpContent(result.content)
    return {
      ok: !result.isError,
      content: text.slice(0, 24_000),
      isError: Boolean(result.isError)
    }
  }

  async dispose(): Promise<void> {
    this.ready = false
    for (const waiter of Array.from(this.waiters.values())) {
      waiter.reject(new Error('MCP disposed'))
    }
    this.waiters.clear()
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
    }
    this.child = null
    this.buffer = ''
    this.tools = []
  }

  private async waitUntilServerBanner(timeoutMs: number): Promise<void> {
    const readyRe = /running on stdio|MCP Server|started/i
    if (readyRe.test(this.stderrTail)) {
      await sleep(80)
      return
    }
    await new Promise<void>((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (readyRe.test(this.stderrTail) || Date.now() - started >= timeoutMs) {
          clearInterval(timer)
          resolve()
        }
      }, 50)
    })
    await sleep(80)
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child) return
    writeMessage(this.child, { jsonrpc: '2.0', method, params })
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    if (!this.child) return Promise.reject(new Error('MCP not started'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      writeMessage(this.child!, { jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id)
          reject(new Error(`MCP timeout: ${method}`))
        }
      }, timeoutMs)
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    while (true) {
      // Modern MCP stdio transport is newline-delimited JSON
      const nl = this.buffer.indexOf('\n')
      if (nl < 0) return
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) continue
      if (/^Content-Length:/i.test(line)) continue
      this.handleIncoming(line)
    }
  }

  private handleIncoming(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>
      if (typeof msg.id === 'number' && this.waiters.has(msg.id)) {
        const waiter = this.waiters.get(msg.id)!
        this.waiters.delete(msg.id)
        waiter.resolve(msg)
      }
    } catch {
      // ignore non-JSON noise
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatMcpContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((row) => {
        if (!row || typeof row !== 'object') return String(row)
        const item = row as { type?: string; text?: string; data?: unknown }
        if (typeof item.text === 'string') return item.text
        if (item.data != null) return JSON.stringify(item.data)
        return JSON.stringify(row)
      })
      .join('\n')
  }
  return JSON.stringify(content)
}

/** Extract JSON-RPC response from Streamable HTTP body (JSON or SSE). */
export function parseMcpHttpResponseBody(body: string, contentType: string): Record<string, unknown> {
  const ct = contentType.toLowerCase()
  if (ct.includes('text/event-stream') || body.includes('data:')) {
    const lines = body.split(/\r?\n/)
    let last: Record<string, unknown> | null = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed || 'id' in parsed)) {
          last = parsed
        }
      } catch {
        // ignore
      }
    }
    if (last) return last
    throw new Error('MCP SSE response had no JSON-RPC data')
  }
  const parsed = JSON.parse(body) as Record<string, unknown>
  return parsed
}

/**
 * Streamable HTTP MCP session (POST JSON-RPC; accepts JSON or SSE responses).
 * Spec slice: initialize → notifications/initialized → tools/list → tools/call.
 */
export class McpHttpSession {
  readonly server: McpServerConfig
  private nextId = 1
  private tools: McpToolInfo[] = []
  private ready = false
  private sessionId: string | null = null

  constructor(server: McpServerConfig) {
    if (!server.url?.trim()) throw new Error('HTTP MCP server requires url')
    this.server = server
  }

  get listedTools(): McpToolInfo[] {
    return this.tools
  }

  get isAlive(): boolean {
    return this.ready
  }

  async start(_cwd: string, timeoutMs = 45_000): Promise<void> {
    await this.dispose()
    const init = await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'saforall', version: '0.1.0' }
      },
      timeoutMs
    )
    if (init.error) {
      throw new Error(String((init.error as { message?: string }).message ?? 'initialize failed'))
    }
    await this.notify('notifications/initialized', {})
    const listed = await this.request('tools/list', {}, timeoutMs)
    const tools = (listed.result as { tools?: Array<Record<string, unknown>> } | undefined)?.tools
    this.tools = []
    if (Array.isArray(tools)) {
      for (const row of tools) {
        const name = typeof row.name === 'string' ? row.name : ''
        if (!name) continue
        this.tools.push({
          name,
          description: typeof row.description === 'string' ? row.description : undefined,
          serverId: this.server.id,
          inputSchema:
            row.inputSchema && typeof row.inputSchema === 'object'
              ? (row.inputSchema as Record<string, unknown>)
              : undefined
        })
      }
    }
    this.ready = true
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000
  ): Promise<{ ok: boolean; content: string; isError?: boolean }> {
    if (!this.ready) throw new Error('MCP HTTP session not ready')
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs)
    if (response.error) {
      return {
        ok: false,
        content: String((response.error as { message?: string }).message ?? 'MCP tool error'),
        isError: true
      }
    }
    const result = (response.result ?? {}) as { content?: unknown; isError?: boolean }
    const text = formatMcpContent(result.content)
    return {
      ok: !result.isError,
      content: text.slice(0, 24_000),
      isError: Boolean(result.isError)
    }
  }

  async dispose(): Promise<void> {
    this.ready = false
    this.sessionId = null
    this.tools = []
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.post({ jsonrpc: '2.0', method, params }, 15_000)
    } catch {
      // notifications may be fire-and-forget
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs)
  }

  private async post(
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const url = this.server.url!.trim()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.server.headers ?? {})
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      const sessionHeader = response.headers.get('mcp-session-id')
      if (sessionHeader) this.sessionId = sessionHeader
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 400)}`)
      }
      if (!text.trim()) {
        return { jsonrpc: '2.0', id: payload.id, result: {} }
      }
      return parseMcpHttpResponseBody(text, response.headers.get('content-type') ?? '')
    } finally {
      clearTimeout(timer)
    }
  }
}

export type AnyMcpSession = McpSession | McpHttpSession

export class McpManager {
  private sessions = new Map<string, AnyMcpSession>()
  private workspaceRoot = ''

  async ensureWorkspace(workspaceRoot: string): Promise<void> {
    if (this.workspaceRoot && this.workspaceRoot !== workspaceRoot) {
      await this.disposeAll()
    }
    this.workspaceRoot = workspaceRoot
  }

  private key(serverId: string): string {
    return `${this.workspaceRoot}::${serverId}`
  }

  async listWorkspaceTools(workspaceRoot: string): Promise<{
    servers: McpServerConfig[]
    tools: McpToolInfo[]
    statuses: Array<{ serverId: string; ok: boolean; toolCount: number; error?: string }>
    summary: string
  }> {
    await this.ensureWorkspace(workspaceRoot)
    const servers = await loadMcpConfig(workspaceRoot)
    const tools: McpToolInfo[] = []
    const statuses: Array<{ serverId: string; ok: boolean; toolCount: number; error?: string }> =
      []

    if (servers.length === 0) {
      return {
        servers,
        tools,
        statuses,
        summary: 'mcp.json が見つからないか、サーバー定義が空です'
      }
    }

    for (const server of servers.slice(0, 6)) {
      try {
        const session = await this.getOrStart(server, workspaceRoot)
        const listed = session.listedTools
        tools.push(...listed)
        statuses.push({
          serverId: server.id,
          ok: true,
          toolCount: listed.length
        })
      } catch (error) {
        statuses.push({
          serverId: server.id,
          ok: false,
          toolCount: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const okCount = statuses.filter((row) => row.ok).length
    const failCount = statuses.length - okCount
    const summary =
      failCount === 0
        ? `読込完了: サーバー ${okCount} / ツール ${tools.length} 件`
        : `読込完了（一部失敗）: 成功 ${okCount} · 失敗 ${failCount} · ツール ${tools.length} 件`

    return { servers, tools, statuses, summary }
  }

  async callTool(
    workspaceRoot: string,
    params: {
      serverId?: string
      tool: string
      arguments?: Record<string, unknown>
      timeoutMs?: number
    }
  ): Promise<{ ok: boolean; content: string; serverId?: string; error?: string }> {
    await this.ensureWorkspace(workspaceRoot)
    const servers = await loadMcpConfig(workspaceRoot)
    if (servers.length === 0) {
      return { ok: false, content: '', error: '.saforall/mcp.json にサーバーがありません' }
    }

    let server = params.serverId
      ? servers.find((row) => row.id === params.serverId)
      : undefined
    if (!server) {
      for (const candidate of servers.slice(0, 6)) {
        try {
          const session = await this.getOrStart(candidate, workspaceRoot)
          if (session.listedTools.some((tool) => tool.name === params.tool)) {
            server = candidate
            break
          }
        } catch {
          // continue
        }
      }
    }
    if (!server && params.serverId) {
      return { ok: false, content: '', error: `MCP server not found: ${params.serverId}` }
    }
    if (!server) {
      server = servers[0]
    }

    try {
      const session = await this.getOrStart(server, workspaceRoot)
      const result = await session.callTool(
        params.tool,
        params.arguments ?? {},
        params.timeoutMs ?? 60_000
      )
      return {
        ok: result.ok,
        content: result.content,
        serverId: server.id,
        error: result.isError ? result.content : undefined
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        serverId: server.id,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async getOrStart(server: McpServerConfig, cwd: string): Promise<AnyMcpSession> {
    const key = this.key(server.id)
    const existing = this.sessions.get(key)
    if (existing?.isAlive) return existing
    if (existing) await existing.dispose()
    const session: AnyMcpSession = isHttpMcpServer(server)
      ? new McpHttpSession(server)
      : new McpSession(server)
    await session.start(cwd)
    this.sessions.set(key, session)
    return session
  }

  async disposeAll(): Promise<void> {
    for (const session of Array.from(this.sessions.values())) {
      await session.dispose()
    }
    this.sessions.clear()
  }
}

export const mcpManager = new McpManager()

/** One-shot list (compat). Prefer mcpManager for call. */
export async function listWorkspaceMcpTools(workspaceRoot: string): Promise<{
  servers: McpServerConfig[]
  tools: McpToolInfo[]
}> {
  return mcpManager.listWorkspaceTools(workspaceRoot)
}
