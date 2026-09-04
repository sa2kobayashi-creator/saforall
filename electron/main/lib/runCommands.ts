export const DEBUG_INSPECT_PORT = 9229

export type DebugLaunchSpec = {
  command: string
  args: string[]
  port: number
  display: string
}

export function buildRunFileCommand(filePath: string, inspect = false): string | null {
  const lower = filePath.toLowerCase()
  const quoted = `"${filePath.replace(/"/g, '\\"')}"`

  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return inspect
      ? `node --inspect-brk=${DEBUG_INSPECT_PORT} ${quoted}`
      : `node ${quoted}`
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    if (inspect) {
      return `npx --yes tsx --inspect-brk=${DEBUG_INSPECT_PORT} ${quoted}`
    }
    return `npx --yes tsx ${quoted}`
  }
  if (lower.endsWith('.py')) {
    return `python ${quoted}`
  }
  if (lower.endsWith('.ps1')) {
    return `powershell -NoProfile -File ${quoted}`
  }
  return null
}

/** Spawn-ready launch for CDP debugger (js/ts only). Safe in Node / Electron main. */
export function buildDebugLaunch(
  filePath: string,
  port = DEBUG_INSPECT_PORT,
  platform: NodeJS.Platform = process.platform
): DebugLaunchSpec | null {
  const lower = filePath.toLowerCase()
  const npx = platform === 'win32' ? 'npx.cmd' : 'npx'

  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return {
      command: 'node',
      args: [`--inspect-brk=${port}`, filePath],
      port,
      display: `node --inspect-brk=${port} ${filePath}`
    }
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return {
      command: npx,
      args: ['--yes', 'tsx', `--inspect-brk=${port}`, filePath],
      port,
      display: `npx --yes tsx --inspect-brk=${port} ${filePath}`
    }
  }
  return null
}

export function buildNpmScriptCommand(script: string): string {
  const safe = script.replace(/[^a-zA-Z0-9:_-]/g, '')
  return `npm run ${safe || 'start'}`
}
