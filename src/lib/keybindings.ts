export type KeybindingEntry = {
  key: string
  command: string
  when?: string
}

function normalizeKey(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  if (key !== 'control' && key !== 'shift' && key !== 'alt' && key !== 'meta') {
    parts.push(key === ' ' ? 'space' : key)
  }
  return parts.join('+')
}

export function parseKeybindings(raw: string): KeybindingEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (row): row is KeybindingEntry =>
          !!row &&
          typeof row === 'object' &&
          typeof (row as KeybindingEntry).key === 'string' &&
          typeof (row as KeybindingEntry).command === 'string'
      )
      .map((row) => ({
        key: row.key.toLowerCase().replace(/\s+/g, ''),
        command: row.command,
        when: row.when
      }))
  } catch {
    return []
  }
}

export async function loadWorkspaceKeybindings(
  workspacePath: string | null
): Promise<KeybindingEntry[]> {
  if (!workspacePath) return []
  try {
    const path = `${workspacePath.replace(/[\\/]+$/, '')}${
      workspacePath.includes('\\') ? '\\' : '/'
    }.saforall/keybindings.json`
    const raw = await window.saforall.readFile(path)
    return parseKeybindings(raw)
  } catch {
    return []
  }
}

export function serializeKeybindings(entries: KeybindingEntry[]): string {
  const cleaned = entries
    .filter((row) => row.key.trim() && row.command.trim())
    .map((row) => ({
      key: row.key.trim().toLowerCase().replace(/\s+/g, ''),
      command: row.command.trim(),
      ...(row.when?.trim() ? { when: row.when.trim() } : {})
    }))
  return `${JSON.stringify(cleaned, null, 2)}\n`
}

export const DEFAULT_KEYBINDING_COMMANDS = [
  'file.save',
  'file.openFolder',
  'view.explorer',
  'view.search',
  'view.scm',
  'view.extensions',
  'view.terminal',
  'git.pull',
  'git.push',
  'editor.inlineEdit',
  'editor.format',
  'editor.blame'
] as const

export async function saveWorkspaceKeybindings(
  workspacePath: string,
  entries: KeybindingEntry[]
): Promise<string> {
  const sep = workspacePath.includes('\\') ? '\\' : '/'
  const path = `${workspacePath.replace(/[\\/]+$/, '')}${sep}.saforall${sep}keybindings.json`
  const body = serializeKeybindings(entries)
  await window.saforall.writeFile(path, body)
  return path
}

export function matchKeybinding(
  event: KeyboardEvent,
  bindings: KeybindingEntry[]
): KeybindingEntry | null {
  const pressed = normalizeKey(event)
  return bindings.find((row) => row.key === pressed) ?? null
}
