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

function readJsonLines(
  child: ChildProcessWithoutNullStreams,
  onMessage: (msg: Record<string, unknown>) => void
): void {
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) break
      const header = buffer.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }
      const len = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + len) break
      const body = buffer.slice(bodyStart, bodyStart + len)
      buffer = buffer.slice(bodyStart + len)
      try {
        onMessage(JSON.parse(body) as Record<string, unknown>)
      } catch {
        // ignore
      }
    }
  })
}

function sendRpc(
  child: ChildProcessWithoutNullStreams,
  id: number,
  method: string,
  params?: Record<string, unknown>
): void {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const message = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n${payload}`
  child.stdin.write(message)
}

/** Best-effort tools/list against one stdio MCP server (timeout). */
export async function listMcpTools(
  server: McpServerConfig,
  cwd: string,
  timeoutMs = 8000
): Promise<McpToolInfo[]> {
  return new Promise((resolvePromise) => {
    const child = spawn(server.command, server.args ?? [], {
      cwd,
      env: { ...process.env, ...(server.env ?? {}) },
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(server.command)
    }) as ChildProcessWithoutNullStreams

    const tools: McpToolInfo[] = []
    let settled = false
    const finish = (result: McpToolInfo[]) => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolvePromise(result)
    }

    const timer = setTimeout(() => finish(tools), timeoutMs)

    readJsonLines(child, (msg) => {
      if (msg.id === 1) {
        sendRpc(child, 2, 'notifications/initialized')
        sendRpc(child, 3, 'tools/list', {})
      }
      if (msg.id === 3 && msg.result && typeof msg.result === 'object') {
        const list = (msg.result as { tools?: Array<{ name?: string; description?: string }> })
          .tools
        if (Array.isArray(list)) {
          for (const row of list) {
            if (!row?.name) continue
            tools.push({
              name: row.name,
              description: row.description,
              serverId: server.id
            })
          }
        }
        clearTimeout(timer)
        finish(tools)
      }
    })

    child.on('error', () => {
      clearTimeout(timer)
      finish([])
    })
    child.on('exit', () => {
      clearTimeout(timer)
      finish(tools)
    })

    sendRpc(child, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'saforall', version: '0.1.0' }
    })
  })
}

export async function listWorkspaceMcpTools(workspaceRoot: string): Promise<{
  servers: McpServerConfig[]
  tools: McpToolInfo[]
}> {
  const servers = await loadMcpConfig(workspaceRoot)
  const tools: McpToolInfo[] = []
  for (const server of servers.slice(0, 5)) {
    const listed = await listMcpTools(server, workspaceRoot)
    tools.push(...listed)
  }
  return { servers, tools }
}
