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

export function matchKeybinding(
  event: KeyboardEvent,
  bindings: KeybindingEntry[]
): KeybindingEntry | null {
  const pressed = normalizeKey(event)
  return bindings.find((row) => row.key === pressed) ?? null
}
