import { useEffect, useMemo, useState } from 'react'
import type { ModelOption, ProviderEngine } from '../lib/llmModels'
import {
  fetchAndCacheCatalog,
  initialCatalogOptions,
  loadCachedCatalog,
  mergeCatalogWithBuiltin
} from '../lib/modelCatalogCache'

type Props = {
  engine: ProviderEngine
  enabled: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** 最新モデル一覧を API から取得できるとき true */
  canFetchLatest?: boolean
}

type DisplayRow = {
  id: string
  label: string
  tierLabel: string
  checked: boolean
}

export function ModelMultiSelect({
  engine,
  enabled,
  onChange,
  disabled,
  canFetchLatest = true
}: Props) {
  const [options, setOptions] = useState<ModelOption[]>(() => initialCatalogOptions(engine))
  const [customId, setCustomId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchMessage, setFetchMessage] = useState<string | null>(null)

  // 起動時プリフェッチや他画面の取得結果を反映
  useEffect(() => {
    const cached = loadCachedCatalog(engine)
    if (cached && cached.length > 0) {
      setOptions(mergeCatalogWithBuiltin(engine, cached))
    }

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: ProviderEngine }>).detail
      if (detail?.engine && detail.engine !== engine) return
      const next = loadCachedCatalog(engine)
      if (next && next.length > 0) {
        setOptions(mergeCatalogWithBuiltin(engine, next))
      }
    }
    window.addEventListener('saforall-model-catalog-updated', onUpdated)
    return () => window.removeEventListener('saforall-model-catalog-updated', onUpdated)
  }, [engine])

  const knownIds = useMemo(() => new Set(options.map((m) => m.id)), [options])

  const displayRows = useMemo((): DisplayRow[] => {
    const enabledSet = new Set(enabled)
    const byId = new Map(options.map((item) => [item.id, item]))
    const checked: DisplayRow[] = enabled.map((id) => {
      const hit = byId.get(id)
      return {
        id,
        label: hit?.label ?? id,
        tierLabel: hit ? hit.tier : 'カスタム',
        checked: true
      }
    })
    const unchecked: DisplayRow[] = options
      .filter((item) => !enabledSet.has(item.id))
      .map((item) => ({
        id: item.id,
        label: item.label,
        tierLabel: item.tier,
        checked: false
      }))
    return [...checked, ...unchecked]
  }, [enabled, options])

  const toggle = (id: string) => {
    if (enabled.includes(id)) {
      if (enabled.length <= 1) return
      onChange(enabled.filter((item) => item !== id))
      return
    }
    // 新しくチェックしたものは先頭（上）へ
    onChange([id, ...enabled.filter((item) => item !== id)])
  }

  const addCustom = () => {
    const id = customId.trim()
    if (id === '') return
    if (!enabled.includes(id)) {
      onChange([id, ...enabled])
    }
    if (!knownIds.has(id)) {
      setOptions((current) => [
        {
          id,
          label: id,
          tier: 'standard',
          costRank: 50
        },
        ...current
      ])
    }
    setCustomId('')
  }

  const fetchLatest = async () => {
    setFetching(true)
    setFetchMessage(null)
    try {
      const result = await fetchAndCacheCatalog(engine)
      if (!result.ok) {
        setFetchMessage(result.message)
        return
      }
      setOptions(result.models)
      setFetchMessage(`${result.count} 件のモデルを取得しました`)
      window.dispatchEvent(
        new CustomEvent('saforall-model-catalog-updated', { detail: { engine } })
      )
    } catch (error) {
      setFetchMessage(String(error))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="model-multi" role="group" aria-label={`${engine} models`}>
      <div className="model-multi-toolbar">
        <button
          type="button"
          className="model-multi-fetch"
          disabled={disabled || !canFetchLatest || fetching}
          onClick={() => void fetchLatest()}
        >
          {fetching ? '取得中…' : '最新を取得'}
        </button>
        {fetchMessage && <span className="model-multi-fetch-msg">{fetchMessage}</span>}
      </div>

      <div className="model-multi-list">
        {displayRows.map((row) => (
          <label key={row.id} className={`model-multi-item${row.checked ? ' is-checked' : ''}`}>
            <span className="model-multi-label">
              {row.label}
              <small> · {row.tierLabel}</small>
            </span>
            <input
              type="checkbox"
              checked={row.checked}
              disabled={disabled}
              onChange={() => toggle(row.id)}
            />
          </label>
        ))}
      </div>
      <div className="model-multi-custom">
        <input
          value={customId}
          disabled={disabled}
          placeholder="カスタム Model ID を追加"
          onChange={(event) => setCustomId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addCustom()
            }
          }}
        />
        <button type="button" disabled={disabled || customId.trim() === ''} onClick={addCustom}>
          追加
        </button>
      </div>
    </div>
  )
}
