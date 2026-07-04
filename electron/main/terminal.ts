import { BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'

type PtyLike = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (info: { exitCode: number }) => void) => void
}

type Session = {
  id: string
  pty: PtyLike
}

const sessions = new Map<string, Session>()

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo']
    }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { file: shell, args: [] }
}

function createNodePty(cwd: string, cols: number, rows: number): PtyLike | null {
  try {
    // Native module: may fail under Electron ABI mismatch, then fallback is used.
    const pty = require('node-pty') as {
      spawn: (
        file: string,
        args: string[],
        options: Record<string, unknown>
      ) => {
        write: (data: string) => void
        resize: (cols: number, rows: number) => void
        kill: () => void
        onData: (cb: (data: string) => void) => void
        onExit: (cb: (event: { exitCode: number | undefined }) => void) => void
      }
    }
    const shell = defaultShell()
    const term = pty.spawn(shell.file, shell.args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: process.env
    })

    return {
      write: (data) => term.write(data),
      resize: (c, r) => term.resize(c, r),
      kill: () => term.kill(),
      onData: (cb) => {
        term.onData(cb)
      },
      onExit: (cb) => {
        term.onExit((event) => cb({ exitCode: event.exitCode ?? 0 }))
      }
    }
  } catch {
    return null
  }
}

function createProcessPty(cwd: string): PtyLike {
  const shell = defaultShell()
  const child: ChildProcessWithoutNullStreams = spawn(shell.file, shell.args, {
    cwd,
    env: process.env,
    windowsHide: true
  })

  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(info: { exitCode: number }) => void> = []

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    dataListeners.forEach((listener) => listener(text))
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    dataListeners.forEach((listener) => listener(text))
  })
  child.on('exit', (code) => {
    exitListeners.forEach((listener) => listener({ exitCode: code ?? 0 }))
  })

  return {
    write: (data) => {
      child.stdin.write(data)
    },
    resize: () => {
      // child_process フォールバックではリサイズ非対応
    },
    kill: () => {
      child.kill()
    },
    onData: (cb) => {
      dataListeners.push(cb)
    },
    onExit: (cb) => {
      exitListeners.push(cb)
    }
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function createTerminalSession(
  cwd?: string,
  cols = 80,
  rows = 24
): { id: string; backend: 'node-pty' | 'child_process' } {
  const workdir = cwd && cwd.trim() !== '' ? cwd : process.cwd()
  const id = randomUUID()
  const nodePty = createNodePty(workdir, cols, rows)
  const backend = nodePty ? 'node-pty' : 'child_process'
  const pty = nodePty ?? createProcessPty(workdir)

  pty.onData((data) => {
    broadcast('terminal:data', { id, data })
  })
  pty.onExit(({ exitCode }) => {
    sessions.delete(id)
    broadcast('terminal:exit', { id, exitCode })
  })

  sessions.set(id, { id, pty })
  return { id, backend }
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  sessions.get(id)?.pty.resize(cols, rows)
}

export function killTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.pty.kill()
  sessions.delete(id)
}

export function killAllTerminals(): void {
  Array.from(sessions.values()).forEach((session) => {
    session.pty.kill()
  })
  sessions.clear()
}
