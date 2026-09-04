import {
  getActiveDebugSession,
  startDebugSession,
  stopDebugSession,
  type DebugBreakpoint,
  type DebugSession
} from './debugSession'
import { DapSession } from './dapSession'
import { buildDebugLaunch, DEBUG_INSPECT_PORT } from './lib/runCommands'

export type UnifiedDebugEvents = {
  ready: { port: number }
  paused: {
    reason: string
    callFrames: Array<{
      functionName: string
      url: string
      lineNumber: number
      columnNumber: number
      callFrameId?: string
    }>
    variables: Array<{ name: string; value: string; type?: string }>
  }
  resumed: Record<string, never>
  stdout: { text: string }
  stderr: { text: string }
  exited: { code: number | null }
  error: { message: string }
}

let activeKind: 'cdp' | 'dap' | null = null
let dap: DapSession | null = null

function wireDap(session: DapSession, onEvent: (type: string, payload: unknown) => void): void {
  session.on('ready', (p) => onEvent('ready', p))
  session.on('paused', (p) => onEvent('paused', p))
  session.on('resumed', (p) => onEvent('resumed', p))
  session.on('stdout', (p) => onEvent('stdout', p))
  session.on('stderr', (p) => onEvent('stderr', p))
  session.on('exited', (p) => onEvent('exited', p))
}

export async function startUnifiedDebug(params: {
  filePath: string
  cwd: string
  breakpoints: DebugBreakpoint[]
  port?: number
  onEvent: (channelPayload: Record<string, unknown>) => void
  onCdpCreated?: (session: DebugSession) => void
}): Promise<{ ok: true; port: number; display: string } | { ok: false; error: string }> {
  await stopUnifiedDebug()
  const lower = params.filePath.toLowerCase()

  if (lower.endsWith('.py')) {
    dap = new DapSession()
    activeKind = 'dap'
    wireDap(dap, (type, payload) => {
      params.onEvent({ type, ...(payload as object) })
    })
    try {
      const result = await dap.startPython({
        filePath: params.filePath,
        cwd: params.cwd,
        breakpoints: params.breakpoints,
        port: params.port
      })
      return {
        ok: true,
        port: result.port,
        display: `python -m debugpy --listen 127.0.0.1:${result.port} --wait-for-client ${params.filePath}`
      }
    } catch (error) {
      activeKind = null
      dap = null
      return {
        ok: false,
        error:
          error instanceof Error
            ? `${error.message}（debugpy が必要: pip install debugpy）`
            : String(error)
      }
    }
  }

  const launch = buildDebugLaunch(params.filePath, params.port ?? DEBUG_INSPECT_PORT)
  if (!launch) {
    return {
      ok: false,
      error: 'デバッグ対応は .js / .ts / .tsx / .py のみです'
    }
  }
  activeKind = 'cdp'
  try {
    await startDebugSession({
      command: launch.command,
      args: launch.args,
      cwd: params.cwd,
      breakpoints: params.breakpoints,
      port: launch.port,
      onCreated: params.onCdpCreated
    })
    return { ok: true, port: launch.port, display: launch.display }
  } catch (error) {
    activeKind = null
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function continueUnifiedDebug(): Promise<{ ok: boolean; error?: string }> {
  if (activeKind === 'dap' && dap) {
    await dap.continue()
    return { ok: true }
  }
  const session = getActiveDebugSession()
  if (!session) return { ok: false, error: 'no debug session' }
  await session.continue()
  return { ok: true }
}

export async function stepOverUnifiedDebug(): Promise<{ ok: boolean; error?: string }> {
  if (activeKind === 'dap' && dap) {
    await dap.stepOver()
    return { ok: true }
  }
  const session = getActiveDebugSession()
  if (!session) return { ok: false, error: 'no debug session' }
  await session.stepOver()
  return { ok: true }
}

export async function evaluateUnifiedDebug(
  expression: string,
  callFrameId?: string
): Promise<{ ok: boolean; value?: string; error?: string }> {
  try {
    if (activeKind === 'dap' && dap) {
      const value = await dap.evaluate(expression)
      return { ok: true, value }
    }
    const session = getActiveDebugSession()
    if (!session) return { ok: false, error: 'no debug session' }
    const value = await session.evaluate(expression, callFrameId)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function stopUnifiedDebug(): Promise<void> {
  if (activeKind === 'dap' && dap) {
    try {
      await dap.stop()
    } catch {
      // ignore
    }
    dap = null
  } else {
    await stopDebugSession()
  }
  activeKind = null
}
