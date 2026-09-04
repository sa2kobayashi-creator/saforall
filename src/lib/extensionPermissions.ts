import type { ExtensionPermission } from '../types/extensions'

const KNOWN: ExtensionPermission[] = [
  'terminal.run',
  'terminal.run.dangerous',
  'fs.read',
  'fs.write',
  'network'
]

const DANGEROUS =
  /\b(rm\s+-rf|del\s+\/s|format\s+|Remove-Item\s+-Recurse|Invoke-Expression|iex\s+|curl\s+[^\n]*\|\s*sh|wget\s+[^\n]*\|\s*sh)\b/i

export function normalizePermissions(raw: unknown): ExtensionPermission[] {
  if (!Array.isArray(raw)) return ['terminal.run']
  const out: ExtensionPermission[] = []
  for (const row of raw) {
    if (typeof row !== 'string') continue
    if ((KNOWN as string[]).includes(row) && !out.includes(row as ExtensionPermission)) {
      out.push(row as ExtensionPermission)
    }
  }
  return out.length > 0 ? out : ['terminal.run']
}

export function inferRequiredPermissions(command: string): ExtensionPermission[] {
  const required: ExtensionPermission[] = ['terminal.run']
  if (DANGEROUS.test(command)) {
    required.push('terminal.run.dangerous')
  }
  if (/\b(curl|wget|Invoke-WebRequest|fetch\()\b/i.test(command)) {
    required.push('network')
  }
  return required
}

export function permissionsLabel(perms: ExtensionPermission[]): string {
  return perms.join(', ')
}

const storageKey = (workspacePath: string) =>
  `saforall-ext-grants:${workspacePath.toLowerCase()}`

export function loadExtensionGrants(workspacePath: string): Record<string, ExtensionPermission[]> {
  try {
    const raw = window.localStorage.getItem(storageKey(workspacePath))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ExtensionPermission[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveExtensionGrants(
  workspacePath: string,
  grants: Record<string, ExtensionPermission[]>
): void {
  window.localStorage.setItem(storageKey(workspacePath), JSON.stringify(grants))
}

export function hasGrantedPermissions(
  granted: ExtensionPermission[] | undefined,
  required: ExtensionPermission[]
): boolean {
  if (!granted || granted.length === 0) return false
  return required.every((perm) => granted.includes(perm))
}
