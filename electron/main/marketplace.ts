export type MarketplaceExtension = {
  id: string
  name: string
  description: string
  url: string
  downloads?: number
}

/** Open VSX search — browse only (no VSIX install runtime yet). */
export async function searchOpenVsx(
  query: string,
  size = 20
): Promise<{ ok: boolean; items: MarketplaceExtension[]; error?: string }> {
  const q = query.trim()
  if (!q) return { ok: true, items: [] }
  try {
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=${size}`
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      return { ok: false, items: [], error: `Open VSX HTTP ${response.status}` }
    }
    const json = (await response.json()) as {
      extensions?: Array<{
        namespace?: string
        name?: string
        displayName?: string
        description?: string
        files?: { download?: string }
        downloadCount?: number
      }>
    }
    const items: MarketplaceExtension[] = (json.extensions ?? []).slice(0, size).map((row) => {
      const namespace = row.namespace || 'unknown'
      const name = row.name || row.displayName || 'extension'
      return {
        id: `${namespace}.${name}`,
        name: row.displayName || name,
        description: row.description || '',
        url: `https://open-vsx.org/extension/${namespace}/${name}`,
        downloads: row.downloadCount
      }
    })
    return { ok: true, items }
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
