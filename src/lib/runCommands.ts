export function buildRunFileCommand(filePath: string, inspect = false): string | null {
  const lower = filePath.toLowerCase()
  const quoted = `"${filePath.replace(/"/g, '\\"')}"`

  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return inspect ? `node --inspect ${quoted}` : `node ${quoted}`
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    // Prefer tsx/ts-node when available; fall back to node --experimental-strip-types on modern Node
    if (inspect) {
      return `npx --yes tsx --inspect ${quoted}`
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

export function buildNpmScriptCommand(script: string): string {
  const safe = script.replace(/[^a-zA-Z0-9:_-]/g, '')
  return `npm run ${safe || 'start'}`
}
