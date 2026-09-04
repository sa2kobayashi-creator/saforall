import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'

export type McpServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
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
  }>
  mcpServers?: Record<
    string,
    { command?: string; args?: string[]; env?: Record<string, string> }
  >
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
        if (!row?.command) continue
        out.push({
          id: row.id || row.name || row.command,
          command: row.command,
          args: row.args,
          env: row.env
        })
      }
    }
    if (json.mcpServers && typeof json.mcpServers === 'object') {
      for (const [id, row] of Object.entries(json.mcpServers)) {
        if (!row?.command) continue
        out.push({ id, command: row.command, args: row.args, env: row.env })
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
  const body = JSON.stringify(payload)
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`)
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

  constructor(server: McpServerConfig) {
    this.server = server
  }

  get listedTools(): McpToolInfo[] {
    return this.tools
  }

  get isAlive(): boolean {
    return this.ready && this.child != null
  }

  async start(cwd: string, timeoutMs = 12_000): Promise<void> {
    await this.dispose()
    this.child = spawn(this.server.command, this.server.args ?? [], {
      cwd,
      env: { ...process.env, ...(this.server.env ?? {}) },
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(this.server.command)
    }) as ChildProcessWithoutNullStreams

    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf-8')))
    this.child.stderr.on('data', () => {
      // keep process alive; stderr often has logs
    })
    this.child.on('exit', () => {
      this.ready = false
      this.child = null
      for (const waiter of Array.from(this.waiters.values())) {
        waiter.reject(new Error('MCP server exited'))
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
        const msg = JSON.parse(body) as Record<string, unknown>
        if (typeof msg.id === 'number' && this.waiters.has(msg.id)) {
          const waiter = this.waiters.get(msg.id)!
          this.waiters.delete(msg.id)
          waiter.resolve(msg)
        }
      } catch {
        // ignore
      }
    }
  }
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

export class McpManager {
  private sessions = new Map<string, McpSession>()
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
  }> {
    await this.ensureWorkspace(workspaceRoot)
    const servers = await loadMcpConfig(workspaceRoot)
    const tools: McpToolInfo[] = []
    for (const server of servers.slice(0, 6)) {
      try {
        const session = await this.getOrStart(server, workspaceRoot)
        tools.push(...session.listedTools)
      } catch {
        // server missing / failed — skip
      }
    }
    return { servers, tools }
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
      // Resolve by tool name across started/listable servers
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

  private async getOrStart(server: McpServerConfig, cwd: string): Promise<McpSession> {
    const key = this.key(server.id)
    const existing = this.sessions.get(key)
    if (existing?.isAlive) return existing
    if (existing) await existing.dispose()
    const session = new McpSession(server)
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
