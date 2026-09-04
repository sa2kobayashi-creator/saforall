import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'

export type DebugCallFrame = {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
  callFrameId?: string
}

export type DebugVariable = {
  name: string
  value: string
  type?: string
}

export type DebugBreakpoint = {
  path: string
  line: number // 1-based
  condition?: string
}

type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
}

export type DebugSessionEvents = {
  ready: { port: number }
  paused: {
    reason: string
    callFrames: DebugCallFrame[]
    variables: DebugVariable[]
  }
  resumed: Record<string, never>
  stdout: { text: string }
  stderr: { text: string }
  exited: { code: number | null }
  error: { message: string }
}

type Waiter = {
  resolve: (value: CdpMessage) => void
  reject: (error: Error) => void
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`
  }
  return normalized.startsWith('file:') ? normalized : `file://${normalized}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DebugSession extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private socket: WebSocket | null = null
  private nextId = 1
  private waiters = new Map<number, Waiter>()
  private port = 9229
  private started = false
  private lastCallFrameId: string | null = null

  on<K extends keyof DebugSessionEvents>(
    event: K,
    listener: (payload: DebugSessionEvents[K]) => void
  ): this {
    return super.on(event, listener)
  }

  async start(params: {
    command: string
    args: string[]
    cwd: string
    breakpoints: DebugBreakpoint[]
    port?: number
  }): Promise<void> {
    if (this.started) {
      await this.stop()
    }
    this.port = params.port ?? 9229
    this.started = true

    this.child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: {
        ...process.env,
        NODE_OPTIONS: ''
      },
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(params.command)
    })

    this.child.stdout.on('data', (buf: Buffer) => {
      this.emit('stdout', { text: buf.toString('utf-8') })
    })
    this.child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8')
      this.emit('stderr', { text })
    })
    this.child.on('exit', (code) => {
      this.emit('exited', { code })
      void this.cleanupSocket()
      this.started = false
    })

    const wsUrl = await this.waitForInspector(this.port, 40)
    await this.connect(wsUrl)
    await this.send('Debugger.enable')
    await this.send('Runtime.enable')

    for (const bp of params.breakpoints) {
      await this.setBreakpoint(bp.path, bp.line, bp.condition)
    }

    await this.send('Runtime.runIfWaitingForDebugger')
    this.emit('ready', { port: this.port })
  }

  async setBreakpoint(
    filePath: string,
    line1Based: number,
    condition?: string
  ): Promise<void> {
    if (!this.socket) return
    const url = toFileUrl(filePath)
    const params: Record<string, unknown> = {
      lineNumber: Math.max(0, line1Based - 1),
      url
    }
    if (condition && condition.trim()) {
      params.condition = condition.trim()
    }
    await this.send('Debugger.setBreakpointByUrl', params)
    const escaped = filePath.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: Math.max(0, line1Based - 1),
      urlRegex: escaped,
      ...(condition && condition.trim() ? { condition: condition.trim() } : {})
    })
  }

  async continue(): Promise<void> {
    await this.send('Debugger.resume')
  }

  async stepOver(): Promise<void> {
    await this.send('Debugger.stepOver')
  }

  async stepInto(): Promise<void> {
    await this.send('Debugger.stepInto')
  }

  async evaluate(expression: string, callFrameId?: string): Promise<string> {
    const frameId = callFrameId || this.lastCallFrameId
    if (frameId) {
      const result = await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frameId,
        expression,
        returnByValue: true
      })
      return formatRemoteObject(
        (result.result?.result as Record<string, unknown> | undefined) ?? {}
      )
    }
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    return formatRemoteObject(
      (result.result?.result as Record<string, unknown> | undefined) ?? {}
    )
  }

  async stop(): Promise<void> {
    try {
      await this.send('Debugger.disable')
    } catch {
      // ignore
    }
    await this.cleanupSocket()
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    this.started = false
    this.lastCallFrameId = null
  }

  private async cleanupSocket(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // ignore
      }
    }
    this.socket = null
    for (const waiter of Array.from(this.waiters.values())) {
      waiter.reject(new Error('debug session closed'))
    }
    this.waiters.clear()
  }

  private async waitForInspector(port: number, attempts: number): Promise<string> {
    let lastError = 'inspector not ready'
    for (let i = 0; i < attempts; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        if (response.ok) {
          const list = (await response.json()) as Array<{ webSocketDebuggerUrl?: string }>
          const target = list.find((row) => row.webSocketDebuggerUrl)
          if (target?.webSocketDebuggerUrl) {
            return target.webSocketDebuggerUrl
          }
        }
        lastError = `HTTP ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      await sleep(150)
    }
    throw new Error(`Node inspector に接続できません: ${lastError}`)
  }

  private async connect(wsUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl)
      this.socket = socket
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')))
      socket.addEventListener('message', (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data)
          const msg = JSON.parse(raw) as CdpMessage
          if (typeof msg.id === 'number' && this.waiters.has(msg.id)) {
            const waiter = this.waiters.get(msg.id)!
            this.waiters.delete(msg.id)
            if (msg.error) {
              waiter.reject(new Error(msg.error.message ?? 'CDP error'))
            } else {
              waiter.resolve(msg)
            }
            return
          }
          if (msg.method === 'Debugger.paused') {
            void this.handlePaused(msg.params ?? {})
          }
          if (msg.method === 'Debugger.resumed') {
            this.lastCallFrameId = null
            this.emit('resumed', {})
          }
        } catch {
          // ignore malformed
        }
      })
    })
  }

  private async handlePaused(params: Record<string, unknown>): Promise<void> {
    const frames = Array.isArray(params.callFrames) ? params.callFrames : []
    const callFrames: DebugCallFrame[] = frames.map((frame: Record<string, unknown>) => {
      const loc = (frame.location ?? {}) as Record<string, unknown>
      return {
        functionName: String(frame.functionName || '(anonymous)'),
        url: String(frame.url || ''),
        lineNumber: Number(loc.lineNumber ?? 0) + 1,
        columnNumber: Number(loc.columnNumber ?? 0) + 1,
        callFrameId: typeof frame.callFrameId === 'string' ? frame.callFrameId : undefined
      }
    })
    this.lastCallFrameId = callFrames[0]?.callFrameId ?? null

    let variables: DebugVariable[] = []
    try {
      variables = await this.collectLocalVariables(frames[0] as Record<string, unknown> | undefined)
    } catch {
      variables = []
    }

    this.emit('paused', {
      reason: String(params.reason ?? 'pause'),
      callFrames,
      variables
    })
  }

  private async collectLocalVariables(
    frame: Record<string, unknown> | undefined
  ): Promise<DebugVariable[]> {
    if (!frame) return []
    const scopes = Array.isArray(frame.scopeChain) ? frame.scopeChain : []
    const local = scopes.find((scope: Record<string, unknown>) => scope.type === 'local')
      ?? scopes.find((scope: Record<string, unknown>) => scope.type === 'closure')
      ?? scopes[0]
    if (!local || typeof local !== 'object') return []
    const objectId = (local as { object?: { objectId?: string } }).object?.objectId
    if (!objectId) return []
    const result = await this.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true
    })
    const props = Array.isArray(result.result?.result) ? result.result?.result : []
    const out: DebugVariable[] = []
    for (const prop of props as Array<Record<string, unknown>>) {
      if (prop.name === 'this' || prop.name === 'arguments') continue
      const value = (prop.value ?? {}) as Record<string, unknown>
      out.push({
        name: String(prop.name ?? '?'),
        value: formatRemoteObject(value),
        type: typeof value.type === 'string' ? value.type : undefined
      })
      if (out.length >= 40) break
    }
    return out
  }

  private send(method: string, params?: Record<string, unknown>): Promise<CdpMessage> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('debugger socket is not open'))
    }
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      this.socket?.send(payload)
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 8000)
    })
  }
}

function formatRemoteObject(value: Record<string, unknown>): string {
  if (value.unserializableValue) return String(value.unserializableValue)
  if ('value' in value) {
    try {
      return JSON.stringify(value.value)
    } catch {
      return String(value.value)
    }
  }
  if (value.description) return String(value.description)
  if (value.type) return String(value.type)
  return 'undefined'
}

let active: DebugSession | null = null

export function getActiveDebugSession(): DebugSession | null {
  return active
}

export async function startDebugSession(params: {
  command: string
  args: string[]
  cwd: string
  breakpoints: DebugBreakpoint[]
  port?: number
  onCreated?: (session: DebugSession) => void
}): Promise<DebugSession> {
  if (active) {
    await active.stop()
  }
  active = new DebugSession()
  params.onCreated?.(active)
  await active.start(params)
  return active
}

export async function stopDebugSession(): Promise<void> {
  if (!active) return
  await active.stop()
  active = null
}
