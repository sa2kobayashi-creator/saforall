export type ModelApiStatus = 'checking' | 'online' | 'offline'

/**
 * Chip / badge for users: Model API reachability, not PHP-vs-JSON storage.
 * Packaged exe is always "local storage"; that must not look like the product is offline.
 */
export function resolveModelApiStatus(input: {
  checking?: boolean
  hasKey: boolean
  networkOnline: boolean
  phpConnected?: boolean
}): ModelApiStatus {
  if (input.checking) return 'checking'
  if (!input.networkOnline) return 'offline'
  if (input.hasKey || input.phpConnected) return 'online'
  return 'offline'
}
