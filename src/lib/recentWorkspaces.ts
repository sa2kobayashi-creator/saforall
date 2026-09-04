const STORAGE_KEY = 'saforall-recent-workspaces'
const MAX_RECENT = 12

export type RecentWorkspace = {
  path: string
  openedAt: string
}

export function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (row): row is RecentWorkspace =>
          !!row &&
          typeof row === 'object' &&
          typeof (row as RecentWorkspace).path === 'string' &&
          (row as RecentWorkspace).path.trim() !== ''
      )
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function pushRecentWorkspace(path: string): RecentWorkspace[] {
  const normalized = path.trim()
  if (!normalized) return loadRecentWorkspaces()
  const next: RecentWorkspace[] = [
    { path: normalized, openedAt: new Date().toISOString() },
    ...loadRecentWorkspaces().filter((row) => row.path !== normalized)
  ].slice(0, MAX_RECENT)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function removeRecentWorkspace(path: string): RecentWorkspace[] {
  const next = loadRecentWorkspaces().filter((row) => row.path !== path)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function folderNameFromPath(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}
