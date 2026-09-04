import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { createConnection, type Socket } from 'net'

export type DapBreakpoint = { path: string; line: number; condition?: string }
export type DapFrame = {
  id: number
  name: string
  path: string
  line: number
  column: number
}
export type DapVariable = { name: string; value: string; type?: string }

type DapMessage = {
  seq?: number
  type?: string
  event?: string
  command?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: Record<string, unknown>
  arguments?: Record<string, unknown>
}

/**
 * Minimal Debug Adapter Protocol client over a TCP socket.
 * Used for Python debugpy attach.
 */
export class DapSession extends EventEmitter {
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private nextSeq = 1
  private waiters = new Map<
    number,
    { resolve: (msg: DapMessage) => void; reject: (error: Error) => void }
  >()
  private child: ChildProcessWithoutNullStreams | null = null
  private currentThreadId = 1

  async startPython(params: {
    filePath: string
    cwd: string
    breakpoints: DapBreakpoint[]
    port?: number
  }): Promise<void> {
    const port = params.port ?? 5678
    await this.stop()

    // Start debugpy waiting for client
    const py = process.platform === 'win32' ? 'python' : 'python3'
    this.child = spawn(
      py,
      ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', params.filePath],
      {
        cwd: params.cwd,
        windowsHide: true,
        env: { ...process.env }
      }
    )
    this.child.stdout.on('data', (buf: Buffer) => this.emit('stdout', { text: buf.toString('utf-8') }))
    this.child.stderr.on('data', (buf: Buffer) => this.emit('stderr', { text: buf.toString('utf-8') }))
    this.child.on('exit', (code) => {
      this.emit('exited', { code })
      void this.cleanup()
    })

    await sleep(500)
    await this.connect(port)
    await this.request('initialize', {
      clientID: 'saforall',
      adapterID: 'python',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true
    })
    await this.request('attach', {
      name: 'Python',
      type: 'python',
      request: 'attach',
      connect: { host: '127.0.0.1', port }
    })

    // Set breakpoints per file
    const byFile = new Map<string, DapBreakpoint[]>()
    for (const bp of params.breakpoints) {
      const list = byFile.get(bp.path) ?? []
      list.push(bp)
      byFile.set(bp.path, list)
    }
    for (const [path, list] of Array.from(byFile.entries())) {
      await this.request('setBreakpoints', {
        source: { path },
        breakpoints: list.map((row) => ({
          line: row.line,
          condition: row.condition
        }))
      })
    }
    await this.request('configurationDone', {})
    this.emit('ready', { port })
  }

  async continue(): Promise<void> {
    await this.request('continue', { threadId: this.currentThreadId })
  }

  async stepOver(): Promise<void> {
    await this.request('next', { threadId: this.currentThreadId })
  }

  async evaluate(expression: string): Promise<string> {
    const result = await this.request('evaluate', {
      expression,
      context: 'watch',
      frameId: undefined
    })
    return String(result.body?.result ?? '')
  }

  async stop(): Promise<void> {
    try {
      await this.request('disconnect', { terminateDebuggee: true })
    } catch {
      // ignore
    }
    await this.cleanup()
  }

  private async cleanup(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {
        // ignore
      }
    }
    this.socket = null
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    for (const waiter of Array.from(this.waiters.values())) {
      waiter.reject(new Error('dap closed'))
    }
    this.waiters.clear()
  }

  private async connect(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => resolve())
      this.socket = socket
      socket.on('data', (chunk: Buffer) => this.onData(chunk))
      socket.on('error', (error: Error) => reject(error))
      socket.on('close', () => {
        this.socket = null
      })
      setTimeout(() => reject(new Error('DAP connect timeout')), 8000)
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.slice(0, headerEnd).toString('utf-8')
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const len = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.slice(bodyStart, bodyStart + len).toString('utf-8')
      this.buffer = this.buffer.slice(bodyStart + len)
      try {
        void this.handleMessage(JSON.parse(body) as DapMessage)
      } catch {
        // ignore
      }
    }
  }

  private async handleMessage(msg: DapMessage): Promise<void> {
    if (msg.type === 'response' && typeof msg.request_seq === 'number') {
      const waiter = this.waiters.get(msg.request_seq)
      if (waiter) {
        this.waiters.delete(msg.request_seq)
        if (msg.success === false) waiter.reject(new Error(msg.message ?? 'DAP error'))
        else waiter.resolve(msg)
      }
      return
    }
    if (msg.type === 'event') {
      if (msg.event === 'stopped') {
        const body = msg.body ?? {}
        this.currentThreadId = Number(body.threadId ?? 1)
        const stack = await this.request('stackTrace', {
          threadId: this.currentThreadId,
          startFrame: 0,
          levels: 20
        })
        const framesRaw = Array.isArray(stack.body?.stackFrames) ? stack.body?.stackFrames : []
        const callFrames: DapFrame[] = (framesRaw as Array<Record<string, unknown>>).map((frame) => {
          const source = (frame.source ?? {}) as { path?: string }
          return {
            id: Number(frame.id ?? 0),
            name: String(frame.name ?? '(anonymous)'),
            path: String(source.path ?? ''),
            line: Number(frame.line ?? 1),
            column: Number(frame.column ?? 1)
          }
        })
        let variables: DapVariable[] = []
        if (callFrames[0]) {
          try {
            const scopes = await this.request('scopes', { frameId: callFrames[0].id })
            const scopeList = Array.isArray(scopes.body?.scopes) ? scopes.body?.scopes : []
            const locals = (scopeList as Array<Record<string, unknown>>).find(
              (row) => String(row.name ?? '').toLowerCase() === 'locals'
            ) ?? scopeList[0]
            if (locals && typeof (locals as { variablesReference?: number }).variablesReference === 'number') {
              const vars = await this.request('variables', {
                variablesReference: (locals as { variablesReference: number }).variablesReference
              })
              const list = Array.isArray(vars.body?.variables) ? vars.body?.variables : []
              variables = (list as Array<Record<string, unknown>>).slice(0, 40).map((row) => ({
                name: String(row.name ?? ''),
                value: String(row.value ?? ''),
                type: typeof row.type === 'string' ? row.type : undefined
              }))
            }
          } catch {
            variables = []
          }
        }
        this.emit('paused', {
          reason: String(body.reason ?? 'pause'),
          callFrames: callFrames.map((frame) => ({
            functionName: frame.name,
            url: frame.path,
            lineNumber: frame.line,
            columnNumber: frame.column,
            callFrameId: String(frame.id)
          })),
          variables
        })
      }
      if (msg.event === 'continued') this.emit('resumed', {})
      if (msg.event === 'output') {
        const text = String((msg.body ?? {}).output ?? '')
        if (text) this.emit('stdout', { text })
      }
    }
  }

  private request(command: string, args: Record<string, unknown>): Promise<DapMessage> {
    const seq = this.nextSeq++
    const payload: DapMessage = {
      seq,
      type: 'request',
      command,
      arguments: args
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(seq, { resolve, reject })
      this.write(payload)
      setTimeout(() => {
        if (this.waiters.has(seq)) {
          this.waiters.delete(seq)
          reject(new Error(`DAP timeout: ${command}`))
        }
      }, 12000)
    })
  }

  private write(payload: DapMessage): void {
    if (!this.socket) throw new Error('DAP socket not connected')
    const body = JSON.stringify(payload)
    const message = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`
    this.socket.write(message)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
