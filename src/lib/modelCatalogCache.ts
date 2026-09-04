import type { ModelOption, ProviderEngine } from './llmModels'
import { catalogFor, USAGE_ENGINE_KEYS } from './llmModels'

const storageKey = (engine: ProviderEngine) => `saforall-model-catalog:${engine}`

type CachedCatalog = {
  fetchedAt: string
  models: ModelOption[]
}

export function loadCachedCatalog(engine: ProviderEngine): ModelOption[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(engine))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedCatalog
    if (!Array.isArray(parsed?.models) || parsed.models.length === 0) return null
    return parsed.models.filter(
      (row): row is ModelOption =>
        !!row && typeof row.id === 'string' && row.id.trim() !== ''
    )
  } catch {
    return null
  }
}

export function saveCachedCatalog(engine: ProviderEngine, models: ModelOption[]): void {
  if (models.length === 0) return
  const payload: CachedCatalog = {
    fetchedAt: new Date().toISOString(),
    models
  }
  window.localStorage.setItem(storageKey(engine), JSON.stringify(payload))
}

export function mergeCatalogWithBuiltin(
  engine: ProviderEngine,
  fetched: ModelOption[]
): ModelOption[] {
  const builtin = catalogFor(engine)
  const byId = new Map(fetched.map((item) => [item.id, item]))
  for (const item of builtin) {
    const hit = byId.get(item.id)
    if (hit) {
      byId.set(item.id, { ...hit, label: item.label, tier: item.tier, costRank: item.costRank })
    } else {
      byId.set(item.id, item)
    }
  }
  return Array.from(byId.values())
}

export function initialCatalogOptions(engine: ProviderEngine): ModelOption[] {
  const cached = loadCachedCatalog(engine)
  if (cached && cached.length > 0) {
    return mergeCatalogWithBuiltin(engine, cached)
  }
  return catalogFor(engine)
}

export async function fetchAndCacheCatalog(
  engine: ProviderEngine
): Promise<{ ok: true; models: ModelOption[]; count: number } | { ok: false; message: string }> {
  const result = await window.saforall.request<{
    models: Array<{ id: string; label?: string; tier?: string }>
  }>('GET', `/ai/models?engine=${encodeURIComponent(engine)}`)

  if (!result.ok || !result.data?.models) {
    return { ok: false, message: result.error?.message ?? '最新モデルの取得に失敗しました' }
  }

  const next: ModelOption[] = result.data.models.map((row, index) => ({
    id: row.id,
    label: row.label && row.label !== row.id ? `${row.label}（${row.id}）` : row.id,
    tier: (row.tier as ModelOption['tier']) || 'standard',
    costRank: index + 1
  }))

  if (next.length === 0) {
    return { ok: false, message: '取得結果が空でした（キーや権限を確認してください）' }
  }

  const merged = mergeCatalogWithBuiltin(engine, next)
  saveCachedCatalog(engine, merged)
  return { ok: true, models: merged, count: merged.length }
}

export async function prefetchAllModelCatalogs(): Promise<void> {
  const engines: ProviderEngine[] = [...USAGE_ENGINE_KEYS]
  await Promise.all(
    engines.map(async (engine) => {
      try {
        const result = await fetchAndCacheCatalog(engine)
        if (result.ok) {
          window.dispatchEvent(
            new CustomEvent('saforall-model-catalog-updated', { detail: { engine } })
          )
        }
      } catch {
        // キー未設定などは無視（キャッシュ／組み込みを使う）
      }
    })
  )
}
